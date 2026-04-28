# Coordinated Team Implementation Plan: Readable pi CLI-Style tmux Worker Panes

## Goal
Make `/team` tmux teammate panes readable like normal pi CLI worker sessions while preserving the orchestrator's reliable structured result collection and final team summary.

## Evidence From Repository Inspection
- `.omx/specs/deep-interview-teammode-pi-cli-workers.md` states the primary acceptance target: teammate tmux panes must show readable pi CLI-style progress/conversation, not raw JSON event lines, while orchestration reliability wins in any tradeoff.
- `extensions/agentic-harness/subagent.ts` currently builds worker invocations with `buildPiArgs(...)`, which always includes `--mode json`; the same process output is both visible in tmux panes and parsed by `processPiJsonLine(...)` for `SingleResult` aggregation.
- `extensions/agentic-harness/team.ts` already resolves `backend=auto|native|tmux`, creates tmux panes through `createWorkerPanes(...)`, stores `task.terminal`, and calls `runtime.runTask(...)` per worker.
- `extensions/agentic-harness/tmux.ts` already creates/splits panes, attaches `pipe-pane` log capture, returns pane/log metadata, and uses deterministic tmux attach metadata.
- `extensions/agentic-harness/runner-events.ts` parses newline-delimited JSON events into `SingleResult`; preserving this parser path is the safest way to keep orchestrator summaries reliable.
- Existing tests cover tmux setup/logging and orchestration basics (`tests/tmux.test.ts`, `tests/subagent-process.test.ts`, `tests/team.test.ts`, `tests/team-e2e-tmux.test.ts`), but do not yet assert that pane-visible output is non-JSON/readable.

## Task Classification
- Type: brownfield UX/architecture refinement.
- Complexity: HIGH, because one stream currently serves two consumers: human-readable tmux pane UI and machine-readable orchestration events.
- Implementation shape: staged refactor behind tmux backend paths; native backend should remain JSON-driven and unchanged.

## Architecture Options Compared

### Option A — Switch tmux workers from `--mode json` to normal pi mode and parse human text
- **How it works:** remove `--mode json` for tmux, then infer completion/final output from plain pane logs.
- **Pros:** teammate panes become readable immediately; minimal tmux-pane UI work.
- **Cons:** breaks or weakens structured `SingleResult` collection; final summaries become heuristic; failure detection becomes less deterministic.
- **Verdict:** Reject. It violates the spec's `preserve-orchestration` priority.

### Option B — Keep `--mode json`, but add a pane-output filter/pretty-printer process
- **How it works:** continue running worker pi in JSON mode, route stdout through a formatter that prints readable status to the pane while also teeing raw JSON to a side-channel log for the orchestrator.
- **Pros:** preserves existing JSON event contract and result parser; limits changes to tmux execution path; can be tested with fake runner/logs; no new dependencies required.
- **Cons:** needs careful stream routing to avoid leaking raw JSON into visible panes; formatter must handle partial lines and malformed lines; terminal output will be “pi-style/readable” rather than literally the native pi TUI.
- **Verdict:** Recommended first implementation. It best satisfies readable panes and reliable orchestration with minimal architectural churn.

### Option C — Dual-run/sidecar: one interactive pi CLI pane plus a separate hidden JSON worker
- **How it works:** launch a normal pi CLI worker for visible pane UX and a separate JSON-mode worker for orchestration.
- **Pros:** maximum visual fidelity for panes while preserving JSON parser for the hidden run.
- **Cons:** doubles worker execution/cost, creates divergence between visible and collected results, complicates cancellation, worktree writes, and side effects.
- **Verdict:** Reject for first pass. Too risky and wasteful for team workers that may modify files.

### Option D — Extend pi CLI with a first-class split-stream mode
- **How it works:** add/consume a pi mode that emits human UI to stdout and structured events to a file descriptor/path.
- **Pros:** clean long-term architecture if upstream pi supports it.
- **Cons:** likely outside this repo's extension boundary and not evidenced in current code; would require external API/version research.
- **Verdict:** Defer. Track as future upstream integration if Option B proves insufficient.

## Recommended Architecture
Adopt **Option B: tmux-only JSON side-channel with human-readable pane renderer**.

