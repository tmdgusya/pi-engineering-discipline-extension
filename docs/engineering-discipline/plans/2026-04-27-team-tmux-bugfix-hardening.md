# Team tmux Backend Bugfix Hardening Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Fix the reported tmux backend correctness, security, observability, and performance defects while preserving native team behavior and the optional tmux fallback contract.

**Architecture:** Keep the tmux backend optional and isolated behind helper/runtime boundaries. Move shell quoting to a shared helper, make tmux command execution exit-code based, propagate the resolved tmux binary, harden log/session handling, and improve tmux worker result/lifecycle reporting without changing the public `team` default behavior.

**Tech Stack:** TypeScript, Node.js child processes/filesystem APIs, tmux CLI, Vitest.

**Work Scope:**
- **In scope:** shell quoting for tmux shell commands, tmux command success handling, resolved binary propagation, stale log prevention, duplicate log writes removal, failure stderr/log tail reporting, incremental tmux log reading, lifecycle event parity, setup-failure state handling, session collision handling, and README cleanup/sandbox notes.
- **Out of scope:** embedding tmux panes inside pi TUI, full interactive keystroke routing inside pi, TTL-based tmux session garbage collection service, and non-tmux terminal multiplexer support.

**Success Criteria:**
- `pipe-pane` log commands shell-quote log paths and resist spaces/metacharacters in paths/run IDs.
- tmux command helpers treat exit code as the failure source and do not reject on stderr-only warnings.
- tmux mode uses the resolved tmux binary consistently after availability detection.
- Reused log paths cannot cause stale exit markers or duplicated log writes.
- Failed tmux workers expose useful log-tail error text instead of only `exitCode N`.
- tmux setup/session failures return a failed `TeamRunSummary` and persist failed state instead of leaving runs stuck as `running`.
- Session collisions are handled deterministically without destroying failed debug sessions by default.
- tmux log polling reads only newly appended bytes.
- tmux mode emits lifecycle/process-log events comparable to native mode.
- Existing native team/subagent behavior remains unchanged.
- Build and full test suite pass.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** strict TypeScript build, full Vitest regression suite, and focused coverage for tmux helper/runtime/team behavior.

---

## File Structure Mapping

### New files
- `extensions/agentic-harness/shell.ts` — shared shell quoting helper used by tmux and subagent runtime.
- `extensions/agentic-harness/tests/shell.test.ts` — tests for shell quoting with spaces, quotes, and shell metacharacters.

### Modified files
- `extensions/agentic-harness/tmux.ts` — quote `pipe-pane` command paths, exit-code based runner behavior, binary-aware helpers, session collision fallback, command runner typing.
- `extensions/agentic-harness/subagent.ts` — import shared shell quote, remove duplicate `tee`, truncate/stabilize tmux logs, incremental log polling, failure log-tail stderr, tmux lifecycle events, binary propagation.
- `extensions/agentic-harness/team.ts` — propagate detected tmux binary, handle tmux setup errors as failed summaries, pass binary/session metadata to workers, preserve failed sessions with collision-safe suffixes.
- `extensions/agentic-harness/types.ts` — add optional tmux binary/session attempt metadata if needed by runtime/result metadata.
- `extensions/agentic-harness/README.md` — document failed-session cleanup responsibility and sandbox parity limitations.
- `extensions/agentic-harness/tests/tmux.test.ts` — expand helper tests for shell quoting, stderr warnings, binary use, collision fallback.
- `extensions/agentic-harness/tests/subagent-process.test.ts` — expand tmux runtime tests for stale logs, incremental reads, failure stderr, lifecycle logging, duplicate log writes removal.
- `extensions/agentic-harness/tests/team.test.ts` — expand team tests for setup failure persistence, session collision retry behavior, detected binary propagation.

## Project Capability Discovery

- **Bundled agents available:** `plan-compliance`, `plan-worker`, `plan-validator`, `explorer`, `worker`, reviewer agents.
- **Relevant execution skill:** `agentic-run-plan`.
- **Verification surface:** `npm run build && npm test` in `extensions/agentic-harness`, plus focused tests in `tests/tmux.test.ts`, `tests/subagent-process.test.ts`, `tests/team.test.ts`, and `tests/shell.test.ts`.

## Task Decomposition

### Task 1: Harden tmux helper command safety and binary handling

**Dependencies:** None (must run before runtime/team integration tasks)
**Files:**
- Create: `extensions/agentic-harness/shell.ts`
- Create: `extensions/agentic-harness/tests/shell.test.ts`
- Modify: `extensions/agentic-harness/tmux.ts`
- Modify: `extensions/agentic-harness/tests/tmux.test.ts`
- Modify: `extensions/agentic-harness/subagent.ts`

