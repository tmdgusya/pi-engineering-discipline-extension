# Team Mode Architecture

The `team` mode of `pi` lets a root/orchestrator session create a bounded set of
worker agents, observe them in readable `pi` CLI panes when tmux is available,
and continue managing the run through a durable command inbox.

This document describes the implementation contract for engineers modifying team
mode: source files, data model, lifecycle, tmux behavior, inbox/follow-up command
flow, persistence/resume semantics, and verification expectations. It is not a
user tutorial.

---

## Source of truth

| File                                                     | Role                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions/agentic-harness/team.ts`                     | Orchestrator — `runTeam`, fresh run lifecycle, follow-up command lifecycle, synthesis, tmux cleanup policy                             |
| `extensions/agentic-harness/team-state.ts`               | Persistence — `TeamRunRecord`, `commands[]`, events, inbox/outbox messages, resume/stale normalization                                 |
| `extensions/agentic-harness/team-command.ts`             | `/team` argument parsing, completions, and prompt builder for fresh runs and follow-up command mode                                    |
| `extensions/agentic-harness/tmux.ts`                     | tmux integration — tmux detection, current-window vs detached-session pane creation, pane logging, mouse/copy-mode setup, cleanup      |
| `extensions/agentic-harness/index.ts`                    | UI/tool wiring — registers `/team` and the `team` tool, maps runtime callbacks to UI updates, persists/loads runs                      |
| `extensions/agentic-harness/subagent.ts`                 | Worker process execution — native vs tmux launch, real `pi` CLI tmux panes, artifact-backed result hydration, process lifecycle events |
| `extensions/agentic-harness/tests/team-e2e-tmux.test.ts` | End-to-end fake-tmux guard for readable tmux panes and durable follow-up command dispatch                                              |

---

## Invariants

These are properties the codebase assumes; do not break them without updating
this document and the relevant tests.

1. **The leader/orchestrator owns the run.** Workers execute bounded assignments
   and follow-up commands only; they must not spawn subagents or run orchestration
   workflows. `WORKER_PROTOCOL`, `PI_TEAM_WORKER`, and `PI_SUBAGENT_MAX_DEPTH=1`
   enforce this boundary.
2. **Fresh team runs create dependency-free parallel batches.** `blockedBy` is
   rejected by `validateTeamTasks`; the MVP scheduler has no task dependency DAG.
3. **Every worker assignment is also a durable command.** Fresh assignments and
   later follow-ups are represented in `TeamRunRecord.commands[]`; `messages[]`
   remains audit/history for leader→worker inbox and worker→leader outbox/error
   text.
4. **Command lifecycle transitions are append-only evidence.** Command state is
   updated in-place for the latest status, while every transition appends a
   `command_*` event. `statusVersion` guards stale writers; conflicts append
   `command_conflict` instead of silently overwriting.
5. **Tmux panes are readable `pi` CLI panes.** Tmux workers must not be launched
   with `--mode json`, `-p`, or `PI_TMUX_RENDERER`. The machine-readable path is
   separate from the operator-visible pane.
6. **Tmux display and orchestration streams are separate.** `logFile` is the
   visible pane transcript captured by `pipe-pane`; `eventLogFile` is the small
   orchestration side-channel used for exit markers. The final worker report is
   read from the output artifact when tmux mode creates one.
7. **Pane creation is all-or-fail for a fresh tmux batch.** `createWorkerPanes`
   either returns refs for all runnable workers or throws; the catch branch marks
   every runnable task failed.
8. **`emitBackendResolved` fires exactly once per `runTeam` invocation.** It fires
   after backend resolution and before run creation/resume work.
9. **`emitTmuxReady` fires at most once per fresh tmux run, after panes exist.**
   It is not emitted for native runs, pane-creation failure, or a resume/follow-up
   invocation that does not create panes.
10. **Fresh successful tmux runs clean up automatically.** Detached sessions are
    killed on all-success; failed runs are left for post-mortem. If panes were
    created in the current tmux window, only the created worker panes are killed.
11. **Persistence writes are serialized per runtime.** `persistIfEnabled` uses a
    `WeakMap<TeamRuntime, Promise<void>>` chain so concurrent worker completions
    do not race file writes.

---

## Data model

```
TeamRunOptions
  ├─ fresh mode:     goal, workerCount, backend, runId, ...
  └─ follow-up mode: resumeRunId, commandTarget, commandMessage, ...
        │
        ▼