For tmux execution only:
1. Keep worker invocation in `--mode json` so existing `runner-events.ts` and `SingleResult` aggregation remain authoritative.
2. Add a small local Node renderer script/module that reads JSON-mode stdout line-by-line and writes concise readable progress to the tmux pane.
3. Tee the unmodified JSON event stream to a machine-readable event log separate from the human pane log.
4. Change tmux log polling in `runAgent(... executionMode: "tmux")` to parse the raw JSON side-channel log, not the pane-visible `pipe-pane` log.
5. Preserve the existing `pipe-pane` log as human/debug output and retain terminal metadata in summaries.

Suggested stream layout:
- `tmuxPane.logFile`: visible/debug pane transcript captured by tmux `pipe-pane`; should be readable and not raw event spam.
- `tmuxPane.eventLogFile` or derived path next to `logFile` (for example `task-1.events.ndjson`): raw JSON events consumed by orchestrator parser.
- exit marker: keep in the pane transcript for current polling only if needed, or move to a separate status marker file if raw JSON side-channel polling becomes authoritative. Prefer a separate marker/status file for clean pane UX if feasible in the same pass.

## Staged Implementation Plan

### Stage 1 — Lock the readable-pane contract with failing tests
**Owner lane:** test-engineer
**Files:**
- `extensions/agentic-harness/tests/subagent-process.test.ts`
- `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`
- possibly `extensions/agentic-harness/tests/tmux.test.ts`

**Tasks:**
1. Add a focused tmux `runAgent` test with a fake pi worker that emits JSON events. Assert:
   - `SingleResult.messages` still contains the final assistant message.
   - the pane-visible/log transcript does not contain raw JSON event lines such as `{"type":"message_end"...}`.
   - the pane-visible/log transcript contains readable text derived from assistant output or lifecycle progress.
2. Extend the tmux team e2e test to assert final `TeamRunSummary` still completes and the captured pane log includes readable worker output.
3. Add a regression case for malformed/non-JSON stdout lines to ensure the renderer passes or reports them usefully without breaking event parsing.

**Acceptance criteria:** tests fail on current `--mode json` pane behavior and express the new UX contract without requiring real tmux.

### Stage 2 — Add a tmux worker stream renderer and side-channel event log
**Owner lane:** executor
**Files:**
- create `extensions/agentic-harness/tmux-renderer.ts` or equivalent helper in `subagent.ts` if small
- modify `extensions/agentic-harness/subagent.ts`
- modify `extensions/agentic-harness/types.ts` if terminal metadata needs `eventLogFile`
- tests from Stage 1

**Tasks:**
1. Introduce a formatter that maps JSON events to readable pane lines. Minimum useful rendering:
   - `message_end` / `turn_end`: print the assistant text content in a readable block or prefixed line.
   - `agent_end`: print a concise completion line.
   - unknown events: suppress or compactly label; do not print raw JSON by default.
   - non-JSON lines/stderr: pass through so failures remain diagnosable.
2. Add a raw JSON side-channel file path per tmux invocation, preferably derived from `tmuxPane.logFile` (`task-1.events.ndjson`) and persisted in terminal metadata if useful for debugging.
3. Update tmux launch script generation so worker stdout is split:
   - raw stdout JSON is written to the event log unchanged.
   - readable rendered output goes to pane stdout/stderr, which `pipe-pane` captures into `tmuxPane.logFile`.
4. Keep secrets out of `send-keys`: continue using the existing temporary launch script pattern instead of embedding full env/args directly in tmux command text.

**Acceptance criteria:** tmux pane transcript is readable, raw JSON side-channel exists for parsing, and send-keys payload does not include sensitive env values.

### Stage 3 — Move tmux orchestration parsing to the raw event side-channel
**Owner lane:** executor
**Files:**
- `extensions/agentic-harness/subagent.ts`
- `extensions/agentic-harness/types.ts` if needed
- `extensions/agentic-harness/tests/subagent-process.test.ts`

**Tasks:**
1. In tmux mode, poll/read the event log for `processPiJsonLine(...)` instead of the human pane log.
2. Keep offset-based incremental reads and existing `agent_end` semantic reap behavior.
3. Separate completion detection from human pane content. Recommended:
   - keep `TMUX_EXIT_MARKER` in a dedicated exit/status file, or
   - write the marker to the event side-channel as a non-JSON sentinel, not the readable pane transcript.