- [ ] **Step 1: Add failing tests for shell quoting and tmux stderr warning handling**

Create `extensions/agentic-harness/tests/shell.test.ts` with assertions equivalent to:

```ts
import { describe, expect, it } from "vitest";
import { shellQuote } from "../shell.js";

describe("shellQuote", () => {
  it("quotes paths with spaces and shell metacharacters", () => {
    expect(shellQuote("/Users/John Doe/a;b&c`d$e.log")).toBe("'/Users/John Doe/a;b&c`d$e.log'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("/tmp/it's.log")).toBe("'/tmp/it'\\''s.log'");
  });
});
```

Extend `extensions/agentic-harness/tests/tmux.test.ts` so `createWorkerPanes(...)` with `logDir: "/tmp/John Doe/a;b"` expects `pipe-pane` command argument to contain:

```ts
"cat >> '/tmp/John Doe/a;b/task-1.log'"
```

Add a mocked runner test where `stderr` contains `"warning\n"` but callback error is `null`; expected result: command succeeds.

- [ ] **Step 2: Run failing targeted tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/shell.test.ts tests/tmux.test.ts`
Expected: FAIL because shared shell helper does not exist and tmux still emits unquoted pipe commands / rejects stderr warnings.

- [ ] **Step 3: Create shared shell quoting helper and update imports**

Create `extensions/agentic-harness/shell.ts`:

```ts
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
```

Remove the local `shellQuote` implementation from `extensions/agentic-harness/subagent.ts` if present and import:

```ts
import { shellQuote } from "./shell.js";
```

- [ ] **Step 4: Fix tmux helper command execution and pipe-pane quoting**

Update `extensions/agentic-harness/tmux.ts`:
- import `ExecFileOptions` type from `child_process` if helpful
- change `TmuxCommandRunner.options` from `Record<string, never>` to `Record<string, unknown>` or `ExecFileOptions`
- make `runCommand(...)` reject only when `error` is non-null
- quote `logFile` in `pipePane(...)`:

```ts
await runCommand(commandRunner, binary, ["pipe-pane", "-t", paneId, "-o", `cat >> ${shellQuote(logFile)}`]);
```

- [ ] **Step 5: Re-run targeted tests and build**

Run: `cd extensions/agentic-harness && npm test -- --run tests/shell.test.ts tests/tmux.test.ts && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/shell.ts extensions/agentic-harness/tests/shell.test.ts extensions/agentic-harness/tmux.ts extensions/agentic-harness/tests/tmux.test.ts extensions/agentic-harness/subagent.ts
git commit -m "fix: harden tmux shell command handling"
```

### Task 2: Fix tmux runtime log handling, stderr reporting, and lifecycle events

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/tests/subagent-process.test.ts`
- Modify: `extensions/agentic-harness/types.ts` if lifecycle metadata needs type expansion

- [ ] **Step 1: Add failing tests for stale logs, duplicate writes, failure stderr, and lifecycle events**

Extend `extensions/agentic-harness/tests/subagent-process.test.ts` with tests that cover:

1. A tmux log file containing an old exit marker before invocation must not complete from the old marker.
2. `buildTmuxShellCommand(...)` or observable tmux command must not include `tee -a` when `pipe-pane` is already responsible for logging.
3. A tmux worker that exits non-zero after writing error text causes `result.stderr` or `result.errorMessage` to include that error text, not only `exitCode N`.
4. `onLifecycleEvent` and `PI_SUBAGENT_PROCESS_LOG` receive synthetic tmux `spawned` and `closed` events that include terminal metadata.

Use mocked tmux command execution and temporary log files; do not require a real tmux binary.

- [ ] **Step 2: Run failing targeted tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/subagent-process.test.ts`
Expected: FAIL because stale logs, duplicate tee logging, stderr tailing, and tmux lifecycle event parity are not yet implemented.

- [ ] **Step 3: Remove duplicate tmux log writes and prevent stale marker reuse**

Update `buildTmuxShellCommand(...)` in `extensions/agentic-harness/subagent.ts` so it no longer pipes to `tee -a`. It should emit stdout/stderr to the pane only, relying on `pipe-pane` to persist logs:

```ts
return `{ cd ${shellQuote(params.cwd)} && ${invocation}; code=$?; printf '\n${TMUX_EXIT_MARKER}%s\n' "$code"; } 2>&1`;
```

Before sending a tmux command, truncate the log file for the current invocation:

