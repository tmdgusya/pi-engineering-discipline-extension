# Team Mode Architecture

The `team` mode of `pi` dispatches a small bounded set of independent worker
agents to execute a goal in parallel, optionally inside a `tmux` session so the
user can attach and watch each worker live.

This document describes the architecture: data shape, lifecycle, invariants,
and the observability hooks that surface what's happening to the user. It is
intended as a map for engineers modifying the team feature; it is not a tutorial.

---

## Source of truth

| File | Role |
|------|------|
| `extensions/agentic-harness/team.ts` | Orchestrator — `runTeam`, types, synthesis, lifecycle hooks |
| `extensions/agentic-harness/team-state.ts` | Persistence — `TeamRunRecord`, events, messages, resume |
| `extensions/agentic-harness/team-command.ts` | `/team` slash command parsing + prompt builder |
| `extensions/agentic-harness/tmux.ts` | tmux integration — pane creation, attach commands, cleanup |
| `extensions/agentic-harness/index.ts` | UI wiring — registers `/team` command and `team` tool, supplies `runTeam` runtime callbacks |
| `extensions/agentic-harness/subagent.ts` | Worker process execution — `runAgent`, native vs tmux execution mode, tmux stream split between readable pane output and raw machine events |

---

## Invariants

These are properties the codebase assumes; do not break them without updating
this document.

1. **One session per run.** All panes for a run share `sessionName`, `windowName`,
   and `attachCommand`. `paneRefs[0].sessionName` therefore identifies the entire
   run. (`tmux.ts:148-155, 166-174`)
2. **Pane creation is atomic per run.** `createWorkerPanes` either returns refs
   for *all* requested workers or throws. Partial sessions do not exist in the
   happy path. (`tmux.ts:109-179`)
