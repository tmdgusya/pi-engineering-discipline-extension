# Verification Plan: True pi CLI tmux Team Panes

Date: 2026-04-28
Owner lane: worker-2 planner
Task: task-3, "Verification plan for true pi CLI team panes"
Scope: planning/review only; no code-file edits.

## Goal and non-negotiable acceptance target

Verify that `/team` tmux workers launch like direct `pi` CLI sessions in their tmux panes:

- Worker launch command in tmux must **not** include `--mode json`.
- Worker panes must **not** be JSON-rendered wrappers/transcoders around JSON-mode stdout.
- Visible pane/log output should be the natural direct CLI/TUI/text output from `pi` as launched for that worker.
- The original orchestrator session remains the orchestrator and still receives reliable worker completion/result summaries.
- Team cleanup/shutdown behavior remains safe: successful detached tmux sessions/current-window panes are cleaned up according to current policy; failed runs leave debug evidence.

## Evidence inspected

- Context snapshot: `.omx/context/teammode-pi-cli-workers-20260428T020518Z.md`
- Checkpoint patch: `.omx/checkpoints/teammode-cli-pane-before-team-20260428T054548Z.patch`
- Current implementation touchpoints:
  - `extensions/agentic-harness/subagent.ts`
    - `buildPiArgs()` currently always emits `--mode json`.
    - `buildTmuxLaunchScript()` currently wraps event-log tmux launches in a Node renderer when `eventLogFile` is present.
    - `runAgent()` tmux mode currently polls `eventLogFile ?? logFile` and parses JSON events via `processPiJsonLine()`.
  - `extensions/agentic-harness/index.ts`
    - tmux terminal metadata is currently passed to `runAgent()` without `eventLogFile`.
  - `extensions/agentic-harness/tmux.ts`
    - `createWorkerPanes()` creates visible `task-N.log` plus `task-N.events.jsonl` metadata.
  - `extensions/agentic-harness/runner-events.ts`
    - JSON parser and JSON-to-readable renderer exist; the renderer is explicitly not acceptable as the final user-facing pane model for this requirement.
  - Current tests:
    - `tests/tmux-command.test.ts`, `tests/subagent-process.test.ts`, `tests/team-e2e-tmux.test.ts`, `tests/team-tool.test.ts`, `tests/team.test.ts`, `tests/tmux.test.ts`.

## Verification strategy

Use layered verification. Unit tests should prove launch-command and metadata contracts; fake-tmux e2e should prove orchestrator collection without JSON-mode; manual tmux QA should prove the actual user-visible pane experience with a real `pi` CLI.

The key test distinction is:

- It is not enough for `task-N.log` to avoid raw JSON.
- Tests must prove the worker command itself is plain CLI mode: no `--mode json`, no `PI_TMUX_RENDERER`, no JSON renderer wrapper, and no event-log polling dependency on JSON events for success.

## Automated regression tests to add/update

### 1. `buildPiArgs()` output-mode contract

**File:** `extensions/agentic-harness/tests/subagent.test.ts` or a new targeted test file if `buildPiArgs()` is exported for tests.

**Purpose:** Prevent accidental reintroduction of JSON mode for tmux worker panes.

**Test cases:**

1. Native/default worker launch still includes JSON mode:
   - call the argument builder or an exported test seam with `outputMode: "json"` / default.
   - assert args contain `--mode`, `json` in order.
   - assert `-p` and task prompt are preserved.
2. Tmux direct-CLI launch omits JSON mode:
   - call with `outputMode: "text"` or equivalent tmux-direct mode.
   - assert args do **not** contain `--mode json`.
   - assert inherited extension args/proxy args/model/tool args/session flags are still preserved.
3. Negative guard:
   - assert args do not contain string forms like `"--mode json"`, `"--mode' 'json"`, or duplicated inherited mode flags if inherited args are normalized elsewhere.

**Acceptance:** native remains machine-readable; tmux-direct mode cannot launch JSON mode by accident.

### 2. `buildTmuxLaunchScript()` no-wrapper direct CLI contract

**File:** `extensions/agentic-harness/tests/tmux-command.test.ts`

**Purpose:** Prove tmux panes are not merely JSON-rendered wrappers.

**Test cases:**

1. Plain tmux direct-CLI script:
   - build launch script with command `/bin/echo`, args `['hello']`, cwd `/tmp`, env `{}`.
   - assert script contains `exec env '/bin/echo' 'hello'`.
   - assert script does **not** contain `PI_TMUX_RENDERER`, `readline`, `appendFileSync`, `renderJson`, `renderPiJsonLineForPane`, or an embedded Node renderer.
2. Event-log metadata does not force renderer:
   - build launch script with `eventLogFile: '/tmp/task-1.events.jsonl'`.
   - assert script still directly execs the command.
   - assert no `PI_TMUX_RENDERER` and no renderer code.
3. Exit-marker safety remains:
   - `buildTmuxShellCommand()` still appends `__PI_TMUX_EXIT:<code>` to the poll log/visible log path without raw control bytes.

**Acceptance:** the launch script is a normal shell exec of the resolved `pi` command, not a Node wrapper/transcoder.

