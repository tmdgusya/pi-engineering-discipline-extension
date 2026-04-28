# Coordinated Team Implementation Plan: Readable pi CLI-style tmux Workers

Date: 2026-04-28
Owner lane: worker-2 planner
Source spec: `/Users/lit/.pi/agent/git/github.com/tmdgusya/roach-pi/.omx/specs/deep-interview-teammode-pi-cli-workers.md`
Status: implementation plan only; no code changes in this lane.

## Scope and intent

Make `/team` tmux worker panes readable, pi CLI-style, while preserving the orchestrator's reliable structured result collection and final synthesis.

This plan targets the existing roach-pi lightweight team mode, not a rewrite of the orchestration stack. The current implementation already has:

- Team backend selection in `extensions/agentic-harness/team.ts` with `backend: "auto" | "native" | "tmux"`.
- Tmux pane allocation and pipe-pane logging in `extensions/agentic-harness/tmux.ts`.
- Worker process execution in `extensions/agentic-harness/subagent.ts`.
- JSON event parsing via `processPiJsonLine` in `extensions/agentic-harness/runner-events.ts`.
- Tests for tmux pane creation, tmux launch command quoting, tmux process ownership, and team tmux e2e behavior under `extensions/agentic-harness/tests/`.

The current source of the bad UX is that `buildPiArgs()` always launches worker pi processes with `--mode json`; in tmux mode that same stdout stream is visible in the worker pane and is also used by `runAgent()` to detect messages and completion.

## Decision principles

1. **Separate human display from machine events.** Keep structured JSON for orchestration, but stop showing it as the primary tmux pane UI.
2. **Do not regress native backend.** The existing native JSON subprocess backend should keep reading JSON from stdout directly.
3. **Keep tmux failure debugging strong.** Pane logs should remain useful for humans; raw event logs should remain available for orchestrator diagnostics.
4. **No new dependencies.** Rendering and side-channel plumbing can be implemented with Node/TypeScript and existing helpers.
5. **Small reversible increments.** Add a tmux-only adapter rather than redesigning `team.ts` or replacing `runAgent()`.

## Architecture options considered

### Option A — Launch pi in normal human/TUI mode in tmux panes

Run worker panes without `--mode json` and teach the orchestrator to collect results from files, artifacts, or session transcripts.

**Pros**
- Most authentic pi CLI pane experience.
- No JSON stream in pane by construction.

**Cons**
- Highest risk to result collection because current completion semantics depend on JSON events (`message_end`, `turn_end`, `agent_end`).
- Requires a new result side-channel or artifact protocol before final synthesis can be trusted.
- More likely to diverge from native backend behavior.

**Verdict:** Reject for first implementation. Keep as a future improvement only if pi exposes an official structured side-channel independent of stdout.

### Option B — Keep JSON mode, add a tmux-only display adapter with an event side-channel

Run the same JSON-mode worker command, but in tmux mode wrap it with an adapter that:

1. reads the worker's raw stdout line by line;
2. appends every raw JSON/event line to a machine-readable event log;
3. renders recognized events into readable pane text;
4. passes stderr and non-JSON lines through in a human-readable way;
5. writes a tmux exit marker to the machine event log so `runAgent()` can still detect process exit robustly.

`runAgent()` polls the raw event log for orchestration, while `tmux pipe-pane` continues capturing visible pane output for human debugging.

**Pros**
- Preserves current JSON event semantics and `processPiJsonLine()` result parsing.
- Directly fixes the visible-pane UX.
- Tmux-only change; native backend remains untouched.
- Easy to test with the existing fake-tmux harness.

**Cons**
- Adds wrapper complexity to the tmux path.
- Must carefully avoid leaking sensitive env values in tmux `send-keys` payloads.
- Must define a minimal renderer that is useful without becoming a full TUI clone.

**Verdict:** Recommended MVP architecture.

### Option C — Keep JSON worker pane hidden and open a second readable mirror pane per worker

Leave the current worker pane as the machine stream, and add another pane/process that tails and renders it for humans.

**Pros**
- Minimal impact on current parser path.
- Easy to compare raw and rendered output while debugging.

**Cons**
- Doubles pane count and worsens team-mode readability.
- Leaves raw JSON visible somewhere in the user's tmux layout, conflicting with the clarified acceptance criteria.
- More tmux lifecycle cleanup complexity.

