# Team Mode Pi-CLI Worker Panes: Implementation Plan

Date: 2026-04-28  
Owner lane: worker-3 / planner  
Source spec: `/Users/lit/.pi/agent/git/github.com/tmdgusya/roach-pi/.omx/specs/deep-interview-teammode-pi-cli-workers.md`  
Task: plan only; no production code implementation in this lane.

## Scope and classification

- **Task type:** refactor / UX-observability enhancement for existing team-mode tmux backend.
- **Primary goal:** teammate tmux panes should be readable pi CLI-style worker sessions, not raw JSON event streams.
- **Non-negotiable constraint:** preserve orchestrator completion/result collection and final team summary reliability.
- **Estimated complexity:** MEDIUM-HIGH because the visible terminal stream is currently also the machine-readable event stream.

## Repository evidence baseline

- `extensions/agentic-harness/subagent.ts:165-172` always builds delegated worker invocations with `--mode json`.
- `extensions/agentic-harness/subagent.ts:550-650` runs tmux workers by sending a shell command into a pane and then parsing lines from the pane log with `processPiJsonLine`.
- `extensions/agentic-harness/subagent.ts:644-650` treats the same tmux log as both the exit-marker channel and JSON event source.
- `extensions/agentic-harness/runner-events.ts:84-112` is the current structured event parser for `message_end`, `turn_end`, and `agent_end` JSON events.
- `extensions/agentic-harness/tmux.ts:145-243` creates worker panes and pipes pane output to `task-N.log`; this log is currently what users see and what the orchestrator polls.
- `extensions/agentic-harness/team.ts:371-399` assigns tmux pane metadata to tasks and emits attach/log details before worker execution.
- `extensions/agentic-harness/index.ts:356-379` maps tmux-backed tasks to `runAgent({ executionMode: "tmux", tmuxPane })`.
- Existing tests already cover tmux command quoting, tmux pane creation, tmux process lifecycle, resolved tmux binary usage, and a fake tmux team e2e path under `extensions/agentic-harness/tests/`.

## Architecture options compared

### Option A — Run workers in normal/non-JSON pi mode and scrape human output

**Shape:** For tmux backend only, remove `--mode json` and let worker panes show the default pi CLI output. Infer completion and summary from process exit plus readable stdout.

**Pros**
- Best immediate pane readability.
- Small apparent code change in argument construction.

**Cons**
- Breaks current structured parsing contract in `runner-events.ts`.
- Makes `agent_end` / assistant final-output detection unreliable.
- Hard to preserve usage/model/error metadata.
- Tmux pane UI changes could silently break orchestration.

**Decision:** reject for implementation. It optimizes the pane at the expense of the clarified reliability constraint.

### Option B — Keep JSON workers and add a pane beautifier/filter over the same stream

**Shape:** Continue launching `pi --mode json`, but pipe stdout through a renderer that transforms JSON events into readable text before the stream reaches the tmux pane and pane log.

**Pros**
- Keeps JSON as the source event format.
- Moderate implementation size.
- Visible pane becomes readable.

**Cons**
- If the renderer replaces stdout, the orchestrator can no longer parse the pane log as raw JSON.
- If the renderer merely adds readable lines around JSON, pane readability remains poor and parsing becomes noisier.
- Exit marker and parsing responsibilities remain coupled to one log file.

**Decision:** viable only if paired with a separate structured side-channel. By itself, do not implement.

### Option C — Dual-channel tmux launch: readable pane renderer + structured event side-channel

**Shape:** Keep the underlying worker invocation in `--mode json`. In tmux mode, wrap it with a small dependency-free adapter that:

1. reads raw JSON stdout from pi,
2. appends exact raw JSON event lines to a structured machine log,
3. renders selected events into readable CLI-style pane output,
4. preserves stderr in the visible pane/log for diagnostics,
5. records a robust exit marker in a channel the orchestrator can observe.

The orchestrator then parses the structured event log with the existing `processPiJsonLine` path and uses the readable pane log only for human diagnostics / failure tails.