```ts
await writeFile(tmuxPane.logFile, "", "utf-8");
```

Do not use append-only initialization for new invocations.

- [ ] **Step 4: Replace full-file polling with incremental reads**

Change tmux log polling from repeated `readFile(...)` to offset-based reading with `fs.open` / `FileHandle.read` or equivalent. Preserve line buffering and `processPiJsonLine(...)` behavior.

Required behavior:
- keep `readOffset` as byte offset
- read only bytes after `readOffset`
- append decoded text to line buffer
- process complete newline-delimited lines
- keep polling cadence reasonable, but do not reread old bytes

- [ ] **Step 5: Populate useful failure stderr from tmux log tail**

When tmux execution finishes with a non-zero exit code and `result.stderr` is empty, read the final log tail and set:

```ts
result.stderr = usefulTail;
result.errorMessage ||= usefulTail || `exitCode ${exitCode}`;
```

Filter out JSON event lines and the tmux exit marker where practical. Keep the tail bounded, for example last 4,000 characters.

- [ ] **Step 6: Emit tmux lifecycle events**

In tmux mode, emit lifecycle events comparable to native mode:
- `spawned` after `tmux send-keys` succeeds
- `terminating` when abort/semantic termination sends `C-c`
- `closed` when exit marker is observed or timeout returns a terminal code

If `RunLifecycleEvent` needs fields such as `backend`, `sessionName`, `paneId`, add optional fields without breaking native tests.

- [ ] **Step 7: Re-run targeted tests and build**

Run: `cd extensions/agentic-harness && npm test -- --run tests/subagent-process.test.ts && npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add extensions/agentic-harness/subagent.ts extensions/agentic-harness/tests/subagent-process.test.ts extensions/agentic-harness/types.ts
git commit -m "fix: harden tmux runtime log and lifecycle handling"
```

### Task 3: Fix team-level tmux setup failures, binary propagation, and session collisions

**Dependencies:** Runs after Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/team.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tmux.ts`
- Modify: `extensions/agentic-harness/types.ts`
- Modify: `extensions/agentic-harness/tests/team.test.ts`
- Modify: `extensions/agentic-harness/tests/tmux.test.ts`

- [ ] **Step 1: Add failing team/helper tests for setup failure, binary propagation, and collision fallback**

Extend `extensions/agentic-harness/tests/team.test.ts` with tests for:

1. `detectTmux()` returns `{ available: true, binary: "/opt/custom/tmux" }`; `createWorkerPanes(...)`, `killTmuxSession(...)`, and `runTask(...)` receive/use that binary metadata.
2. `createWorkerPanes(...)` throws; `runTeam(...)` returns a failed summary, marks affected tasks failed, persists final failed state, and does not leave the record stuck as `running`.
3. Session collision behavior: mocked first `new-session -s pi-run` duplicate error causes retry with a suffix session name while preserving the failed original session.

Extend `extensions/agentic-harness/tests/tmux.test.ts` to verify collision-safe session naming helper behavior if implemented in `tmux.ts`.

- [ ] **Step 2: Run failing targeted tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/team.test.ts tests/tmux.test.ts`
Expected: FAIL because binary propagation, setup failure state conversion, and collision fallback are incomplete.

- [ ] **Step 3: Propagate resolved tmux binary through team/runtime metadata**

Update `TeamTerminalMetadata` / `TerminalMetadata` as needed to include:

```ts
tmuxBinary?: string;
sessionAttempt?: string;
```

In `runTeam(...)`, when `backendRequested` resolves to tmux, keep the `binary` from `detectTmux()` and pass it into:
- `createWorkerPanes({ binary })`
- task terminal metadata
- `runAgent(...)` via `tmuxPane`
- `killTmuxSession(..., binary)`

Update `extensions/agentic-harness/index.ts` so `tmuxPane` passed to `runAgent(...)` includes `tmuxBinary` if present.

- [ ] **Step 4: Handle tmux setup failures as failed summaries**

Wrap `createWorkerPanes(...)` in `runTeam(...)` with `try/catch`.

On failure:
- mark each runnable task as `failed`
- set `errorMessage` to the tmux setup error message
- record `task_failed` events
- synthesize a failed summary
- set run status to `failed`
- persist the final failed record
- return the summary instead of throwing
- best-effort cleanup only for any newly-created partial session if its session name is known

- [ ] **Step 5: Add session collision fallback without deleting debug sessions**

