# Plan Tracker TUI Persistence + QA Fixes Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan workflow. This document replaces the earlier QA draft, which referenced a non-existent `plan-progress-qa.test.ts` file and stale test counts.

**Goal:** Make the Plan Progress TUI panel persist from plan creation into plan execution, show task state transitions reliably (`○` → `◐ ◓ ◑ ◒` → `✓` / `✗`), and add tests that verify the tracker lifecycle, rendering, and event wiring.

**Primary user-reported bug:** When a plan-crafting or milestone-planning flow writes the `.md` plan file, the progress panel may appear briefly, but when the user later executes the plan, the panel is not visible in the TUI. The fix must ensure the plan is loaded or reloaded at execution time and remains available while plan-worker / plan-validator / plan-compliance subagents run.

**Architecture:**
- `extensions/agentic-harness/plan-progress.ts` owns parsed plan state, task status transitions, fuzzy task matching, and compact rendering.
- `extensions/agentic-harness/footer.ts` only hosts the rendered plan panel above the normal footer.
- `extensions/agentic-harness/index.ts` wires tool events to the tracker: plan file read/write, session lifecycle, and subagent execution start/end.
- `extensions/agentic-harness/plan-parser.ts` already parses plan markdown and is out of scope unless tests reveal a parser regression.

**Tech Stack:** TypeScript, Vitest, pi TUI (`@mariozechner/pi-tui`), pi coding agent (`@mariozechner/pi-coding-agent`).

**Current verified baseline:**
- `extensions/agentic-harness/tests/plan-progress-qa.test.ts` does **not** currently exist.
- `npx tsc --noEmit` currently passes.
- A full `npx vitest run --reporter dot` run currently has one unrelated baseline failure in `tests/subagent-process.test.ts` (`kill-pane -t %1` expectation). Do not attribute that failure to this plan tracker work unless it changes.
- Current tracked tests do not directly cover `PlanProgressTracker` or footer plan rendering.

**Work Scope:**
- **In scope:** Plan tracker state correctness, plan auto-load/reload lifecycle, subagent single/parallel/chain tracking support, footer panel rendering tests, and regression coverage for the user-reported disappearance bug.
- **Out of scope:** Changing plan-parser semantics, adding persistent cross-session storage, changing team/subagent execution internals, or redesigning the TUI layout beyond the current footer-hosted panel.

**Verification Strategy:**
- **Primary commands:**
  - `cd extensions/agentic-harness && npx tsc --noEmit`
  - `cd extensions/agentic-harness && npx vitest run tests/plan-progress.test.ts --reporter verbose`
  - `cd extensions/agentic-harness && npx vitest run tests/plan-progress-events.test.ts --reporter verbose`
- **Full-suite command:** `cd extensions/agentic-harness && npx vitest run --reporter dot`
  - Expected: all plan tracker tests pass. If the pre-existing `subagent-process.test.ts` tmux failure remains, document it as unrelated baseline unless this work touched subagent process ownership.
- **Manual QA:** Create or write a plan file, then execute it. Confirm the panel stays visible during execution and transitions statuses.

---

## File Structure Mapping

| File | Action | Responsibility |
|------|--------|----------------|
| `extensions/agentic-harness/plan-progress.ts` | Modify | Add robust progress counts, state guards, fuzzy matching helper, and testable rendering behavior |
| `extensions/agentic-harness/footer.ts` | Test/possibly minor modify | Ensure active plan panel is hosted above normal footer without owning task formatting |
| `extensions/agentic-harness/index.ts` | Modify | Fix plan auto-load/reload and subagent wiring across read/write/single/parallel/chain flows |
| `extensions/agentic-harness/tests/plan-progress.test.ts` | Create | Unit tests for tracker state, fuzzy matching, and render output |
| `extensions/agentic-harness/tests/plan-progress-events.test.ts` | Create | Event-wiring regression tests for plan disappearing during execution |

---

## Root-Cause Hypotheses to Verify