**Pros**
- Preserves machine-readable event collection.
- Delivers readable tmux panes without changing native backend behavior.
- Keeps failure panes useful because stderr and readable summaries stay visible.
- Allows incremental tests with fake JSON producers; no real model process required.

**Cons**
- Requires careful process/pipe exit handling.
- Requires extending `TmuxPaneRef` / `TeamTerminalMetadata` with an event log path or equivalent.
- Adds a small renderer surface that must tolerate unknown JSON events.

**Decision:** recommended architecture.

### Option D — Two-process mirror: hidden JSON worker plus separate read-only viewer pane

**Shape:** Keep the worker running as today for orchestration and start a separate viewer process in tmux that watches the worker event log and renders it.

**Pros**
- Very strong separation between worker execution and display.
- Easier to kill/restart viewer without touching worker.

**Cons**
- Doubles pane/process coordination complexity.
- The pane is a viewer, not the worker session; this may be misleading.
- More cleanup/lifecycle edge cases.

**Decision:** keep as fallback only if Option C proves too fragile.

## Recommended design

Implement **Option C: dual-channel tmux launch**.

### Target data flow

```text
/team orchestrator
  -> runTeam(... backend="tmux")
  -> createWorkerPanes(...)
  -> runAgent(executionMode="tmux")
       -> build pi --mode json args as today
       -> launch wrapper inside tmux pane
            pi --mode json ...
              stdout(raw JSON) -> adapter
                -> append exact event line to structuredEventLogFile
                -> print readable line(s) to pane stdout
              stderr -> pane stderr/stdout for human diagnostics
            exit code -> explicit marker available to orchestrator
       -> orchestrator polls structuredEventLogFile for JSON events
       -> orchestrator detects exit marker / process completion
       -> final summary uses existing result model
```

### User-visible pane format

Start with a conservative renderer, not a full TUI clone:

- print a header: worker/task identity, cwd/worktree if known, backend/log paths;
- for assistant `message_end` / `turn_end`, render the latest assistant text with simple prefixes;
- for `agent_end`, print a completion marker and the final assistant answer if not already printed;
- for unknown events, suppress by default or render a terse progress marker only when useful;
- for non-JSON stdout, pass through visibly and mark it as non-structured;
- preserve stderr visibly.

This satisfies “readable pi CLI-style progress/conversation” while avoiding a brittle imitation of pi internals.

## Staged implementation plan

### Stage 0 — Contract and fixture lock

**Goal:** prove the current coupling and lock expected behavior before changing it.

**Implementation tasks**
1. Add tests around a pure renderer/parser boundary before touching launch code.
2. Add fixtures with representative JSON lines for `message_end`, `turn_end`, `agent_end`, unknown events, malformed lines, stderr text, and final-output duplication.
3. Assert that existing native backend behavior remains unchanged.

**Likely files**
- `extensions/agentic-harness/tests/runner-events.test.ts`
- new `extensions/agentic-harness/tests/tmux-renderer.test.ts` or equivalent
- possibly new `extensions/agentic-harness/tmux-renderer.ts`

**Acceptance criteria**
- Existing tests still pass.
- Renderer fixtures define readable output without requiring a real `pi` subprocess.
- No production launch path changes yet.

### Stage 1 — Add dependency-free JSON-to-readable renderer

**Goal:** create the adapter logic as a small, testable module.

**Implementation tasks**
1. Create a pure function/module that accepts one stdout line and returns:
   - raw structured line to persist, when JSON is valid;
   - zero or more readable pane lines;
   - parser metadata such as whether `agent_end` was observed.
2. Reuse concepts from `runner-events.ts` to avoid divergent interpretation of assistant messages.
3. Keep formatting intentionally simple and stable; do not import new UI dependencies.
4. Add tests for deduplication and malformed JSON passthrough.

**Likely files**
- new `extensions/agentic-harness/tmux-renderer.ts` or `worker-display.ts`
- `extensions/agentic-harness/tests/tmux-renderer.test.ts`

