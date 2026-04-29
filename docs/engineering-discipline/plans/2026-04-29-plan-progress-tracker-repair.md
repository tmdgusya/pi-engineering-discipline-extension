# Plan Progress Tracker Repair Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Make the agentic-harness plan progress tracker visibly update while plan-worker/plan-validator subagents start, finish, and keep long-running tasks active.

**Architecture:** Keep parsing and task matching in `PlanProgressTracker`, but make state changes observable. The footer component subscribes to tracker changes, requests a TUI render after every tracker mutation, and runs a short render tick only while at least one plan task is running so the spinner visibly animates.

**Tech Stack:** TypeScript ESM, pi extension APIs, `@mariozechner/pi-tui` `Component`/`TUI`, Vitest.

**Work Scope:**
- **In scope:** Add tracker change notifications, add footer render scheduling/spinner ticking, wire the footer factory to pass the real `TUI`, and add regression tests for callbacks, render scheduling, and timer cleanup.
- **Out of scope:** Changing plan markdown parsing semantics, changing subagent execution behavior, changing pi core TUI APIs, or redesigning the footer visuals.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test`
- **What it validates:** All agentic-harness unit/regression tests pass, including plan-progress lifecycle, footer rendering, and event loading tests.

---

## File Structure Mapping

- `extensions/agentic-harness/plan-progress.ts` — parsed plan state, task status transitions, observer API.
- `extensions/agentic-harness/footer.ts` — footer rendering, tracker subscription, render requests, spinner timer cleanup.
- `extensions/agentic-harness/index.ts` — extension event wiring, passes the real `TUI` into `RoachFooter`.
- `extensions/agentic-harness/tests/plan-progress.test.ts` — regression coverage for callback emission, render scheduling, and timer disposal.

---

### Task 1: Add observable state changes to PlanProgressTracker

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/plan-progress.ts`
- Test: `extensions/agentic-harness/tests/plan-progress.test.ts`

- [ ] **Step 1: Add callback lifecycle tests**

Add tests that verify `setOnChange` is called for `loadPlan`, state-changing `clear`, `startTask`, and `completeTask`, and is not called for ignored duplicate transitions.

- [ ] **Step 2: Implement the tracker observer API**

Add `setOnChange(listener: (() => void) | null): void` and private `notifyChanged(): void`. Notify after visible state changes in `loadPlan`, state-changing `clear`, `startTask`, `startTaskByMatch`, `completeTask`, and `completeTaskByMatch`.

- [ ] **Step 3: Run focused lifecycle tests**

Run: `cd extensions/agentic-harness && npx vitest run tests/plan-progress.test.ts -t "PlanProgressTracker lifecycle"`
Expected: PASS for the lifecycle suite.

- [ ] **Step 4: Run build for type safety**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit Task 1**

Run: `git add extensions/agentic-harness/plan-progress.ts extensions/agentic-harness/tests/plan-progress.test.ts && git commit -m "fix(agentic-harness): notify plan progress changes"`
Expected: A commit is created.

---

### Task 2: Make RoachFooter request renders and animate running-task spinner

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Test: `extensions/agentic-harness/tests/plan-progress.test.ts`

- [ ] **Step 1: Add footer scheduling tests**

Add tests that construct `RoachFooter` with a fake `{ requestRender }`, verify tracker state changes call `requestRender(true)`, verify a running task causes periodic render requests, and verify `dispose()` stops the timer.

- [ ] **Step 2: Implement footer render scheduling**

Update `RoachFooter` to accept optional `Pick<TUI, "requestRender">`, subscribe to `planProgress.setOnChange`, call `requestRender(true)` on changes, start a `setInterval` while any task is running, stop it when no tasks run, and clear it in `dispose()`.

- [ ] **Step 3: Ensure render stops the spinner timer when no task is running**

Call `this.updateSpinnerTimer()` at the start of `render(width: number): string[]`.

- [ ] **Step 4: Run focused footer tests**

Run: `cd extensions/agentic-harness && npx vitest run tests/plan-progress.test.ts -t "RoachFooter plan progress hosting"`
Expected: PASS for footer hosting tests.

- [ ] **Step 5: Run build for type safety**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit Task 2**

Run: `git add extensions/agentic-harness/footer.ts extensions/agentic-harness/tests/plan-progress.test.ts && git commit -m "fix(agentic-harness): refresh plan progress footer"`
Expected: A commit is created.

---

### Task 3: Wire the real TUI into RoachFooter from the extension entrypoint

**Dependencies:** Runs after Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Test: `extensions/agentic-harness/tests/plan-progress.test.ts`

- [ ] **Step 1: Confirm backward compatibility**

Run: `cd extensions/agentic-harness && npx vitest run tests/plan-progress.test.ts -t "renders active plan lines"`
Expected: PASS.

- [ ] **Step 2: Pass the real TUI object into RoachFooter**

In the `ctx.ui.setFooter((_tui, theme, footerData) => { ... })` block in `extensions/agentic-harness/index.ts`, pass `_tui` as the final `RoachFooter` constructor argument.

- [ ] **Step 3: Run plan progress tests**

Run: `cd extensions/agentic-harness && npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts`
Expected: PASS for both plan progress test files.

- [ ] **Step 4: Run build for type safety**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit Task 3**

Run: `git add extensions/agentic-harness/index.ts && git commit -m "fix(agentic-harness): wire plan progress render requests"`
Expected: A commit is created.

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run: `cd extensions/agentic-harness && npm test`
Expected: ALL PASS.

- [ ] **Step 2: Run TypeScript build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Verify plan success criteria manually**

Check each criterion against the code and tests:
- [ ] `PlanProgressTracker` emits a callback when `loadPlan`, state-changing `clear`, `startTask`, `startTaskByMatch`, `completeTask`, or `completeTaskByMatch` changes visible plan progress.
- [ ] Duplicate or ignored task transitions do not emit extra callbacks.
- [ ] `RoachFooter` calls `tui.requestRender(true)` after tracker state changes.
- [ ] `RoachFooter` requests periodic renders while at least one task is running.
- [ ] `RoachFooter.dispose()` clears the timer and unsubscribes from tracker callbacks.
- [ ] `index.ts` passes the real footer `_tui` into `RoachFooter`.