Implement collision handling in `createWorkerPanes(...)` or a wrapper helper:
- first attempt uses deterministic `buildTmuxSessionName(runId)` for backward-compatible attach names
- if `new-session` fails with duplicate-session style error, retry using a suffix such as `pi-<runId>-attempt-<shortRandom>`
- return the actual session name in `TmuxPaneRef`
- do not kill the existing session by default

Ensure tests make the suffix deterministic by injecting a suffix generator or command runner behavior.

- [ ] **Step 6: Re-run targeted tests and build**

Run: `cd extensions/agentic-harness && npm test -- --run tests/team.test.ts tests/tmux.test.ts && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add extensions/agentic-harness/team.ts extensions/agentic-harness/index.ts extensions/agentic-harness/tmux.ts extensions/agentic-harness/types.ts extensions/agentic-harness/tests/team.test.ts extensions/agentic-harness/tests/tmux.test.ts
git commit -m "fix: handle tmux setup failures and session collisions"
```

### Task 4: Document tmux failure cleanup and sandbox caveats

**Dependencies:** Runs after Task 3 completes
**Files:**
- Modify: `extensions/agentic-harness/README.md`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add failing documentation assertions**

Extend `extensions/agentic-harness/tests/extension.test.ts` README documentation assertions to require:

```ts
expect(readme).toContain("tmux kill-session -t");
expect(readme).toContain("Failed tmux team runs intentionally leave sessions alive");
expect(readme).toContain("sandbox");
```

- [ ] **Step 2: Run failing documentation test**

Run: `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts`
Expected: FAIL until README contains cleanup/sandbox caveat wording.

- [ ] **Step 3: Update README**

Update `extensions/agentic-harness/README.md` to state:
- failed tmux team runs intentionally leave sessions alive for debugging
- operators can inspect with `tmux ls`
- operators can clean up with `tmux kill-session -t <session>`
- if session collision occurs, retry sessions may use a suffixed session name and the actual attach command is recorded in the run summary/state
- tmux backend runs the resolved sandbox command inside a tmux pane; sandbox parity should be treated as tested for wrapper invocation, not as pane embedding isolation

- [ ] **Step 4: Re-run documentation test**

Run: `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/README.md extensions/agentic-harness/tests/extension.test.ts
git commit -m "docs: clarify tmux cleanup and sandbox caveats"
```

### Task 5 (Final): Full verification and regression sweep

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run: `cd extensions/agentic-harness && npm run build && npm test`
Expected: ALL PASS

- [ ] **Step 2: Run focused tmux hardening regression suite**

Run: `cd extensions/agentic-harness && npm test -- --run tests/shell.test.ts tests/tmux.test.ts tests/subagent-process.test.ts tests/team.test.ts tests/extension.test.ts`
Expected: PASS

- [ ] **Step 3: Verify success criteria manually**

Check each success criterion:
- [ ] `pipe-pane` log commands shell-quote log paths and resist spaces/metacharacters.
- [ ] tmux command helpers do not fail on stderr-only warnings.
- [ ] tmux mode uses the detected binary consistently.
- [ ] stale exit markers and duplicate log writes are prevented.
- [ ] failed tmux workers expose useful log-tail error text.
- [ ] tmux setup/session failures persist failed run state.
- [ ] session collisions retry with a safe suffixed session without deleting debug sessions by default.
- [ ] tmux log polling reads incrementally.
- [ ] tmux mode emits lifecycle/process-log events.
- [ ] native team/subagent behavior remains unchanged.

- [ ] **Step 4: Record final review notes**

Update `tasks/todo.md` with final verification commands, pass/fail results, and commit list.

## Self-Review

- **Spec coverage:** Covers all reported Critical/High/Medium/Low issues that should be fixed or documented: #1, #2, #3, #4, #5, #6, #7, #9, #10, #12, plus additional stale-log/setup-failure/lifecycle concerns discovered during review. #8 heartbeat persistence race and full TTL cleanup are explicitly out of hotfix scope.
- **Placeholder scan:** No `TODO`/`TBD` placeholders remain; each task has exact files, commands, and expected results.
- **Type consistency:** Uses existing `TerminalMetadata`/`TeamTerminalMetadata` naming and adds optional `tmuxBinary`/`sessionAttempt` only if required.
- **Dependency verification:** Tasks are sequential because they touch overlapping tmux/runtime/team files. No parallel execution is safe here.
- **Verification coverage:** Includes failing-test-first targeted tests and a final full build/test gate.

## Execution Handoff

Plan complete and saved to `docs/engineering-discipline/plans/2026-04-27-team-tmux-bugfix-hardening.md`.

Recommended execution mode: subagent execution with worker/validator per task, because this touches security, runtime lifecycle, and persistence behavior.