### 3. `runAgent()` tmux result hydration from plain pane log

**File:** `extensions/agentic-harness/tests/subagent-process.test.ts`

**Purpose:** Preserve orchestrator result collection when no JSON events exist.

**Test cases:**

1. Fake tmux runs a child script that prints plain CLI text, not JSON:
   - stdout: `worker says hello\nfinal answer line\n`.
   - exit code: 0.
   - `tmuxPane.logFile` captures stdout via fake `pipe-pane`.
   - `tmuxPane.eventLogFile` may exist as metadata but should not be required for JSON parsing.
   - assert result `exitCode === 0`.
   - assert `result.messages` contains fallback assistant text from the useful pane-log tail.
   - assert `getResultSummaryText(result)` / team summary includes the plain text.
2. Fake tmux runs JSON-looking noise but no `agent_end`:
   - assert success is based on process exit and fallback log hydration, not `sawAgentEnd`.
3. Non-zero direct-CLI failure:
   - stdout/stderr includes readable failure text.
   - exit code non-zero.
   - assert `result.stderr` or `errorMessage` contains useful visible log tail.

**Acceptance:** the orchestrator can summarize successful direct-CLI workers and diagnose failed ones without JSON event envelopes.

### 4. Team wrapper forwards `eventLogFile` metadata but does not require JSON mode

**File:** `extensions/agentic-harness/tests/team-tool.test.ts`

**Purpose:** Prove terminal metadata survives the `team` tool boundary while direct CLI launch behavior stays in `runAgent()`.

**Test cases:**

1. Mock `runTeam()` invokes `runtime.runTask()` with terminal metadata containing `eventLogFile`.
2. Assert `runAgent()` receives `tmuxPane.eventLogFile`.
3. Assert `runAgent()` receives `executionMode: 'tmux'`.
4. Do not assert JSON renderer behavior; add a separate negative assertion in the fake-tmux e2e for the actual command payload.

**Acceptance:** metadata is preserved for lifecycle/debug paths, but metadata presence does not imply JSON-mode launch.

### 5. Fake tmux e2e: team completes with direct CLI worker command

**File:** `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`

**Purpose:** Prove the full team path works through tmux without JSON mode or renderer wrappers.

**Test setup:**

- Use the existing fake `tmux` binary that records calls and executes the `send-keys` shell command.
- Use a fixture agent script that prints plain direct-CLI output, e.g. `team worker done`, and exits 0.
- Ensure runtime passes `eventLogFile` through if the implementation keeps that metadata.

**Assertions:**

- `summary.success === true`.
- `summary.backendUsed === 'tmux'`.
- `summary.tasks[0].status === 'completed'`.
- `summary.tasks[0].resultSummary` contains the plain fixture output.
- `callsFile` contains `send-keys -t`.
- `callsFile` does **not** contain:
  - `--mode json`
  - `--mode' 'json`
  - `PI_TMUX_RENDERER`
  - `renderJson`
  - `readline` renderer code
  - secret env values such as `super-secret-token-value`
- Visible `task-1.log` contains the plain output.
- Visible `task-1.log` does **not** contain JSON event envelopes such as `"type":"message_end"` or `"type":"agent_end"`.

**Acceptance:** full team orchestration succeeds and the worker pane is launched as direct CLI, not JSON mode hidden behind rendering.

### 6. Shutdown and cleanup safety gates

**Files:** `extensions/agentic-harness/tests/team.test.ts`, `extensions/agentic-harness/tests/subagent-process.test.ts`

**Purpose:** Ensure changing completion/result collection does not break tmux lifecycle cleanup.

**Test cases:**

1. Successful detached tmux run:
   - assert `killTmuxSession(sessionName, ..., tmuxBinary)` is called after summary success.
2. Successful current-window run:
   - assert each worker pane is killed with `killTmuxPane(paneId, ..., tmuxBinary)` instead of killing the user session.
3. Failed tmux run:
   - assert cleanup is not performed, preserving panes/logs for debugging.
4. Abort/termination behavior:
   - existing abort tests should still pass; if direct CLI has no semantic `agent_end`, abort should not be misclassified as success unless the process exits 0 and usable output exists.
5. Stale marker guard:
   - preexisting stale `__PI_TMUX_EXIT` markers must not complete a newly launched worker before fresh output/marker appears.

**Acceptance:** lifecycle and cleanup semantics remain deterministic after direct-CLI launch changes.

## Manual tmux verification checklist

Run these from a real terminal with `tmux` installed, using a clean disposable repo or test fixture.

### A. Direct CLI pane appearance

1. Start a tmux session manually:
   - `tmux new -s pi-team-cli-verify`
2. From inside that session, run a small team job with tmux backend forced, for example:
   - `pi` then `/team goal="say hello from each worker and report one final line" workerCount=2 backend=tmux`
   - or the repo's supported equivalent command invocation if slash commands differ.
3. Observe the spawned worker panes.

**PASS if:**

- panes look like ordinary `pi` CLI sessions/workers rather than raw JSON streams;
- pane command history / captured pane text does not show `--mode json`;
- no `PI_TMUX_RENDERER` or embedded Node renderer appears;
- workers progress and finish with readable text;
- the original pane remains the orchestrator and produces the final team summary.

