# Teammode normal pi CLI workers: implementation and verification plan

Date: 2026-04-28  
Owner lane: worker-1 / planner  
Task: planning/review only; no production code edits in this lane.

## Executive decision

Implement teammode tmux workers as **actual normal pi CLI sessions in worker panes**. Do not keep the current JSON-mode worker invocation and do not satisfy the requirement with a JSON-to-readable wrapper.

The orchestrator must stop depending on the worker pane stdout as the structured result stream when the backend is tmux. Instead, tmux workers should use:

1. **visible pane process:** `pi ...` with the same user-facing CLI mode used by directly running pi, i.e. no `--mode json`;
2. **durable sidecar output contract:** an explicit per-task final-output file and progress/status metadata written under the existing run artifact area;
3. **tmux exit marker/status side-channel:** existing tmux command wrapper records process exit reliably without requiring JSON event parsing from pane output;
4. **fallback transcript capture:** pipe-pane logs remain human-readable and can be used for failure tails, not for primary success synthesis.

This is a stronger design than the checkpoint patch at:

`/Users/lit/.pi/agent/git/github.com/tmdgusya/roach-pi/.omx/checkpoints/teammode-cli-pane-before-team-20260428T054548Z.patch`

That patch moves in the right direction by omitting `--mode json` for some tmux launches and hydrating from pane logs, but it still needs a first-class final-output side-channel; otherwise final result collection depends on scraping human CLI text and can become brittle.

## Repository evidence

Inspected files and current behavior:

- `extensions/agentic-harness/subagent.ts`
  - `buildPiArgs()` currently always prepends `--mode json`.
  - tmux mode builds a shell launch script, sends it into the pane, polls logs, and parses JSON lines with `processPiJsonLine()`.
  - `buildTmuxLaunchScript()` currently wraps event logs through a readable renderer when `eventLogFile` exists, which is explicitly not enough for the new user constraint because the pane is still backed by `pi --mode json`.
  - artifact support already exists through `PI_SUBAGENT_OUTPUT_FILE`, `PI_SUBAGENT_PROGRESS_FILE`, and task instructions, but teammode does not yet use it as the primary tmux result contract.
- `extensions/agentic-harness/index.ts`
  - maps tmux-backed team tasks to `runAgent({ executionMode: "tmux", tmuxPane })`.
  - currently does not pass `eventLogFile` from team task terminal metadata into `runAgent()` in this worktree; the checkpoint patch adds that, but the new plan should not require a JSON event log for normal tmux workers.
- `extensions/agentic-harness/team.ts`
  - resolves backend `auto | native | tmux`, creates worker panes, records task metadata, and synthesizes results from `SingleResult`.
  - `runtime.runTask()` is the right seam for tmux-specific output-file wiring; the orchestrator role stays in the initial session.
- `extensions/agentic-harness/tmux.ts`
  - creates/splits panes and captures visible output with `pipe-pane` to `task-N.log`.
  - already creates `task-N.events.jsonl`; for the new design this can either be retired for tmux normal CLI mode or repurposed into a small structured status/exit log, but it must not imply worker stdout is JSON.
- `extensions/agentic-harness/runner-events.ts`
  - parses JSON events and renders JSON lines for pane readability.
  - keep this path for native/JSON subprocess execution; do not make it the tmux worker UX path.
- Tests present under `extensions/agentic-harness/tests/` cover tmux command quoting, fake tmux process execution, team tmux e2e, terminal metadata, and JSON event parsing.

## Required code changes

### 1. Split worker launch mode by execution backend

**Files**
- `extensions/agentic-harness/subagent.ts`
- focused tests in `extensions/agentic-harness/tests/subagent-process.test.ts`
- focused tests in `extensions/agentic-harness/tests/team-e2e-tmux.test.ts`

**Plan**
- Change `buildPiArgs()` to accept an output/session mode parameter, e.g.:
  - native/default: keep `["--mode", "json"]`;
  - tmux CLI pane: omit `--mode json`.
- In `runAgent()`, choose the mode by backend:
  - `executionMode === "native"` => JSON mode, existing parser;
  - `executionMode === "tmux"` => normal CLI mode, no JSON renderer wrapper.
- Preserve inherited model, thinking, tools, `--append-system-prompt`, `--fork`/`--no-session`, sandbox, worktree, and depth environment behavior.

**Acceptance criteria**
- Fake tmux `send-keys` payload for a team worker does not contain `--mode json`.
- Native backend still includes `--mode json` and still parses `message_end` / `agent_end`.
- No code path launches a tmux worker through the JSON readable-renderer wrapper for normal teammode.

### 2. Make the tmux result contract artifact-first, not stdout-JSON-first

**Files**
- `extensions/agentic-harness/subagent.ts`
- possibly `extensions/agentic-harness/artifacts.ts`
- tests in `extensions/agentic-harness/tests/subagent-process.test.ts`

**Plan**
- For tmux execution, always create an artifact context even if the caller did not request one.
- Provide a deterministic per-run/per-task output file such as:
  - `.pi/agent/runs/<runId>/artifacts/<task-id-or-run-id>/final.md`, or reuse the existing `createArtifactContext()` layout.