**Verdict:** Reject for default behavior. May be useful as an opt-in debug mode later.

### Option D — Render JSON after the run only

Keep live panes as-is and only improve final summaries/log files.

**Pros**
- Low implementation risk.

**Cons**
- Does not meet the spec: the live teammate panes must be readable during `/team`.

**Verdict:** Reject.

## Recommended design

Implement **Option B: tmux-only split-stream adapter**.

### Data flow

```text
team.ts
  createWorkerPanes()
    -> tmux pane metadata: visiblePaneLogFile, optional eventLogFile
  runTask(... executionMode="tmux", tmuxPane=metadata)

subagent.ts tmux branch
  resolved sandbox command still invokes pi --mode json
  generated launch wrapper runs the command
    raw stdout line -> append to eventLogFile
    raw stdout line -> render to pane stdout
    stderr          -> pane stderr/stdout and diagnostic log behavior
    process exit    -> append __PI_TMUX_EXIT:<code> to eventLogFile
  runAgent polls eventLogFile with processPiJsonLine()
  pipe-pane captures readable pane output to visiblePaneLogFile
```

### Minimal renderer behavior

Add pure renderer helpers, likely in `runner-events.ts` or a small new module such as `runner-render.ts`:

- `message_end` / `turn_end`: render assistant text content, preserving readable paragraphs and truncating only if a conservative line is extremely large.
- `agent_end`: render a short completion line such as `✓ worker completed` after any final assistant content has been shown.
- unknown valid JSON event: render either nothing or a compact progress line; do not dump raw JSON by default.
- invalid non-empty line: pass through as text because it may be useful command output or diagnostics.
- stderr: pass through with no JSON parsing requirement.

Avoid a full TUI clone in the first pass. The acceptance target is readable conversation/progress, not pixel-perfect parity with interactive pi.

### Metadata naming

Keep the current `TeamTerminalMetadata.logFile` as the **visible pane log** for backward compatibility with docs and summaries. Add one explicit machine field:

- `eventLogFile?: string` or `rawEventLogFile?: string`

Then teach `runAgent()` tmux mode to poll `eventLogFile ?? logFile`. This keeps old tests and external consumers stable while making new tmux runs split the streams.

### Failure handling

- On non-zero exit, use visible pane log tail for human-readable failure text first.
- Preserve raw event log path in terminal metadata or artifact refs so debugging can inspect machine events.
- Failed tmux runs should continue to leave panes/sessions alive as current docs state.
- Successful tmux cleanup policy should remain unchanged.

## Staged implementation plan

### M0 — Baseline and contract guards

**Goal:** Lock current tmux/team contracts before changing stream behavior.

**Likely files**
- `extensions/agentic-harness/tests/tmux.test.ts`
- `extensions/agentic-harness/tests/subagent-process.test.ts`
- `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`
- `extensions/agentic-harness/tests/extension.test.ts`

**Tasks**
1. Add or confirm a regression assertion that `backend: "native"` still parses JSON stdout directly.
2. Add a tmux metadata assertion that existing `logFile` remains present in `TeamTerminalMetadata`.
3. Add a failing characterization test for the desired new behavior: tmux visible pane log should not contain raw JSON event lines for a normal successful worker, while the orchestrator still completes successfully.

**Acceptance criteria**
- Tests describe the intended stream split before the implementation lands.
- Existing tmux lifecycle/cleanup expectations remain explicit.

### M1 — Add pure event-to-readable rendering helpers

**Goal:** Make rendering deterministic and easy to unit-test outside tmux.

**Likely files**
- `extensions/agentic-harness/runner-events.ts` or new `extensions/agentic-harness/runner-render.ts`
- `extensions/agentic-harness/tests/runner-events.test.ts` or new `runner-render.test.ts`

**Tasks**
1. Implement a pure helper such as `renderPiJsonLineForPane(line: string): string[]` or `renderPiEventForPane(event: unknown): string[]`.
2. Reuse existing assistant-message content extraction patterns where possible; do not duplicate large parsing logic unnecessarily.
3. Unit-test assistant messages, agent completion, unknown JSON event suppression/compaction, and invalid line pass-through.