TeamRunRecord (.pi/agent/runs/<runId>/team-run.json)
  ├─ runId, goal, status: "created" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  ├─ options: TeamRunOptionsSnapshot
  ├─ tasks: TeamTask[]
  ├─ commands: TeamCommand[]   // durable assignment/follow-up inbox lifecycle
  ├─ events: TeamRunEvent[]    // run/task/message/command lifecycle audit trail
  └─ messages: TeamMessage[]   // human-readable inbox/outbox/error history
        │
        ▼
TeamRunSummary
  ├─ counts (completedCount, failedCount, blockedCount)
  ├─ backendRequested, backendUsed
  ├─ tasks (with terminal refs preserved)
  ├─ finalSynthesis
  └─ verificationEvidence
```

### `TeamRunOptions`

`goal` is optional at the type level because follow-up command mode has no new
goal. Runtime validation enforces exactly one mode:

| Mode              | Required                                         | Forbidden |
| ----------------- | ------------------------------------------------ | --------- |
| Fresh run         | `goal`                                           | —         |
| Follow-up command | `resumeRunId`, `commandTarget`, `commandMessage` | `goal`    |

`commandTarget` may match either a task id (`task-1`) or worker owner
(`worker-1`).

### `TeamTask`

```ts
{
  id: "task-1",
  subject: "Worker 1: <goal>",
  description: "...",
  agent: "worker",
  owner: "worker-1",
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked" | "interrupted",
  blockedBy: [],            // MVP: must be empty
  artifactRefs: [],
  worktreeRefs: [],
  resultSummary?: string,
  errorMessage?: string,
  startedAt / updatedAt / completedAt / heartbeatAt?: ISO string,
  terminal?: TeamTerminalMetadata
}
```

### `TeamCommand`

```ts
{
  id: "team-abc-command-1",
  runId: "team-abc",
  taskId: "task-1",
  owner: "worker-1",
  sequence: 1,
  attempt: 1,
  status: "queued" | "acknowledged" | "started" | "completed" | "blocked" | "failed" | "stale",
  statusVersion: 0,
  body: "assignment or follow-up command text",
  createdAt / updatedAt / lastAttemptAt: ISO string,
  completedAt?: ISO string,
  resultSummary?: string,
  errorMessage?: string,
  artifactRefs: []
}
```

Important command helpers in `team-state.ts`:

- `enqueueTeamCommand` creates a queued command and appends `command_enqueued`.
- `acknowledgeTeamCommand`, `startTeamCommand`, `completeTeamCommand`,
  `blockTeamCommand`, and `failTeamCommand` perform guarded transitions and
  append matching events.
- `retryTeamCommand` requeues the same command id with `attempt + 1`; after
  `TEAM_COMMAND_MAX_ATTEMPT` (currently `3`) it blocks the command.
- `markStaleCommands` turns non-terminal commands stale or retries them during
  resume, depending on `resumeMode`.
- `projectTeamTasksFromCommands` projects the latest command per task back onto
  `tasks[]` during resume normalization.

### `TeamTerminalMetadata`

```ts
{
  backend: "native" | "tmux",
  // when backend === "tmux":
  sessionName?: "pi-<runId>" | "pi-<runId>-attempt-<hex8>" | "<current tmux session>",
  windowName?: "workers" | "<current tmux window>",
  paneId?: "%1",
  attachCommand?: "tmux attach -t <session>",
  logFile?: ".pi/agent/runs/<runId>/tmux/task-N.log",
  eventLogFile?: ".pi/agent/runs/<runId>/tmux/task-N.events.jsonl",
  tmuxBinary?: "/usr/bin/tmux",
  sessionAttempt?: "a1b2c3d4"
}
```

This is the contract between the orchestrator and `runAgent`. In tmux mode,
`subagent.ts` sends a shell wrapper into `paneId`; it does **not** spawn a JSON
renderer pane.

---

## Fresh run lifecycle

```
user types /team ...
        │
        ▼