The implementation should test and fix these specific failure modes:

1. **Write result does not contain plan markdown.**
   - Current `index.ts` tries to load plan content from `event.content` for both `read` and `write` results.
   - `write` tool results are often confirmation text, not the written markdown.
   - Loading confirmation text can leave the tracker empty (`hasPlan() === false`) or fail to load the actual plan.

2. **Execution starts without a fresh plan load.**
   - If the run-plan workflow does not call `read` on the plan file before invoking subagents, the tracker may have no plan loaded.
   - The event wiring must be able to reload from `planFile`, `reads`, or a plan path mentioned in subagent args.

3. **Subagent tracking only handles single-mode calls.**
   - Current wiring inspects only `args.agent` and `args.task`.
   - The subagent tool also supports `tasks: [...]` and `chain: [...]`.
   - Parallel or chain execution can therefore bypass task start/completion tracking.

4. **Tracker state guards are too permissive.**
   - `startTask()` can overwrite timestamps or restart completed/failed tasks.
   - `completeTaskByMatch()` uses only direct string inclusion and misses common wording differences.

5. **Footer rendering itself is not the root owner of progress state.**
   - `footer.ts` should remain a host; fixes should mainly target `plan-progress.ts` and `index.ts`.

---

### Task 1: Add tracker unit tests that define the expected behavior

**Dependencies:** None

**Files:**
- Create: `extensions/agentic-harness/tests/plan-progress.test.ts`

- [ ] **Step 1: Create a representative sample plan fixture inside the test file**

Include a markdown sample with:
- `**Goal:** ...`
- at least 3 `### Task N: ...` sections
- file lines using `Modify:` or `Create:`
- command lines using `Run:` / `Expected:`

- [ ] **Step 2: Test initial load and progress counts**

Assertions:
- `tracker.loadPlan(samplePlan)` produces `hasPlan() === true`
- `getGoal()` returns the goal
- `getProgress()` returns `completed`, `running`, `failed`, `pending`, and `total`
- initial counts are `0 completed`, `0 running`, `0 failed`, `3 pending`, `3 total`

- [ ] **Step 3: Test state transitions**

Assertions:
- `startTask(1)` changes only task 1 to running
- `completeTask(1, true)` changes task 1 to completed
- `completeTask(2, false)` can mark a known task failed only if it was running or explicitly allowed by final implementation; document the chosen behavior in the test name

- [ ] **Step 4: Test state guards**

Assertions:
- Calling `startTask(1)` twice does not reset `startedAt`
- A completed task cannot be restarted by `startTask(1)`
- A failed task cannot be restarted by `startTask(1)` unless explicitly reset by `loadPlan()`

- [ ] **Step 5: Test fuzzy matching**

Assertions:
- Exact task text matches
- `Task 2` matches task 2
- Word-overlap wording such as `finished the tracker` can match `Create tracker` when task 2 is currently running
- Stop words alone do not match

- [ ] **Step 6: Test render output**

Assertions:
- Pending task lines include `○`
- Running task lines include one of `◐`, `◓`, `◑`, `◒`
- Completed task lines include `✓`
- Failed task lines include `✗`
- Progress summary uses `completed/total`, so one running task and zero completed tasks renders `0/3` plus `1 running`