- Append explicit worker instructions to `effectiveTask`:
  - write the final answer/result summary to `PI_SUBAGENT_OUTPUT_FILE` before finishing;
  - include test/verification evidence or blocker notes in that file;
  - keep progress notes in `PI_SUBAGENT_PROGRESS_FILE` when available.
- After the tmux process exits, hydrate `SingleResult.messages` from the output file first.
- If the output file is missing/empty:
  - mark the result failed when exit code is non-zero;
  - for exit code 0, use a clearly labeled fallback from readable pane log tail only if necessary, and set a diagnostic note/error message so this does not silently masquerade as structured success.

**Acceptance criteria**
- A tmux worker that writes `final.md` returns `SingleResult.messages` with that content, without any JSON event stream.
- A tmux worker that exits 0 but fails to write the output artifact is surfaced as a contract failure or explicit fallback, not an unverified success.
- Existing artifact metadata (`result.artifacts.outputFile`, `progressFile`, `artifactDir`) is populated for tmux team workers and included in task refs.

### 3. Keep tmux pane launch and exit detection reliable

**Files**
- `extensions/agentic-harness/subagent.ts`
- tests in `extensions/agentic-harness/tests/tmux-command.test.ts`
- tests in `extensions/agentic-harness/tests/subagent-process.test.ts`

**Plan**
- Keep using a generated launch script to avoid leaking secrets or huge prompts through the tmux `send-keys` command.
- Keep `buildTmuxShellCommand()` newline/control-character protections.
- Keep an explicit `__PI_TMUX_EXIT:<code>` marker written to a machine-observed log. This marker may stay in the pane log or move to a status file, but the orchestrator must not need JSON events to know the process exited.
- Ensure stderr remains visible in the pane and captured in `task-N.log`.
- On non-zero exit, use readable pane log tail for `stderr` / `errorMessage`.

**Acceptance criteria**
- Existing no-raw-control-byte tests still pass.
- Existing secret redaction test still passes (`PI_DEBUG_SECRET` absent from tmux command capture).
- Non-zero fake tmux worker failure reports a useful readable error tail.
- Stale exit marker protection remains covered.

### 4. Thread explicit tmux CLI metadata through team summaries