**Acceptance criteria**
- Representative JSON events render to readable text without exposing raw event envelopes.
- Unknown/invalid output remains diagnosable.
- No dependencies are added.

### M2 — Split tmux visible log from raw event log in `runAgent()`

**Goal:** Preserve machine-readable result collection while changing what the pane displays.

**Likely files**
- `extensions/agentic-harness/subagent.ts`
- `extensions/agentic-harness/types.ts` if terminal metadata types are centralized there later
- `extensions/agentic-harness/tests/subagent-process.test.ts`
- `extensions/agentic-harness/tests/tmux-command.test.ts`

**Tasks**
1. Extend tmux pane metadata accepted by `runAgent()` with `eventLogFile?: string`.
2. In the tmux branch, create/truncate `eventLogFile` separately from `tmuxPane.logFile`.
3. Generate a wrapper script that runs the resolved sandbox command and writes raw stdout lines plus the exit marker to `eventLogFile`.
4. Make the wrapper print rendered human-readable lines to pane stdout.
5. Change the tmux polling loop to read `eventLogFile` instead of the visible pipe-pane log when present.
6. Keep `buildTmuxShellCommand()` control-character and secret-leak protections intact.

**Acceptance criteria**
- `runAgent()` can complete a tmux worker from raw event-log JSON while the pane log contains readable text.
- Stale exit marker protection still applies to the event log.
- Non-zero tmux failures still include useful human-readable tail text.
- Existing tests for no duplicated tee writes, custom tmux binary, lifecycle events, abort behavior, and send-keys payload safety pass.

### M3 — Thread event-log metadata through team tmux panes

**Goal:** Make `team.ts` allocate and report both visible and machine logs per worker without changing native backend semantics.