**FAIL if:** raw JSON events dominate the pane, the command contains `--mode json`, or a renderer wrapper is visible/required.

### B. Negative command capture

From the tmux session or immediately after the run:

1. Capture pane history/logs:
   - `tmux capture-pane -p -S -2000 -t <worker-pane-id>`
   - inspect `.pi/agent/runs/<run-id>/tmux/task-N.log`
2. Search for forbidden strings:
   - `--mode json`
   - `PI_TMUX_RENDERER`
   - `"type":"message_end"`
   - `"type":"agent_end"`

**PASS if:** forbidden strings are absent from visible pane history and visible `task-N.log`.

### C. Result collection

1. Confirm the orchestrator final summary includes each worker as completed.
2. Confirm each task summary includes meaningful worker output, not an empty summary or only an exit marker.
3. Confirm `.pi/agent/runs/<run-id>` records still include terminal metadata: attach command, pane id, visible log path, and any side-channel file paths used for debug.

**PASS if:** team summary is reliable and includes worker results despite no JSON mode.

### D. Failure behavior

1. Run a task designed to fail, e.g. a worker prompt that invokes a missing command or exits non-zero if test fixtures allow.
2. Confirm the final team summary marks the task failed.
3. Confirm panes/logs remain available for debugging.
4. Confirm error text comes from readable pane output/stderr.

**PASS if:** failures are diagnosable without raw JSON event logs.

### E. Cleanup behavior

1. For a successful detached run, confirm the tmux session is removed:
   - `tmux has-session -t <session>` should fail after success.
2. For a successful run launched inside an existing tmux client, confirm only worker panes are cleaned up, not the user's original session/window.
3. For failed runs, confirm panes/session remain for postmortem until manually killed.

**PASS if:** cleanup policy matches existing documented behavior.

## Required implementation properties to verify

Even though this lane is planning-only, the implementation should be considered incomplete unless these properties are true:

1. `buildPiArgs()` or equivalent launch builder has an explicit tmux direct-CLI mode that omits `--mode json`.
2. Native subprocess/backend behavior still uses JSON mode for structured parsing unless replaced by a separate tested mechanism.
3. `buildTmuxLaunchScript()` no longer treats `eventLogFile` as a signal to wrap stdout in a JSON renderer.
4. `runAgent()` can hydrate `SingleResult.messages` from readable pane log text when JSON events are absent.
5. Team summaries still use `getResultSummaryText()` or equivalent successfully for direct-CLI tmux workers.
6. `eventLogFile` metadata, if retained, is clearly a debug/lifecycle side channel, not the primary worker JSON event stream for normal tmux panes.
7. Tests explicitly reject both raw JSON mode and JSON renderer wrappers.

## Regression risk matrix

| Risk | Likelihood | Impact | Verification guard |
| --- | --- | --- | --- |
| Tmux worker exits 0 but result summary is empty because no JSON events were parsed | High | High | `runAgent()` plain-log hydration test + fake tmux e2e summary assertion |
| Native backend loses JSON parsing semantics | Medium | High | native/default `buildPiArgs()` JSON-mode test + existing native process tests |
| Event-log metadata accidentally re-enables renderer wrapper | Medium | Medium | `buildTmuxLaunchScript(eventLogFile)` negative wrapper test |
| Failure output lost because no JSON `errorMessage` event exists | Medium | High | non-zero direct-CLI failure test requiring visible log tail in error summary |
| Successful run cleanup kills user's tmux session when launched inside tmux | Low | High | current-window cleanup test for `killTmuxPane` not `killTmuxSession` |
| Fake tests pass but real panes still show JSON/TUI oddities | Medium | Medium | manual real tmux capture-pane checklist |
| Secret env values leak via send-keys payload | Low | High | existing `team-e2e-tmux` negative secret assertion retained |

## Suggested verification command sequence

After implementation, run from `extensions/agentic-harness`:

```bash
npm run build
npm test -- --run tests/tmux-command.test.ts tests/subagent-process.test.ts tests/team-tool.test.ts tests/team-e2e-tmux.test.ts tests/team.test.ts tests/tmux.test.ts
npm test
```

If the repo uses root-level task runners in CI, also run the root CI-equivalent command after package-local tests.

## Final acceptance criteria

The change is accepted only when all are true:

- Automated tests prove tmux worker launch payloads do not contain `--mode json`.
- Automated tests prove tmux worker launch scripts are direct shell execs, not JSON renderer wrappers.
- Fake tmux e2e completes a team run using a worker fixture that emits plain text only.
- Team result summaries include plain worker output without JSON `agent_end`/`message_end` events.
- Visible pane logs and captured pane history contain no raw JSON event envelopes for standard worker output.
- Native backend tests still pass and still use JSON mode where appropriate.
- Failure and abort tests still produce useful errors and do not misreport interrupted work as success.
- Successful tmux cleanup and failed-run debug retention policies are unchanged.
- A real manual tmux run confirms panes appear like direct `pi` CLI worker sessions and the original session remains the orchestrator.