- [ ] **Step 7: Run the new test file and confirm it fails before implementation**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts --reporter verbose
```

Expected before implementation: failures around `pending`, state guards, and fuzzy matching.

---

### Task 2: Harden `PlanProgressTracker`

**Dependencies:** Task 1

**Files:**
- Modify: `extensions/agentic-harness/plan-progress.ts`

- [ ] **Step 1: Add `pending` to `getProgress()`**

Return shape:

```ts
{ completed: number; total: number; failed: number; running: number; pending: number }
```

- [ ] **Step 2: Add a shared `textMatches(input, taskName)` helper**

Matching rules:
- Direct inclusion either direction remains supported.
- `Task N` references remain supported separately.
- Significant word overlap is supported.
- Use stop words and minimum word length to avoid accidental matches.
- Normalize punctuation so `tracker.` and `tracker` match.

- [ ] **Step 3: Use `textMatches()` in both `startTaskByMatch()` and `completeTaskByMatch()`**

Keep `Task N` matching as a fast path.

- [ ] **Step 4: Guard invalid state transitions**

Expected behavior:
- `startTask(id)` only transitions `pending` → `running`.
- `startTaskByMatch(text)` only transitions pending tasks.
- `completeTask(id, success)` should only complete/fail tasks that are currently `running` unless tests deliberately choose a different behavior.
- `completeTaskByMatch(text, success)` only transitions running tasks.
- `loadPlan()` is the reset boundary and returns all tasks to pending.

- [ ] **Step 5: Run tracker tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts --reporter verbose
npx tsc --noEmit
```

Expected: pass.

---

### Task 3: Fix plan auto-load/reload so the panel persists into execution

**Dependencies:** Task 2

**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Create: `extensions/agentic-harness/tests/plan-progress-events.test.ts`

- [ ] **Step 1: Extract plan loading helpers in `index.ts`**

Add small helpers near the tracker wiring:

```ts
function isPlanMarkdownPath(path: string): boolean
function extractPlanPathsFromArgs(args: unknown): string[]
async function loadPlanFromTextOrFile(options: { text?: string; path?: string; cwd?: string }): Promise<boolean>
```

Rules:
- Match absolute and relative paths under `docs/engineering-discipline/plans/*.md`.
- Continue supporting generic `/plans/*.md` and `/plan/*.md` only if needed, but prefer engineering-discipline plan paths.
- For write events, prefer `event.input.content` when available.
- For read events, prefer `event.content` text.
- If no trustworthy markdown text is available, read the file from disk using `resolve(ctx.cwd ?? process.cwd(), filePath)` for relative paths.
- Do **not** call `planProgress.loadPlan()` on confirmation strings or non-plan text. Parse first or require at least one parsed task before replacing the active plan.

- [ ] **Step 2: Fix `tool_result` read/write handling**

Change the handler signature from `_ctx` to `ctx` so relative paths can be resolved correctly.

Expected behavior:
- `read` of a plan file loads the markdown from `event.content` or disk fallback.
- `write` of a plan file loads from `event.input.content` or disk fallback.
- A write confirmation message must never replace a valid loaded plan with an empty plan.

- [ ] **Step 3: Reload plan at subagent execution time if needed**

Before `trackPlanSubagentStart(...)`, call a helper that attempts to find a plan path in the subagent arguments:
- `args.planFile`
- `args.reads[]`
- `args.tasks[].reads[]`
- `args.tasks[].planFile`
- `args.chain[].reads[]`
- `args.chain[].planFile`
- any `docs/engineering-discipline/plans/*.md` substring inside serialized `args.task`, `args.tasks[].task`, or `args.chain[].task`

If a plan path is found, load it from disk before starting task matching. This directly fixes the user-reported bug where the panel disappears between plan creation and execution.

- [ ] **Step 4: Preserve loaded plan unless a new valid plan is loaded**

If a plan load attempt fails or parses zero tasks, keep the existing `planProgress` state. Do not clear the panel due to a bad write/read result.

- [ ] **Step 5: Add event-level regression tests**

Create `tests/plan-progress-events.test.ts` with exported/testable helpers if needed. If `index.ts` is too hard to test directly, put pure helper functions in a small module such as `plan-progress-events.ts` and test that module.

Test cases:
- write event with `input.content` containing plan markdown loads the plan
- write event with only confirmation result does not wipe an already loaded plan
- read event with result text loads the plan
- read/write with relative path resolves against cwd
- subagent single-mode args with `planFile` reload the plan before tracking starts
- subagent args with `reads: [planPath]` reload the plan
- subagent task text containing `docs/engineering-discipline/plans/foo.md` reloads the plan