parseTeamArgs → buildTeamCommandPrompt → agent invokes `team` tool
        │
        ▼
runTeam(opts, runtime)
  │
  ├─ validate mode: fresh requires goal; follow-up requires resume+target+message
  │
  ├─ detectTmux() and resolve backendUsed
  │      native: always native
  │      tmux: forced tmux, may fail later if tmux is unavailable
  │      auto: tmux when available, otherwise native
  │
  ├─ emitBackendResolved({ requested, used, tmuxAvailable })
  │
  ├─ createTeamRunRecord(...tasks...) OR loadRun(resumeRunId)
  │      resume also calls markStaleRunningTasks/markStaleCommands
  │
  ├─ if follow-up mode: hand off to runTeamFollowUpCommand (see below)
  │
  ├─ validateTeamTasks(blockedBy must be empty)
  │
  ├─ set run status "running" and persist
  │
  ├─ if backendUsed === "tmux" and there are pending tasks:
  │      createWorkerPanes(...)
  │        - inside existing tmux: split current window
  │        - outside tmux: create detached session/window
  │      assign each task.terminal = { backend: "tmux", ...paneRef }
  │      emitTmuxReady(...)
  │      persist
  │   else:
  │      assign task.terminal = { backend: "native" }
  │
  ├─ for each pending task, concurrency-limited by MAX_CONCURRENCY:
  │      mark task in_progress
  │      enqueueTeamCommand(assignmentPrompt)
  │      acknowledge/start command immediately
  │      record inbox message leader → worker
  │      start heartbeat timer
  │      runtime.runTask(...) → runAgent(...)
  │      summarize result
  │      complete/fail command
  │      record outbox/error message worker → leader
  │      mark task completed/failed
  │      persist and emitProgress
  │
  ├─ synthesizeTeamRun(...)
  │
  ├─ cleanup tmux on all-success only
  │      detached session: kill-session
  │      current-window placement: kill created worker panes
  │
  └─ append run_completed/run_failed, persist summary, return summary
```

---

## Durable inbox and follow-up commands

Team mode now treats the persisted run record as the durable coordination
surface. `messages[]` is the readable mailbox log, while `commands[]` is the
state machine the orchestrator uses to track work.

### Fresh assignment command flow

A fresh worker assignment creates this command sequence before `runtime.runTask`
returns:

```
queued → acknowledged → started → completed|failed
```

The leader also records a delivered inbox message containing the exact worker
assignment prompt.

### Follow-up command flow

A follow-up command is requested by calling the `team` tool without `goal`:

```text
resumeRunId="team-..."
commandTarget="worker-1"   # or task-1
commandMessage="Do the next bounded thing..."
```

The lifecycle is:

```
load existing run
  │
  ├─ mark stale tasks/commands according to resumeMode/staleTaskMs
  ├─ find commandTarget by task id or owner
  ├─ enqueueTeamCommand(commandMessage)
  ├─ record inbox message leader → worker
  ├─ runtime.runTask(buildCommandWorkerPrompt(...))
  ├─ if dispatch/runTask throws before a result: block command + task
  ├─ otherwise acknowledge/start command after the worker result returns
  ├─ complete command + task on successful result
  └─ fail command + task on non-success result