**Acceptance criteria**
- JSON event lines can be converted into readable text while retaining exact raw event lines for machine parsing.
- Unknown JSON does not crash the renderer.
- Malformed stdout remains visible for diagnostics.

### Stage 2 — Extend tmux metadata for structured side-channel logs

**Goal:** represent separate human and machine logs explicitly.

**Implementation tasks**
1. Extend `TmuxPaneRef` / `TeamTerminalMetadata` with something like `eventLogFile` or `structuredLogFile` while keeping `logFile` as the pane-visible log.
2. Generate per-task side-channel paths under the existing `.pi/agent/runs/<runId>/tmux/` directory, e.g.:
   - `task-1.log` for visible pane output;
   - `task-1.events.jsonl` for raw JSON events.
3. Persist the new metadata through `team.ts` task terminal assignment and `index.ts` `runAgent` call.
4. Maintain backward-compatible behavior when `eventLogFile` is absent.

**Likely files**
- `extensions/agentic-harness/tmux.ts`
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/types.ts`
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/tests/tmux.test.ts`
- `extensions/agentic-harness/tests/team.test.ts`

**Acceptance criteria**
- Tmux task metadata includes both visible and structured log references.
- Current attach/log notifications remain accurate and include enough information for debugging.
- Native backend remains untouched.

### Stage 3 — Wire tmux launch wrapper to split streams

**Goal:** make tmux workers visible as readable sessions while the orchestrator parses the structured log.

**Implementation tasks**
1. Update `buildTmuxLaunchScript` / tmux-mode launch generation to run the worker command through the adapter.
2. Preserve safe shell quoting and the existing regression guards in `tests/tmux-command.test.ts`.
3. Ensure raw stdout JSON is appended exactly once to `eventLogFile`; do not duplicate via `pipe-pane`.
4. Keep visible pane output readable and append the same readable pane output to `logFile` via existing `pipe-pane`.
5. Preserve stderr visibility and failure diagnostics.
6. Preserve exit code handling with `pipefail` or an equivalent explicit status path; do not let renderer success mask worker failure.

**Likely files**
- `extensions/agentic-harness/subagent.ts`
- new helper script/module if needed under `extensions/agentic-harness/`
- `extensions/agentic-harness/tests/subagent-process.test.ts`
- `extensions/agentic-harness/tests/tmux-command.test.ts`

**Acceptance criteria**
- The pane-visible log contains readable lines and no raw JSON event stream for normal JSON events.
- The structured event log contains parseable raw JSON events.
- Worker exit code is preserved even when the renderer succeeds.
- Existing command injection / newline regression tests still pass.

### Stage 4 — Move tmux orchestrator polling to structured event log

**Goal:** decouple result collection from pane-visible output.

**Implementation tasks**
1. In tmux execution mode, read new bytes from `eventLogFile` for `processPiJsonLine` instead of reading JSON from `logFile`.
2. Continue to use visible `logFile` for failure tails and diagnostics, filtering out any accidental raw JSON as today.
3. Detect completion through the existing exit marker if it remains in the visible log, or through a new structured exit-status file/marker if Stage 3 introduces one.
4. Preserve semantic reap behavior based on `agent_end` and final assistant output.

**Likely files**
- `extensions/agentic-harness/subagent.ts`
- `extensions/agentic-harness/tests/subagent-process.test.ts`
- `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`

**Acceptance criteria**
- `runAgent(executionMode="tmux")` returns the same `SingleResult` fields for successful fake runs as before.
- Failure tails still contain useful human-readable stderr/text.
- Tmux runs no longer require raw JSON to be visible in the pane.

### Stage 5 — Documentation and operator-facing release notes

**Goal:** document shipped behavior accurately once implemented.

**Implementation tasks**
1. Update `extensions/agentic-harness/README.md` tmux backend notes to state that panes show readable worker output while structured event logs remain available for orchestration/debugging.
2. Update `TEAM_ARCH.md` with the new two-log data flow and lifecycle diagram.
3. Update `CONTRIBUTING.md` team-mode checklist with the additional tmux-readable-pane verification gate.
4. Add a short verification report under `docs/engineering-discipline/reviews/` after implementation.