- [ ] **Step 6: Run tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress-events.test.ts --reporter verbose
npx vitest run tests/plan-progress.test.ts --reporter verbose
npx tsc --noEmit
```

Expected: pass.

---

### Task 4: Support subagent single, parallel, and chain tracking

**Dependencies:** Task 3

**Files:**
- Modify: `extensions/agentic-harness/index.ts` or extracted helper module
- Modify: `extensions/agentic-harness/tests/plan-progress-events.test.ts`

- [ ] **Step 1: Track matched task IDs by tool call**

Add state:

```ts
const planTaskIdsByToolCallId = new Map<string, number[]>();
```

When a subagent tool execution starts, store the task IDs that were marked running.

- [ ] **Step 2: Return matched task IDs from start helper**

Refactor tracking logic so it returns IDs:
- single mode: match `args.agent` / `args.task`
- parallel mode: iterate `args.tasks[]`
- chain mode: iterate `args.chain[]`

For parallel/chain, exact per-subagent completion events may not be available at the top-level tool call. Acceptable MVP behavior:
- mark matched tasks running at tool start
- mark those same IDs completed/failed at top-level tool end

- [ ] **Step 3: Complete by stored task IDs first**

At `tool_execution_end`, prefer `planTaskIdsByToolCallId.get(event.toolCallId)` over fuzzy matching. This avoids completion mismatches when the final output wording differs from the task name.

Fallback to fuzzy `completeTaskByMatch()` only when no stored IDs exist.

- [ ] **Step 4: Add tests**

Test cases:
- single-mode plan-worker starts and completes one task
- parallel `tasks[]` starts and completes multiple matched tasks
- chain `chain[]` starts and completes matched tasks
- non-plan agents do not alter progress unless their task text clearly matches and this fallback is intentionally retained
- failed tool execution marks stored running tasks failed

- [ ] **Step 5: Run tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress-events.test.ts --reporter verbose
npx tsc --noEmit
```

Expected: pass.

---

### Task 5: Verify footer panel rendering and non-regression of summary-style tool rendering

**Dependencies:** Task 2

**Files:**
- Modify/Create tests as appropriate:
  - `extensions/agentic-harness/tests/plan-progress.test.ts`
  - existing `extensions/agentic-harness/tests/render.test.ts` if needed

- [ ] **Step 1: Add a footer-hosting test if feasible**

Test that a `RoachFooter` with an active tracker returns lines in this order:
1. top plan border
2. plan header/progress/task lines
3. normal footer border
4. normal footer line 1
5. normal footer line 2

If constructing `ReadonlyFooterDataProvider` is too cumbersome, keep this as a focused render test on `PlanProgressTracker.render()` and manually verify footer hosting.

- [ ] **Step 2: Confirm read/write/edit summaries remain summary-style**

The existing `render.ts` behavior should remain unchanged:
- `read path[:range]`
- `write path (N lines)`
- `edit path`

Run existing render tests:

```bash
cd extensions/agentic-harness
npx vitest run tests/render.test.ts --reporter verbose
```

- [ ] **Step 3: Run tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/render.test.ts --reporter verbose
npx tsc --noEmit
```

Expected: pass.

---

### Task 6: Manual QA for the user-reported lifecycle bug

**Dependencies:** Tasks 1-5

**Files:** None unless QA notes are saved.

- [ ] **Step 1: Start pi in the extension workspace**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
pi
```

- [ ] **Step 2: Create a small test plan through the normal workflow**

Use `/plan` or ask the agent to write a minimal plan under:

```text
docs/engineering-discipline/plans/<date>-plan-tracker-manual-qa.md
```

Expected:
- When the `.md` plan is written, the Plan Progress panel appears.
- The panel shows all parsed tasks as `○`.

- [ ] **Step 3: Execute the plan**

Ask the agent to run the generated plan using the agentic-run-plan workflow.