```

A missing target fails the run invocation and persists a `run_failed` event; it
must not enqueue a command for an unknown worker.

Current implementation detail: follow-up dispatch reuses `runtime.runTask` for
the target worker lane and records `acknowledged`/`started` after that call
returns with a worker result. That gives the command a durable lifecycle and a
normal worker prompt, but it is not a long-lived daemon consuming a mailbox file
in a loop. If future work introduces true always-on worker inbox polling, keep
this state machine as the durable source of truth and move ack/start to the
actual worker-consume point.

---

## Tmux pane model

Team mode has two tmux placements:

| Placement          | Trigger                                                      | Pane creation                                                      | Cleanup on success                 |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| `current-window`   | `pi` is already running inside tmux (`TMUX` and `TMUX_PANE`) | split the current pane once per worker and tile the current window | kill only the created worker panes |
| `detached-session` | not already inside tmux                                      | `new-session -d -s pi-<runId> -n workers`, then split/tile         | kill the whole session             |

`createWorkerPanes` enables mouse scrolling by default (`PI_TEAM_MOUSE=0`
disables this), sets clipboard best-effort, and strips underline artifacts from
copy-mode selection styles best-effort.

Session naming for detached runs uses `buildTmuxSessionName(runId)`, producing
`pi-<safeRunId>`. On duplicate session errors, `-attempt-<hex8>` is appended and
stored in `sessionAttempt`.

### Why panes show a real CLI instead of JSON logs

In tmux mode `runAgent` calls:

```ts
buildPiArgs(..., outputMode = "text", printMode = false)
```

That intentionally omits `--mode json` and `-p`, so the pane starts the same
interactive/readable `pi` CLI shape a user expects. The worker still receives
its bounded task as the final `Task: ...` argument, but the rendered pane is not
the old JSON stream.

Machine coordination uses separate mechanisms:

- `eventLogFile` receives only the tmux exit marker (`__PI_TMUX_EXIT:<code>`)
  from the wrapper.
- `PI_SUBAGENT_OUTPUT_FILE` points the worker at an artifact file for its final
  report; tmux orchestration hydrates `SingleResult.messages` from that file.
- `logFile` is still captured with `pipe-pane` so users can inspect the visible
  pane transcript after cleanup.

The regression guard in `tests/team-e2e-tmux.test.ts` rejects tmux worker argv
containing `--mode json`, `-p`, or `PI_TMUX_RENDERER`.

---

## Persistence and resume

```
.pi/agent/runs/<runId>/
  team-run.json
  artifacts/<worker-run-id>/...
  tmux/
    task-1.log
    task-1.events.jsonl
    task-2.log
    task-2.events.jsonl
    ...