**Files**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/tmux.ts`
- `extensions/agentic-harness/types.ts` if shared terminal metadata needs extension
- `extensions/agentic-harness/index.ts`
- tests in `extensions/agentic-harness/tests/team.test.ts`, `tmux.test.ts`, `team-tool.test.ts`

**Plan**
- Keep `TeamTerminalMetadata.logFile` as the visible human pane log.
- Rename or document any event/status log field to avoid suggesting worker stdout is JSON. Prefer:
  - `statusLogFile?: string` for exit markers/lifecycle status; or
  - keep `eventLogFile?: string` only for native JSON-event compatibility, not for normal tmux CLI mode.
- Add an explicit `outputFile` / artifact reference in task result metadata rather than relying on terminal metadata for final content.
- Ensure `index.ts` passes all terminal metadata required by `runAgent()`.
- Keep orchestrator role unchanged: the initial session still owns `runTeam()`, task state, synthesis, cleanup, and final result collection.

**Acceptance criteria**
- Team summary includes attach command, visible pane logs, and artifact refs.
- The worker pane is described as a normal pi CLI worker, not a JSON-rendered wrapper.
- Native backend summaries remain unchanged.

### 5. Remove or quarantine the JSON pane renderer for teammode

**Files**
- `extensions/agentic-harness/subagent.ts`
- `extensions/agentic-harness/runner-events.ts`
- tests in `extensions/agentic-harness/tests/tmux-command.test.ts` and `runner-events.test.ts`

**Plan**
- Do not delete JSON parsing/rendering utilities if they are used by native subprocess mode or other tests.
- Ensure teammode tmux launch does not call `buildReadableTmuxNodeScript()` / `buildPaneRendererProgram()` for worker panes.
- If a JSON-rendered tmux debug mode is retained, gate it behind an explicit internal option and keep it off by default.

**Acceptance criteria**
- Focused tests assert absence of renderer heredoc markers such as `PI_TMUX_RENDERER` in normal tmux team worker launch scripts.
- Focused tests assert absence of `--mode json` in normal tmux team worker launches.

### 6. Documentation and migration notes

**Files**
- `extensions/agentic-harness/README.md`
- `TEAM_ARCH.md`
- optional release/review note under project docs if this repo uses one

**Plan**
- Document that teammode has two execution contracts:
  - native workers: JSON subprocess mode for machine orchestration;
  - tmux workers: visible normal pi CLI panes plus artifact/status side-channels.
- Document where to inspect:
  - visible pane logs: `task-N.log`;
  - final worker output: artifact `final.md` / output file;
  - status/exit log: status/event log if retained.
- Document manual tmux smoke verification.

**Acceptance criteria**
- Docs align with actual behavior and no longer describe tmux panes as raw JSON streams or JSON-rendered wrappers.
- Debugging paths are clear for failed team runs.

## Migration risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Normal pi CLI does not reliably write the final output artifact | Orchestrator loses final summaries | Inject explicit task instructions, verify artifact after exit, fail loudly on missing artifact, keep pane-log fallback labeled. |
| Removing JSON events from tmux breaks token/model/usage accounting | Summary loses usage details for tmux backend | Accept reduced usage metadata for tmux CLI mode unless pi exposes an official side-channel; keep native mode unchanged. |
| CLI output includes control sequences / TUI redraws in logs | Fallback pane-log summaries may be noisy | Do not use pane log as primary result; filter only for failure tails. |
| Worker exits before writing output file | False success | Contract test: exit 0 + missing output becomes failed/contract-error or explicit fallback with warning. |
| Secret values leak through tmux command | Security regression | Keep launch-script indirection and existing secret tests. |
| Backend behavior diverges too much | Maintenance risk | Keep backend split local to `runAgent()` and `runtime.runTask()`; native path remains JSON parser. |
| Current checkpoint patch hydrates from pane logs too optimistically | Brittle result collection | Replace with artifact-first hydration; pane log is fallback only. |
| Existing tests assume `eventLogFile` contains JSON events | Test churn | Update only tmux CLI-mode expectations; keep JSON event parser tests for native mode. |

## Regression tests to add or update

### Unit / focused tests

1. **`buildPiArgs()` backend mode**
   - native/default includes `--mode json`;
   - tmux CLI mode omits `--mode json`;
   - inherited args, model, tools, and system prompt are preserved.

2. **tmux launch script**
   - normal tmux team launch script contains no `PI_TMUX_RENDERER`;
   - command is still launched through a generated script;
   - exit marker is still written;
   - shell command has no raw control bytes with multiline task prompts.

3. **artifact-first hydration**
   - fake tmux process writes `PI_SUBAGENT_OUTPUT_FILE`; result final output equals file content;
   - fake tmux process exits 0 without output file; result flags contract failure or explicit fallback;
   - fake tmux process exits non-zero; result includes readable pane log tail.

4. **native JSON regression**
   - existing `processPiJsonLine()` / native `runAgent()` tests remain passing;
   - native worker still sees `--mode json`.

### Integration tests

1. **fake tmux team e2e**
   - run `runTeam({ backend: "tmux", workerCount: 1 })`;
   - fake worker simulates normal CLI output and writes final artifact;
   - summary succeeds and includes the artifact final output;
   - captured `send-keys` command does not contain `--mode json`;
   - visible `task-1.log` does not contain JSON event envelopes.

2. **current-tmux-window placement**
   - preserve split-pane creation and cleanup behavior;
   - readable pane logs remain the visible output source.

3. **failure path**
   - fake tmux worker exits with non-zero status after printing an error;
   - final task status is failed;
   - failed runs leave enough terminal metadata/log paths for debugging.

## Manual tmux verification steps

Run these after implementation in a real terminal where `tmux` and `pi` are available.

1. Start a real tmux session:
   ```bash
   tmux new -s pi-team-smoke
   ```
2. From inside the session, run a one-worker team task with tmux backend:
   ```bash
   pi
   # then invoke /team with a small deterministic goal, backend=tmux, workerCount=1
   ```
3. Observe the worker pane while it runs:
   - it should look like a normal pi CLI session;
   - it must not show raw `{"type":...}` JSON events;
   - it must not look like a simplified JSON-renderer transcript.
4. Confirm the orchestrator pane remains the orchestrator:
   - it announces tmux panes/logs;
   - it receives completion;
   - it produces a final team summary.
5. Inspect run artifacts:
   ```bash
   ls -R .pi/agent/runs/<runId>/
   cat .pi/agent/runs/<runId>/tmux/task-1.log
   cat <worker-output-file>
   ```
6. Confirm:
   - `task-1.log` is human CLI output;
   - output artifact contains the worker final answer;
   - successful runs clean up panes/sessions according to existing policy;
   - failed runs leave enough logs/panes to debug.

## Verification plan for the implementation PR

Required automated checks:

```bash
cd extensions/agentic-harness
npm test -- tests/tmux-command.test.ts tests/subagent-process.test.ts tests/team-e2e-tmux.test.ts tests/team-tool.test.ts tests/team.test.ts
npm test
npm run build
```

Lint status:

- `extensions/agentic-harness/package.json` currently has `test` and `build` scripts but no `lint` script. Record lint as `N/A: no lint script` unless a lint script is added separately.

Required manual check:

- one real tmux smoke run as described above, with screenshot/log evidence or a short transcript proving worker pane output is normal pi CLI and not JSON mode.

## Definition of done

- Worker panes launched by teammode tmux are the same kind of pi CLI sessions a user sees when directly running `pi`, not `pi --mode json`.
- Normal tmux team worker `send-keys` payloads and launch scripts contain no `--mode json` and no JSON renderer heredoc.
- The initial/orchestrator session still owns team planning, task state, result synthesis, cleanup, and final reporting.
- Result collection is reliable via artifact/status side-channels, not by scraping human pane text.
- Native/non-tmux backend continues to use JSON mode and existing structured event parsing.
- Focused tests, full tests, and typecheck pass.
- Manual tmux smoke confirms the user-visible constraint.
