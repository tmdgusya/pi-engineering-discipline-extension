# Agentic Harness Abort Cleanup Improvements Implementation Plan

> **Worker note:** Execute this plan task-by-task using agentic-run-plan or plan-worker/plan-validator pairs.

**Goal:** Improve `agentic-harness` abort behavior so tmux workers, team runs, and related resources are cleaned up when a user aborts/Ctrl+C cancellation reaches extension tools.

**Architecture:** Add explicit `AbortSignal` plumbing to the team tool, make `runTeam()` abort-aware, reuse tmux cleanup helpers on success and abort, and strengthen tmux subagent cancellation from best-effort `C-c` to bounded `kill-pane` escalation. Native subagent cleanup remains unchanged.

**Tech Stack:** TypeScript ESM, Node.js `AbortSignal`, Vitest, existing tmux helpers in `extensions/agentic-harness/tmux.ts`.

**Work Scope:**
- **In scope:** `extensions/agentic-harness/subagent.ts`, `team.ts`, `index.ts`, and tests under `extensions/agentic-harness/tests/`.
- **Out of scope:** pi core `interactive-mode.js` shutdown behavior; real tmux runtime reproduction.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript compatibility, full harness regression coverage, and new abort/tmux cleanup behavior.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/subagent.ts`: import tmux pane cleanup and add abort escalation timer in tmux execution branch.
- Modify `extensions/agentic-harness/team.ts`: add `signal?: AbortSignal`, abort-aware team execution, centralized tmux cleanup, partial setup cleanup.
- Modify `extensions/agentic-harness/index.ts`: pass tool execution `signal` into `runTeam()`.
- Modify `extensions/agentic-harness/tests/subagent-process.test.ts`: add tmux abort escalation regression.
- Modify `extensions/agentic-harness/tests/team.test.ts`: add team abort cleanup and partial setup cleanup regressions.
- Modify `extensions/agentic-harness/tests/team-tool.test.ts`: add signal forwarding regression.

---

## Task 1: Add tmux subagent abort escalation

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/subagent.ts`
- Test: `extensions/agentic-harness/tests/subagent-process.test.ts`

**Acceptance Criteria:**
- Tmux-mode `runAgent()` abort still sends `tmux send-keys ... C-c`.
- If no tmux exit marker arrives after `KILL_TIMEOUT_MS`, abort cleanup calls `killTmuxPane()` for the pane.
- Escalation timer is cleared when tmux execution settles.
- Existing native subagent behavior is unchanged.
- `cd extensions/agentic-harness && npx vitest run tests/subagent-process.test.ts` passes.

- [ ] **Step 1: Write failing regression test**
  Add a Vitest test in `tests/subagent-process.test.ts` that runs `runAgent()` in `executionMode: "tmux"` with a fake tmux/execFile implementation, aborts via `AbortController`, advances fake timers by `5_000`, and asserts both `send-keys -t <pane> C-c` and `kill-pane -t <pane>` were invoked.

- [ ] **Step 2: Confirm test fails**
  Run: `cd extensions/agentic-harness && npx vitest run tests/subagent-process.test.ts -t "tmux"`
  Expected before implementation: the new test fails because `kill-pane` is not called.

- [ ] **Step 3: Implement escalation**
  In `subagent.ts`, import `killTmuxPane` from `./tmux.js`. In the tmux execution branch, add `let tmuxKillTimer: ReturnType<typeof setTimeout> | undefined;`. Clear the timer in the tmux `finish()` path. In `sendPaneSignal(reason)`, after sending `C-c`, schedule a `setTimeout(..., KILL_TIMEOUT_MS)` that emits a terminating lifecycle event with `signal: "SIGKILL"` and calls `killTmuxPane(tmuxPane.paneId, undefined, tmuxPane.tmuxBinary)`. Use `.unref?.()` on the timer. Do not call `finish()` from this timer.

- [ ] **Step 4: Verify**
  Run: `cd extensions/agentic-harness && npx vitest run tests/subagent-process.test.ts`
  Expected: PASS.

---