**Likely files**
- `extensions/agentic-harness/tmux.ts`
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/tests/tmux.test.ts`
- `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`

**Tasks**
1. Extend `TmuxPaneRef` and `TeamTerminalMetadata` with `eventLogFile`/`rawEventLogFile`.
2. In `createWorkerPanes()`, keep `task-N.log` as the visible pane log and add a sibling machine log, e.g. `task-N.events.jsonl`.
3. Pass the machine log through `team.ts` into `runTask()`/`runAgent()`.
4. Include the event log path in task terminal metadata or artifact refs for post-failure inspection.

**Acceptance criteria**
- Team tmux e2e succeeds with `summary.backendUsed === "tmux"` and completed task status.
- Visible `task-N.log` does not contain raw `{"type":"message_end"...}` / `{"type":"agent_end"...}` lines for standard events.
- Machine `task-N.events.jsonl` contains the raw JSON events and exit marker used by the orchestrator.
- Native backend and `backend: "auto"` fallback behavior are unchanged.

### M4 — Documentation and operator-facing behavior

**Goal:** Document the new tmux behavior precisely so users and future agents know where to look.

**Likely files**
- `extensions/agentic-harness/README.md`
- Optional review note under `docs/engineering-discipline/reviews/`

**Tasks**
1. Update the team mode README section: tmux panes display readable worker progress; raw machine events are stored in per-task event logs.
2. Keep existing cleanup policy language: successful tmux runs clean up; failed runs leave panes/sessions for debugging.
3. Add a short troubleshooting note: inspect visible pane log first, raw event log second.

**Acceptance criteria**
- Docs no longer imply the tmux pane itself is the raw JSON stream.
- Docs name both visible pane logs and raw event logs.
- No duplicated or contradictory team-mode docs are introduced.

### M5 — End-to-end verification and release gate

**Goal:** Prove the feature works and does not regress orchestration.

**Likely commands**
- `cd extensions/agentic-harness && npm test`
- `cd extensions/agentic-harness && npm run build`
- If no lint script exists, record `lint: unavailable (no script)` rather than inventing one.

**Acceptance criteria**
- Full test suite passes.
- Typecheck passes.
- Focused tmux tests prove both conditions at once:
  1. worker pane/log is readable, not raw JSON;
  2. orchestrator still detects worker completion and synthesizes final team result.

## Test strategy details

### Unit tests

- Renderer tests for message text, completion markers, unknown events, invalid lines, and multiline text.
- Shell command tests continue asserting no raw control bytes and no secret env leakage in `send-keys` payloads.
- Metadata tests assert `logFile` and `eventLogFile` paths are stable and shell-quoted safely.

### Integration tests with fake tmux

Extend the existing fake tmux strategy in `team-e2e-tmux.test.ts` and `subagent-process.test.ts`:

- Fake worker emits JSON `message_end` and `agent_end` events.
- Fake tmux captures pane-visible output to `task-1.log`.
- Test asserts `task-1.log` contains readable assistant text and does not contain raw JSON event envelopes.
- Test asserts `task-1.events.jsonl` contains raw JSON and `__PI_TMUX_EXIT:0`.
- Test asserts `summary.success === true` and the final synthesis includes the worker result.

### Regression tests

- Native backend still reads stdout JSON directly and does not require event logs.
- Forced `backend: "tmux"` still fails clearly if tmux pane setup fails.
- Failure tail extraction uses readable pane output, not raw JSON unless the event log is the only available source.
- Current-tmux-window placement still creates readable split panes and cleans them up after successful runs.

## Implementation lane allocation

### Lane A — Executor: tmux stream split and adapter

**Owner:** executor

**Write scope**
- `extensions/agentic-harness/subagent.ts`
- Optional new renderer module under `extensions/agentic-harness/`

**Responsibilities**
- Implement wrapper/event-log plumbing.
- Preserve sandbox resolution and launch-script cleanup.
- Keep native backend untouched.

### Lane B — Executor or test-engineer: tmux/team metadata threading

**Owner:** executor with test-engineer review

**Write scope**
- `extensions/agentic-harness/tmux.ts`
- `extensions/agentic-harness/team.ts`
- Related type definitions if needed

**Responsibilities**
- Allocate event log paths per worker.
- Thread metadata through `TeamTerminalMetadata` and `runTask()`.
- Preserve current attach/cleanup/session-collision behavior.

### Lane C — Test-engineer: focused tests and regression coverage

**Owner:** test-engineer

**Write scope**
- `extensions/agentic-harness/tests/runner-events.test.ts` or `runner-render.test.ts`
- `extensions/agentic-harness/tests/subagent-process.test.ts`
- `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`
- `extensions/agentic-harness/tests/tmux.test.ts`

**Responsibilities**
- Add failing-first tests for readable pane logs plus raw event logs.
- Preserve existing tmux safety tests.
- Run focused tests during implementation and full suite at the end.

### Lane D — Writer/verifier: docs and release readiness

**Owner:** writer + verifier

**Write scope**
- `extensions/agentic-harness/README.md`
- Optional review evidence document under `docs/engineering-discipline/reviews/`

**Responsibilities**
- Document operator-visible behavior and debugging paths.
- Verify test/build evidence and known gaps.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Wrapper deadlocks on stdout/stderr handling | Worker hangs | Use line-oriented Node wrapper or carefully tested shell/Node script; add timeout-aware fake-tmux tests. |
| Raw JSON accidentally remains visible | Acceptance failure | Assert visible pane log excludes standard raw JSON event envelopes. |
| Orchestrator misses completion | Broken final synthesis | Poll raw event log and keep exit marker there; test `agent_end` and exit marker paths. |
| Secrets leak through tmux command payload | Security regression | Keep existing launch-script indirection and tests that `send-keys` payload excludes secret env values. |
| Renderer overproduces noisy output | Poor UX | Start with assistant text + compact completion/progress lines; suppress unknown event envelopes. |
| Failure diagnostics get worse | Harder debugging | Keep visible pane log, raw event log, and existing failed-run tmux session retention. |

## Recommended execution order

1. Lane C writes/updates characterization tests for the target behavior.
2. Lane A implements renderer + event side-channel in `runAgent()` tmux mode.
3. Lane B threads `eventLogFile` through tmux/team metadata.
4. Lane C completes focused tmux integration/regression tests.
5. Lane D updates docs.
6. Verifier runs full `npm test` and `npm run build` from `extensions/agentic-harness` and records no-lint-script status if unchanged.

## Definition of done

- `/team backend=tmux` workers show readable pane output during execution.
- Raw JSON event lines are not the visible pane experience for standard worker messages.
- Orchestrator still collects worker messages, detects success/failure, and produces the final team synthesis.
- Raw event logs remain available for debugging.
- Native backend behavior is unchanged.
- Full test and typecheck pass.