Expected:
- The Plan Progress panel remains visible during execution.
- The current task shows one of `◐ ◓ ◑ ◒`.
- Completed tasks show `✓`.
- Failed tasks show `✗`.
- The panel does not disappear between plan creation and first `plan-worker` call.

- [ ] **Step 4: Verify reload behavior**

Restart pi or reset phase, then ask the agent to execute the same existing plan file.

Expected:
- The tracker reloads the plan from the plan path/read/subagent args.
- The panel appears during execution even though the plan was not just created in the same turn.

- [ ] **Step 5: Capture QA result**

Record:
- plan file path used
- whether panel appeared on write
- whether panel persisted into execution
- one screenshot or terminal transcript if available
- any deviations

---

### Task 7 (Final): End-to-end verification and cleanup

**Dependencies:** All previous tasks

- [ ] **Step 1: Run targeted tests**

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts tests/render.test.ts --reporter verbose
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 2: Run full suite**

```bash
cd extensions/agentic-harness
npx vitest run --reporter dot
```

Expected:
- No new failures from plan tracker changes.
- If `tests/subagent-process.test.ts` still fails with the known `kill-pane -t %1` assertion and this plan did not touch subagent process ownership, document it as pre-existing unrelated baseline.

- [ ] **Step 3: Verify success criteria**

- [ ] Plan written by plan-crafting/milestone-planning loads from actual markdown, not write confirmation text.
- [ ] Existing valid plan is not wiped by a failed/empty load attempt.
- [ ] Executing an existing plan reloads the tracker from path/args if needed.
- [ ] Single-mode subagent plan-worker tracking works.
- [ ] Parallel `tasks[]` and chain `chain[]` subagent tracking do not silently bypass the tracker.
- [ ] Running task shows spinner frames `◐ ◓ ◑ ◒`.
- [ ] Completed task shows `✓`.
- [ ] Failed task shows `✗`.
- [ ] Progress summary uses `completed/total`, not `running + completed`.
- [ ] Read/write/edit render output remains summary-style.

- [ ] **Step 4: Update this plan checkboxes or add a completion note**

If executing through agentic-run-plan, update task checkboxes as tasks complete or append a short completion note with test results.

---

## Execution Note — 2026-04-28

Implemented Tasks 1-5 and automatic verification from Task 7.

**Implemented:**
- Added `PlanProgressTracker` unit coverage in `extensions/agentic-harness/tests/plan-progress.test.ts`.
- Hardened `extensions/agentic-harness/plan-progress.ts` with `pending` counts, state guards, fuzzy matching, and tested rendering.
- Added `extensions/agentic-harness/plan-progress-events.ts` for plan path detection, safe plan loading, reload-from-subagent-args, and single/parallel/chain task tracking helpers.
- Updated `extensions/agentic-harness/index.ts` to:
  - load write events from `event.input.content` or cwd-relative disk fallback,
  - load read events from result text or disk fallback,
  - preserve existing valid tracker state on invalid/empty load attempts,
  - reload plans from subagent `planFile`, `reads`, nested `tasks[]`/`chain[]`, or plan paths in task text before tracking starts,
  - store matched plan task IDs by `toolCallId` and complete/fail those IDs on `tool_execution_end`.
- Added footer-hosting and render summary non-regression tests.

**Verification run:**
- `npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts tests/render.test.ts --reporter verbose` — PASS, 44 tests.
- `npx tsc --noEmit` — PASS.
- `npx vitest run --reporter dot` — PASS, 39 test files / 408 tests.

**Lifecycle QA evidence:**
- Saved non-interactive lifecycle QA evidence to `docs/engineering-discipline/reviews/2026-04-28-plan-tracker-manual-qa.md`.
- The API environment cannot provide a true human-observed TUI screenshot, but the evidence covers the same production event/render paths: write/read plan loading, invalid-write preservation, execution-time plan reload, single/parallel/chain subagent tracking, footer hosting, spinner/check/failure indicators, and summary-style read/write/edit rendering.