## Task 2: Add abort signal support and cleanup policy to `runTeam()`

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/team.ts`
- Test: `extensions/agentic-harness/tests/team.test.ts`

**Acceptance Criteria:**
- `TeamRunOptions` includes `signal?: AbortSignal`.
- Aborting the signal while a team run is active returns a summary with `success === false`.
- Pending and in-progress tasks are marked `interrupted` with an abort error message.
- Detached tmux team abort calls `killTmuxSession()`.
- Current-window tmux team abort calls `killTmuxPane()` for worker panes.
- Existing success cleanup behavior still passes.
- `cd extensions/agentic-harness && npx vitest run tests/team.test.ts` passes.

- [ ] **Step 1: Add failing tests**
  In `tests/team.test.ts`, add tests for: detached tmux abort kills session and marks tasks interrupted; current-window tmux abort kills panes and marks tasks interrupted. Use `AbortController`, mocked tmux helpers, and a `runTask` that aborts then never resolves.

- [ ] **Step 2: Confirm tests fail**
  Run: `cd extensions/agentic-harness && npx vitest run tests/team.test.ts -t "aborted"`
  Expected before implementation: tests fail or time out because `runTeam()` has no abort race.

- [ ] **Step 3: Implement `signal?: AbortSignal` and cleanup helper**
  Add `signal?: AbortSignal` to `TeamRunOptions`. Add a local `cleanupTeamTmuxResources({ backendUsed, attachedToCurrentClient, paneIds, sessionName, tmuxBinary })` helper that kills panes for current-window placement or kills the session for detached placement.

- [ ] **Step 4: Implement abort race in worker execution**
  Around the existing `mapWithConcurrencyLimit(...)`, race worker execution against `opts.signal`. On abort, mark all pending/in-progress tasks `interrupted`, set `completedAt/updatedAt`, record task/run events, cleanup tmux resources through the helper, persist the interrupted record, synthesize and return an interrupted summary. Do not throw the abort error to callers.

- [ ] **Step 5: Reuse cleanup helper for success cleanup**
  Replace the existing success-only cleanup block with a call to `cleanupTeamTmuxResources()` when `summary.success` is true.

- [ ] **Step 6: Verify**
  Run: `cd extensions/agentic-harness && npx vitest run tests/team.test.ts`
  Expected: PASS.

---

## Task 3: Pass tool execution signal into `runTeam()`

**Dependencies:** Task 2
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Test: `extensions/agentic-harness/tests/team-tool.test.ts`

**Acceptance Criteria:**
- The team tool execute handler passes its `signal` argument into the first `runTeam()` options object.
- Existing team tool tests pass.
- `cd extensions/agentic-harness && npx vitest run tests/team-tool.test.ts` passes.

- [ ] **Step 1: Add failing test**
  In `tests/team-tool.test.ts`, add a test that executes the registered `team` tool with an `AbortController.signal` and asserts the mocked `runTeam()` call receives `expect.objectContaining({ signal: controller.signal })`.

- [ ] **Step 2: Confirm test fails**
  Run: `cd extensions/agentic-harness && npx vitest run tests/team-tool.test.ts -t "AbortSignal"`
  Expected before implementation: FAIL because `signal` is not forwarded.

- [ ] **Step 3: Implement signal forwarding**
  In `index.ts`, add `signal` to the object passed as the first argument to `runTeam()`.

- [ ] **Step 4: Verify**
  Run: `cd extensions/agentic-harness && npx vitest run tests/team-tool.test.ts`
  Expected: PASS.

---

## Task 4: Clean up partially-created tmux resources on setup failure

**Dependencies:** Task 2
**Files:**
- Modify: `extensions/agentic-harness/team.ts`
- Test: `extensions/agentic-harness/tests/team.test.ts`

**Acceptance Criteria:**
- If `createWorkerPanes()` throws with `partialPanes` metadata, `runTeam()` attempts tmux cleanup using that metadata.
- Detached partial setup failure calls `killTmuxSession()` with the partial session name.
- Current-window partial setup failure calls `killTmuxPane()` for partial pane ids.
- Setup failure still returns a failed summary and does not dispatch workers.
- `cd extensions/agentic-harness && npx vitest run tests/team.test.ts` passes.

- [ ] **Step 1: Add failing tests**
  In `tests/team.test.ts`, add tests where mocked `createWorkerPanes()` rejects with `Object.assign(new Error("pane setup failed"), { partialPanes: [...] })`. Cover detached session cleanup and current-window pane cleanup.

- [ ] **Step 2: Confirm tests fail**
  Run: `cd extensions/agentic-harness && npx vitest run tests/team.test.ts -t "partial"`
  Expected before implementation: FAIL because the catch block only knows about resources assigned before the throw.

- [ ] **Step 3: Implement partial metadata cleanup**
  In the `createWorkerPanes()` catch block, read `(error as { partialPanes?: unknown }).partialPanes` when it is an array. Extract session name, pane ids, and current-window placement. Call `cleanupTeamTmuxResources()` with existing tracked resources if present, otherwise partial metadata.

- [ ] **Step 4: Verify**
  Run: `cd extensions/agentic-harness && npx vitest run tests/team.test.ts`
  Expected: PASS.

---

## Task 5 (Final): End-to-End Verification

**Dependencies:** Tasks 1, 2, 3, and 4
**Files:** None unless verification fixes are required.

**Acceptance Criteria:**
- `cd extensions/agentic-harness && npm run build` passes.
- `cd extensions/agentic-harness && npm test` passes.
- Diff is limited to planned files.
- No pi core files under `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/` are modified.

- [ ] **Step 1: Run TypeScript build**
  Run: `cd extensions/agentic-harness && npm run build`
  Expected: PASS.

- [ ] **Step 2: Run full test suite**
  Run: `cd extensions/agentic-harness && npm test`
  Expected: PASS.

- [ ] **Step 3: Inspect diff**
  Run: `git diff -- extensions/agentic-harness/subagent.ts extensions/agentic-harness/team.ts extensions/agentic-harness/index.ts extensions/agentic-harness/tests/subagent-process.test.ts extensions/agentic-harness/tests/team.test.ts extensions/agentic-harness/tests/team-tool.test.ts`
  Expected: Diff is limited to planned changes.