**Likely files**
- `extensions/agentic-harness/README.md`
- `TEAM_ARCH.md`
- `CONTRIBUTING.md`
- `docs/engineering-discipline/reviews/<date>-team-tmux-readable-panes.md`

**Acceptance criteria**
- Docs no longer imply raw pane logs are the machine event source.
- Docs distinguish `task-N.log` visible logs from structured event logs.
- Deferred/non-goal behavior remains explicit: readable panes are not a live human control channel.

### Stage 6 — End-to-end validation and release gate

**Goal:** verify the full behavior with deterministic tests plus one real tmux smoke where available.

**Implementation tasks**
1. Extend fake tmux e2e test to assert visible output is readable and structured event log is parseable.
2. Add a manual/optional smoke command for real tmux backend when available.
3. Run full extension tests and typecheck.
4. If no lint script exists, document lint as not available rather than inventing a gate.

**Verification commands**
- `cd extensions/agentic-harness && npm test -- tests/tmux-command.test.ts tests/tmux.test.ts tests/subagent-process.test.ts tests/team-e2e-tmux.test.ts`
- `cd extensions/agentic-harness && npm test`
- `cd extensions/agentic-harness && npm run build`
- Optional real smoke when tmux and pi are available: run a small `/team ... backend=tmux worker-count=1` and inspect pane output plus final summary.

**Acceptance criteria**
- Test suite passes without external model calls.
- Typecheck passes.
- Optional smoke demonstrates readable pane output and successful team final synthesis.

## Suggested implementation lanes

1. **Executor lane A — renderer + side-channel metadata**
   - Owns new renderer module, metadata types, `tmux.ts` side-channel path creation, renderer tests.
   - Suggested role: `executor` or `test-engineer` pair.
   - Reasoning: medium.

2. **Executor lane B — tmux launch/polling integration**
   - Owns `subagent.ts` stream splitting, event-log polling, exit-code preservation, process tests.
   - Suggested role: `executor` with `debugger` support if process lifecycle flakes.
   - Reasoning: high.

3. **Docs lane — user and maintainer docs**
   - Owns README / TEAM_ARCH / CONTRIBUTING updates after code behavior is proven.
   - Suggested role: `writer`.
   - Reasoning: medium.

4. **Verifier lane — independent acceptance pass**
   - Runs targeted tests, full tests, build, and optional real tmux smoke.
   - Inspects panes/logs for raw JSON leakage and structured summary reliability.
   - Suggested role: `verifier` or `test-engineer`.
   - Reasoning: high for real tmux/process validation.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Renderer masks worker exit failures | Orchestrator reports false success | Preserve explicit exit status with `pipefail`/status marker tests. |
| Structured event log and visible pane log diverge | Debugging becomes confusing | Persist both paths in task terminal metadata and summaries. |
| Raw JSON still leaks visibly | Acceptance criterion fails | Add tests asserting normal JSON events are absent from pane-visible log. |
| Unknown JSON event breaks renderer | Worker display stalls | Unknown JSON should be suppressed or rendered tersely, never throw. |
| Shell quoting regression in tmux send-keys | Worker command desyncs | Keep `tmux-command.test.ts` newline/quoting guards and add adapter-path cases. |
| Adapter adds too much formatting complexity | Maintenance burden | Start with simple line-oriented rendering; no new dependencies. |
| Real pi CLI event schema differs from fixtures | Smoke failure after unit pass | Build fixtures from current `runner-events.ts` accepted event types and run optional real smoke before release. |

## Definition of done

- Tmux worker panes show readable worker progress/conversation for normal team runs, not raw JSON event lines.
- Orchestrator still receives structured events and produces correct success/failure final summaries.
- Worker failure state and final assistant output remain detectable.
- Failure panes/logs remain useful for diagnosis.
- Native backend behavior and existing team command semantics do not regress.
- README / TEAM_ARCH / CONTRIBUTING describe the new two-channel tmux behavior accurately.