```

`team-run.json` is rewritten atomically via a temp file + rename. Writes are
serialized per runtime so parallel worker completions preserve the latest
record.

### Resume semantics

`runTeam({ resumeRunId })` loads and normalizes the existing run. Missing
`commands`, `events`, or `messages` arrays from older records normalize to empty
arrays.

`markStaleRunningTasks` handles tasks left `in_progress`; `markStaleCommands`
handles non-terminal commands.

| `resumeMode`                 | Tasks                               | Commands                                                                |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `mark-interrupted` (default) | stale `in_progress` → `interrupted` | stale non-terminal → `stale`                                            |
| `retry-stale`                | stale `in_progress` → `pending`     | retry non-terminal command until `TEAM_COMMAND_MAX_ATTEMPT`, then block |

After stale handling, `projectTeamTasksFromCommands` projects each latest command
state back onto the owning task so task status and command status do not drift.

A fully completed resumed run has no pending tasks, so it does not create new
panes and does not emit `emitTmuxReady`.

---

## Observability hooks

`TeamRuntime` keeps the orchestrator UI-agnostic. `index.ts` translates optional
callbacks into UI effects.

| Callback                    | When it fires                                          | UI behavior                                                              |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `emitBackendResolved(info)` | once per `runTeam` invocation after backend resolution | notify only for `auto → native` fallback                                 |
| `emitTmuxReady(info)`       | once after tmux panes are created for a fresh run      | show attach/log info and status text; includes `attachedToCurrentClient` |
| `emitProgress(summary)`     | on task start and completion                           | update running summary text                                              |
| `persistRun(record)`        | after meaningful run/task/command state changes        | write `team-run.json`                                                    |
| `loadRun(runId)`            | resume/follow-up invocations                           | load `team-run.json`                                                     |

### Edge case: forced tmux without tmux

`backend="tmux"` forces `backendUsed="tmux"` even when `detectTmux()` reports
unavailable. That is intentional: pane creation fails next, runnable tasks are
marked failed, and the normal per-task/run failure path reports the problem.

---

## Failure handling

| Failure                                                | Effect                                                     | tmux session/panes                                            | Tests                                               |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `validateTeamTasks` rejects `blockedBy`                | offending task → `blocked`, run → `failed`                 | not created                                                   | `tests/team-state.test.ts`, `tests/team.test.ts`    |
| `createWorkerPanes` throws                             | every runnable task → `failed`, run → `failed`             | none, or best-effort cleanup if a session name exists         | `tests/team.test.ts`                                |
| worker `runTask` rejects during follow-up wake-up      | command → `blocked`, target task → `blocked`               | unchanged                                                     | `tests/team.test.ts` / command tests                |
| worker result is non-success                           | command → `failed`, task → `failed`                        | left until failed run end                                     | `tests/team.test.ts`                                |
| command transition has stale `statusVersion`           | append `command_conflict`, preserve existing command state | unchanged                                                     | `tests/team-state.test.ts`                          |
| non-terminal command is stale on resume                | stale or retry depending on `resumeMode`                   | new panes only if tasks become pending                        | `tests/team-state.test.ts`                          |
| run completes with any failed/blocked/interrupted task | final status `failed` or `interrupted`                     | preserved for post-mortem                                     | `tests/team.test.ts`                                |
| run completes with all tasks completed                 | final status `completed`                                   | detached session killed or current-window worker panes killed | `tests/team.test.ts`, `tests/team-e2e-tmux.test.ts` |

---

## Concurrency and execution limits

- `MAX_PARALLEL_TASKS = 12` — hard cap on requested `workerCount`.
- `MAX_CONCURRENCY = 10` — maximum concurrent in-flight worker executions.
- `PI_SUBAGENT_MAX_DEPTH=1` is passed to workers, and worker prompts explicitly
  ban delegation/orchestration.
- `buildTmuxLaunchEnv` allowlists only team/subagent/artifact environment keys
  into tmux launch scripts, preventing broad secret leakage from the parent
  environment.

---

## Verification expectations for changes

For changes touching team orchestration, run at least:

```bash
cd extensions/agentic-harness && npm test
cd extensions/agentic-harness && npm run build
git diff --check
```

For tmux pane behavior, also keep or extend an e2e/fake-tmux assertion that:

- `send-keys` is used for worker panes.
- tmux worker argv does not contain `--mode json`, `-p`, or `PI_TMUX_RENDERER`.
- follow-up commands produce `command_enqueued`, `command_acknowledged`,
  `command_started`, and `command_completed` (or the appropriate failure state).
- command bodies appear in the dispatched worker prompt.

When possible, add a manual real-tmux smoke before release: start a small team
run with `backend=tmux`, attach to the session, verify each worker pane displays
a readable `pi` CLI, enqueue a follow-up command, and archive the relevant
`team-run.json`/tmux logs.

---

## Adding new observability or command states

1. Add new `TeamRuntime` callbacks as optional fields.
2. Define exported payload types.
3. Fire callbacks at one lifecycle point; document exactly where.
4. Gate UI side effects in `index.ts` on UI availability.
5. Add positive and negative tests.
6. If adding command states, update `terminalCommandStatus`, stale handling,
   `projectTeamTasksFromCommands`, and this document together.

---

## Glossary

- **Run** — one persisted team orchestration record, identified by `runId`.
- **Leader/orchestrator** — the root `pi` session that creates the team and owns
  follow-up commands.
- **Task** — one worker lane (`task-1`, `task-2`, ...).
- **Worker owner** — stable human name for a task (`worker-1`, `worker-2`, ...).
- **Command** — durable unit of work in `commands[]`; fresh assignments and
  follow-up messages both use this state machine.
- **Inbox/outbox** — human-readable `messages[]` entries; not the authoritative
  lifecycle state.
- **Backend** — `native` child process or `tmux` pane execution.
- **Placement** — whether tmux panes are created in the current window or a
  detached session.
- **Resume** — re-entering a persisted run via `resumeRunId`.
- **Attach** — `tmux attach -t <sessionName>` to observe panes live.