4. Update failure-tail logic to prefer readable pane log tail for human diagnostics, while parsing structured results from the side-channel.

**Acceptance criteria:** orchestrator still detects success/failure and final assistant output from JSON events; pane log stays readable; failures include useful human-readable tail text.

### Stage 4 — Team integration and metadata polish
**Owner lane:** executor + planner/reviewer
**Files:**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/tmux.ts`
- `extensions/agentic-harness/types.ts`
- `extensions/agentic-harness/README.md`
- `TEAM_ARCH.md` if public architecture docs need updating

**Tasks:**
1. Propagate any new terminal metadata (`eventLogFile`, `paneLogFile`, or status file) in `TeamTerminalMetadata`/`TerminalMetadata` without breaking native backend metadata.
2. Ensure `synthesizeTeamRun(...)` and final summaries still show attach commands and useful log paths.
3. Document that tmux backend uses readable pane rendering while retaining raw JSON event side-channel for orchestration.
4. Confirm backend semantics remain unchanged: `auto` still prefers tmux when available, `native` stays raw JSON parser path, `tmux` explicitly uses the readable-pane side-channel design.

**Acceptance criteria:** summaries remain useful, metadata remains backward-compatible, and docs explain debug locations.

### Stage 5 — Verification and release hardening
**Owner lane:** verifier/build-fixer
**Files:** no planned source edits unless tests reveal issues.

**Tasks:**
1. Run focused tests:
   - `cd extensions/agentic-harness && npm test -- --run tests/subagent-process.test.ts tests/tmux.test.ts tests/team.test.ts tests/team-e2e-tmux.test.ts`
2. Run full package verification:
   - `cd extensions/agentic-harness && npm run build && npm test`
3. Manually or with fake tmux evidence, verify:
   - pane-visible transcript is readable/non-JSON.
   - raw event side-channel contains parseable JSON events.
   - final team summary reports worker completion.
   - failure case preserves readable diagnostic output.
4. If a real tmux smoke test is available locally, run one small `/team backend=tmux workerCount=1` style scenario and capture pane/log evidence.

**Acceptance criteria:** all targeted and full tests pass; at least one smoke/e2e path proves readable pane output plus final summary.

## Implementation Lanes
- **Lane A — Contract/tests (test-engineer):** own Stage 1 and verification assertions. Do not modify production behavior except test fixtures.
- **Lane B — Stream rendering/runtime (executor):** own Stage 2 and Stage 3 in `subagent.ts` plus helper module.
- **Lane C — Team metadata/docs (executor/writer):** own Stage 4 public metadata and docs.
- **Lane D — Verification (verifier/build-fixer):** own Stage 5, diagnose build/test failures, and ensure native backend regression safety.

## Risk Register
1. **Raw JSON leaks into panes.** Mitigate with tests that inspect pane logs and with renderer default suppressing raw event lines.
2. **Orchestrator loses final result.** Mitigate by keeping `--mode json` and `processPiJsonLine(...)` authoritative on the event side-channel.
3. **Exit marker contaminates readable UX.** Prefer separate status/exit file or event side-channel sentinel; assert pane log stays clean enough.
4. **Renderer hides useful failure output.** Pass through stderr/non-JSON lines and use readable pane log tail for `stderr`/`errorMessage` on failure.
5. **Shell quoting or secret leakage regression.** Preserve launch-script strategy and existing secret assertions in tmux tests.
6. **Native backend regression.** Keep changes gated to `executionMode === "tmux"`; run native subagent/team tests.
7. **Large output/performance issues.** Keep offset-based reads; cap rendered snippets and failure tails.

## Non-goals for This Plan
- Do not replace the team orchestrator model.
- Do not make worker panes fully interactive/manual-control sessions unless a later requirement asks for it.
- Do not add dependencies.
- Do not change native backend output semantics.

## Completion Definition
The work is complete when a tmux-backed team run displays readable pi-style worker progress in teammate panes, the leader/orchestrator still produces structured final summaries from worker JSON events, failures remain diagnosable from logs/panes, and the full `extensions/agentic-harness` build/test suite passes.