3. **`emitTmuxReady` fires at most once per run, after all panes exist.** It is
   never called from the catch branch of pane setup. The single regression test
   guarding this is at `tests/team.test.ts` ("does not fire tmux ready when
   pane setup fails").
4. **`emitBackendResolved` fires exactly once per run, regardless of resume.**
   It fires *before* persistence, *before* tasks start, immediately after the
   backend decision is made. Resume runs still emit it because the consumer
   (UI) needs to know which backend the resumed run is using.
5. **Task `terminal` is set before any worker runs.** Either to
   `{ backend: "native" }` (no tmux) or to a fully-populated `TeamTerminalMetadata`
   (tmux). Workers consume `task.terminal` to decide their `executionMode`.
6. **Tmux display and orchestration streams are separate.** `logFile` remains the
   human-visible pane log, while `eventLogFile`/`rawEventLogFile` is the optional
   machine JSONL side-channel that `runAgent` parses when present. Do not point
   operators at the raw event log as the primary pane experience.
7. **Successful runs auto-clean their tmux session; failed runs do not.** Failed
   sessions remain attached-able for post-mortem. (`team.ts` cleanup branch
   near the end of `runTeam`.)
8. **Workers must not orchestrate.** The `WORKER_PROTOCOL` constant
   (`team.ts:114-121`) and the `PI_TEAM_WORKER` env (`PI_TEAM_WORKER_ENV`)
   together prevent recursive subagent spawning. The `team` tool itself is
   only registered when `isRootSession && !isTeamWorker` (`index.ts:261`).

---

## Data model

```
TeamRunOptions          // user input  (goal, workerCount, backend, runId, resumeRunId, ...)
        │
        ▼
TeamRunRecord           // persisted run state (.pi/agent/runs/<runId>/team-run.json)
  ├─ runId, goal, status: "running" | "completed" | "failed" | "interrupted"
  ├─ tasks: TeamTask[]
  ├─ events: TeamEvent[]      // run_created, task_started, task_completed, ...
  └─ messages: TeamMessage[]  // inbox/outbox/error logs between leader and workers
        │
        ▼
TeamRunSummary          // synthesis returned to caller
  ├─ counts (completedCount, failedCount, blockedCount)
  ├─ tasks (with terminal refs preserved)
  ├─ backendRequested, backendUsed
  ├─ finalSynthesis (human-readable text)
  └─ verificationEvidence
```

### `TeamTask`

```ts
{
  id: "task-1",
  subject: "Worker 1: <goal>",
  description: "...",
  agent: "worker",
  owner: "worker-1",
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked" | "interrupted",
  blockedBy: [],            // MVP: must be empty (validateTeamTasks)
  artifactRefs: [],
  worktreeRefs: [],
  // Filled in during run:
  resultSummary?: string,
  errorMessage?: string,
  startedAt / updatedAt / completedAt / heartbeatAt?: ISO string,
  terminal?: TeamTerminalMetadata
}
```

### `TeamTerminalMetadata`

```ts
{
  backend: "native" | "tmux",
  // Only when backend === "tmux":
  sessionName?: "pi-team-<runId>" | "pi-team-<runId>-attempt-<suffix>",
  windowName?: "workers",
  paneId?: "%1",
  attachCommand?: "tmux attach -t pi-team-<runId>",
  logFile?: ".pi/agent/runs/<runId>/tmux/task-N.log",
  eventLogFile?: ".pi/agent/runs/<runId>/tmux/task-N.events.jsonl",
  // rawEventLogFile is an acceptable alias if code needs a more explicit name.
  rawEventLogFile?: ".pi/agent/runs/<runId>/tmux/task-N.events.jsonl",
  tmuxBinary?: "/usr/bin/tmux",
  sessionAttempt?: "a1b2c3d4"   // present only on session-name collision retry
}
```

This is the contract between orchestrator and worker. `subagent.ts` switches
`executionMode` based on `terminal.backend` and uses every other field if
present. In tmux mode, `logFile` is the operator-facing visible pane log. When
`eventLogFile`/`rawEventLogFile` is set, `runAgent` must parse that file for raw
pi JSON events and exit markers instead of scraping the visible log.

### Session naming

`buildTmuxSessionName(runId)` (`tmux.ts:74-80`) produces `pi-<safeRunId>` where
`safeRunId` lower-cases, slugifies, and falls back to `team` for empty inputs.
On `EEXIST` the session-name collision branch (`tmux.ts:133-142`) appends an
`-attempt-<hex8>` suffix and stores it on every `paneRef.sessionAttempt` for
debugging; the `attachCommand` is regenerated to match.

---

## Lifecycle (single run)

```
   user types /team in pi
           │
           ▼
   parseTeamArgs → confirm dialog → pi.sendUserMessage(buildTeamCommandPrompt)
           │  (index.ts:1387 slash command)
           ▼
   agent invokes the `team` tool
           │  (index.ts:262 tool registration)
           ▼
   runTeam(opts, runtime)                                team.ts
       │
       ├─ detectTmux() ─────────────────────────────►  tmux.ts:66
       │       resolves backendUsed
       │
       ├─ runtime.emitBackendResolved({ requested, used, tmuxAvailable })   ★ new
       │
       ├─ load record (resume) OR createTeamRunRecord (fresh)
       │       persistRun → .pi/agent/runs/<runId>/team-run.json
       │
       ├─ validateTeamTasks (rejects blockedBy)
       │
       ├─ if backendUsed === "tmux" && runnableTasks.length > 0:
       │       createWorkerPanes ─────────────────────►  tmux.ts:109
       │             new-session, split-window×N, select-layout tiled,
       │             pipe-pane → task-N.log per pane
       │       assign task.terminal = { backend: "tmux", ...pane }
       │       runtime.emitTmuxReady({ sessionName, attachCommand,            ★ new
       │                              paneCount, logDir })
       │       persist
       │   else:
       │       task.terminal = { backend: "native" }
       │
       ├─ for each runnable task (concurrency = MAX_CONCURRENCY = 10):
       │       set status = "in_progress"
       │       record inbox message (leader → worker)
       │       runtime.emitProgress(synthesizeTeamRun(...))                   updated text
       │       heartbeat interval (default 15s) → records task_heartbeat
       │       runtime.runTask({...})  ──────────────►  index.ts:323
       │                                                    runAgent (subagent.ts)
       │                                                    executionMode: "tmux" | "native"
       │       update status, resultSummary, error
       │       record outbox/error message
       │       runtime.emitProgress(...)
       │       persist
       │
       ├─ summary = synthesizeTeamRun(goal, tasks, results, ...)
       │       finalSynthesis includes per-task `Attach: ...` lines
       │
       ├─ if success && tmuxSessionName:
       │       killTmuxSession(...)  ─────────────────►  tmux.ts:181
       │   else:
       │       leave session for post-mortem
       │
       └─ return summary
                │
                ▼
   index.ts wraps as ToolResult
       finalSynthesis → text content
       isError = !summary.success
       terminate = summary.success
```

---

## Observability hooks

The orchestrator is UI-agnostic — it speaks to the world through callbacks on
`TeamRuntime`. The `index.ts` wiring layer translates each callback into a UI
action.

```
                                     index.ts (wiring layer)
                                      ┌───────────────────────────────┐
TeamRuntime callback                  │  UI side effect                │
                                      ├───────────────────────────────┤
emitBackendResolved(info)  ──────────►│  if requested === "auto"      │
  fires after backend resolution      │     && used === "native":      │
  exactly once per run                │       ctx.ui.notify(           │
                                      │         "Tmux not detected — "│
                                      │         "running natively...")│
                                      │  else: silent                  │
                                      │                                │
emitTmuxReady(info)        ──────────►│  ctx.ui.notify(                │
  fires after panes exist             │     "Tmux team session ready" │
  exactly once per run (tmux only)    │     + attachCommand           │
                                      │     + per-worker log dir)     │
                                      │  ctx.ui.setStatus("harness",  │
                                      │     "Team running — <attach>")│
                                      │                                │
emitProgress(summary)      ──────────►│  onUpdate(text:               │
  fires per task start AND completion │     "Team [tmux: <session>]:  │
                                      │      X/N completed, ...")     │
                                      │  or "[native]" when no tmux   │
                                      └───────────────────────────────┘
```

Every UI side effect is gated on `hasUI` (matches the surrounding
`indicatorSupported` and approval-resolver patterns in `index.ts`); headless
runs (e.g., tests, CI scripts that import `runTeam` directly) just see the raw
callbacks and never touch UI APIs.

### Why three separate callbacks instead of one stream

- **`emitBackendResolved`** is a one-shot decision event. The UI only acts on
  the auto-fallback case; future consumers (telemetry, headless reporters) get
  the full payload including `tmuxAvailable`.
- **`emitTmuxReady`** is a one-shot lifecycle event with side-effects (toast +
  status line). Folding it into `emitProgress` would make it fire repeatedly
  and force the UI to dedupe.
- **`emitProgress`** is high-frequency, payload-only. It carries the full
  `TeamRunSummary` so consumers can render whatever they want. The `index.ts`
  formatter pulls `backendUsed` and the first tmux-backed task's `sessionName`
  out of the summary (no extra plumbing needed).

### Edge case: `requested === "tmux"` && `tmuxAvailable === false`

`emitBackendResolved` will fire with `{ requested: "tmux", used: "tmux", tmuxAvailable: false }`.
This shape is *intentionally* contradictory — it means "the caller forced
backend=tmux on a host without tmux." Pane creation will fail in the next
`try` block and the catch branch marks every task `failed` with the error
message. The current `index.ts` handler is narrow (`auto && native` only) and
does not surface a duplicate error toast, since the per-task error already
does. The contract is documented inline at the `TeamBackendResolvedInfo` type
definition.

---

## Backend resolution

```
requested  +  detectTmux()  →  used
─────────────────────────────────────
"native"      *                "native"
"tmux"        *                "tmux"        ← may fail later if tmux missing
"auto"        available        "tmux"
"auto"        unavailable      "native"      ← auto-fallback path (only
                                                consumer of the fallback toast)
```

`detectTmux()` runs `which tmux` and parses the first non-empty line as the
binary path; the resolved binary is propagated through `paneRef.tmuxBinary`
and used by `subagent.ts` `send-keys`. This was the fix in
`e80f23f fix: use resolved tmux binary for worker send-keys`.

---

## Pane lifecycle inside a tmux run

```
                  pi (host terminal)              tmux server (background, daemonized -d)
                  ──────────────────              ───────────────────────────────────────
                                                  session: pi-team-<runId>
runTeam ──────► createWorkerPanes ───────────────►   window: workers
                  new-session -d -s ...               pane %1 ─ pipe-pane → .pi/.../task-1.log
                  split-window  ×(N-1)                pane %2 ─ pipe-pane → .pi/.../task-2.log
                  select-layout tiled                 ...
                                                  emitTmuxReady fires NOW

per-worker:                                       (still running; no new tmux commands)
  runAgent(executionMode="tmux")
    buildTmuxShellCommand(...)
    send-keys -t pane%K "<cmd>" Enter ──────────►   pane %K runs the worker wrapper,
                                                     raw stdout → task-K.events.jsonl
                                                     rendered text → pipe-pane log
                                                     stderr/non-JSON → readable pane output
    poll event log for output ◄───────────────────  event log grows
    parse pi JSON events from event log lines
    detect TMUX_EXIT_MARKER in event log → resolve exit code

cleanup (success only):
  killTmuxSession ─────────────────────────────►   session destroyed, panes gone
                                                     (logs remain on disk)
```

The user's view: as soon as `emitTmuxReady` fires, they can run the printed
`tmux attach -t pi-team-<runId>` from any other terminal and see all panes
live, in the tiled layout. They are an *observer*; they can scroll, copy, but
must not interactively touch the worker shells.

If `pi` itself runs inside tmux, attaching the new session from the same
terminal is left to the user — pi does not auto-nest. Spawning a second
terminal app is also out of scope (see plan in `/tasks` history).

---

## Persistence and resume

```
.pi/agent/runs/<runId>/
  team-run.json         ← TeamRunRecord, rewritten after each event
  tmux/
    task-1.log          ← readable visible pane output (pipe-pane), survives session kill
    task-1.events.jsonl ← raw pi JSON events + tmux exit marker for orchestration
    task-2.log
    task-2.events.jsonl
    ...
```

`TeamRunRecord` is rewritten on every persist call (`persistIfEnabled`),
including on each task state transition and after pane creation. This is
deliberately wasteful but simple — the record is small, and full rewrites
make resume robust to crash mid-write.

### Resume

`runTeam({ resumeRunId })` skips `createTeamRunRecord` and instead calls
`runtime.loadRun(resumeRunId)`. `markStaleRunningTasks` then decides what to
do with tasks left in `in_progress`:

| `resumeMode` | Behavior |
|--------------|----------|
| `mark-interrupted` (default) | Convert stale `in_progress` → `interrupted` and skip them. Run reports failure. |
| `retry-stale` | Convert stale `in_progress` → `pending` and re-run them. |

`runnableTasks` is computed *after* resume normalization, so a fully-completed
resumed run has zero runnable tasks, skips `createWorkerPanes` entirely, and
does not emit `emitTmuxReady`. This is covered by the regression test "does
not fire tmux ready on resume when all tasks are already terminal" in
`tests/team.test.ts`.

---

## Failure handling

| Failure | Effect | tmux session | Tests |
|---------|--------|--------------|-------|
| `validateTeamTasks` rejects (blockedBy used) | First offending task → `blocked`, run → `failed` | not created | `tests/team-state.test.ts` |
| `createWorkerPanes` throws (tmux missing or `EEXIST` after retry) | Every runnable task → `failed` with the error message, run → `failed` | none | `tests/team.test.ts` "converts tmux pane setup failures..." and "does not fire tmux ready when pane setup fails" |
| Worker `runTask` rejects | That task → `failed`, run continues for siblings | left running until run end |  |
| Run completes with any non-success task | Final status `failed` (or `interrupted` if any task is still `in_progress`/`interrupted`) | **not killed** — preserved for post-mortem |  |
| Run completes with all tasks `completed` | Final status `completed`, summary returned | killed by `killTmuxSession` |  |

---

## Concurrency limits

- `MAX_PARALLEL_TASKS = 12` — hard cap on `workerCount`. (`subagent.ts`)
- `MAX_CONCURRENCY = 10` — concurrent in-flight workers. Even when
  `workerCount > 10`, only 10 run at a time.
- Worker `maxSubagentDepth` is forced to `1`, and the env `PI_SUBAGENT_MAX_DEPTH=1`
  is passed in. Workers cannot spawn further team/subagent invocations.

---

## Adding new observability hooks

If you need to surface a new lifecycle event:

1. Add the callback to `TeamRuntime` as **optional** (`emitX?`).
2. Define the payload as an exported interface so external consumers can type
   their handlers.
3. Fire it at exactly one point in `runTeam`. State *when* in the lifecycle
   doc above, not just *that* it fires.
4. In `index.ts`, gate any UI side effect on `if (!hasUI) return;`.
5. Add at least one positive and one negative test in `tests/team.test.ts`
   ("fires when X" and "does not fire when Y"). Negative tests catch the
   common regression of moving the call site to the wrong branch.

---

## Glossary

- **Run** — one invocation of `runTeam` from kickoff to terminal status.
- **Task** — a single worker assignment within a run; `task-1`, `task-2`, ...
- **Pane** — a tmux pane; one per task in the tmux backend.
- **Backend** — `native` (workers run as plain child processes) or `tmux`
  (workers run inside dedicated tmux panes with output piped to log files).
- **Resume** — re-entering a previously-persisted run via `resumeRunId`.
- **Attach** — running `tmux attach -t <sessionName>` from another terminal to
  observe panes live.
