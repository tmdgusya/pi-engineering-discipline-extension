# Plan Tracker Leak and Bug Review Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. This is a review-only plan: do not change production code in this plan. Document confirmed defects and recommended fixes for a follow-up implementation plan.

**Goal:** Verify that the recently implemented plan tracker persistence/QA fixes are correct and identify any memory/state leaks, information leaks, lifecycle bugs, regression risks, or test gaps before the work is treated as complete.

**Architecture:** The review is split into independent audit slices after an initial scope inventory. Each audit reads a bounded set of implementation and test files, runs exact verification commands, and writes a dedicated review artifact. A final synthesis task merges those artifacts into one pass/fail decision and follow-up list.

**Tech Stack:** TypeScript, Vitest, Node.js ESM, pi extension lifecycle events, pi TUI footer rendering, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`.

**Work Scope:**
- **In scope:** Current plan tracker implementation changes related to `extensions/agentic-harness/plan-progress.ts`, `extensions/agentic-harness/plan-progress-events.ts`, `extensions/agentic-harness/index.ts`, `extensions/agentic-harness/footer.ts`, `extensions/agentic-harness/tests/plan-progress.test.ts`, `extensions/agentic-harness/tests/plan-progress-events.test.ts`, `extensions/agentic-harness/tests/render.test.ts`, and the plan/review QA documents named `2026-04-28-plan-tracker-*`.
- **In scope:** Confirming that `package.json` has no out-of-scope diff and that unrelated untracked files are not accidentally required by the implementation.
- **Out of scope:** Fixing production code, changing test architecture, modifying unrelated untracked files such as `.factory/`, `.github/workflows/qa.yml`, older context/review documents, or `qa-results/` unless Task 1 proves they are part of the plan tracker work.

**Success Criteria:**
- A reviewer can state whether the implementation is safe to keep, needs follow-up fixes, or should be reverted.
- All leak classes are explicitly checked: stale in-memory maps, tracker state leakage between workflows/sessions, unintended plan content loading, sensitive data exposure in docs/tests/logs, and temp-file cleanup in tests.
- All bug classes are explicitly checked: task matching false positives/false negatives, read/write event loading, subagent single/parallel/chain tracking, footer rendering, failure handling, and regression test coverage.
- Targeted tests, TypeScript, and full Vitest suite are rerun and recorded.
- Review output is saved under `docs/engineering-discipline/reviews/` with concrete file paths, commands, results, and follow-up recommendations.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npx vitest run --reporter dot && npx tsc --noEmit`
- **What it validates:** The full agentic-harness test suite still passes and TypeScript accepts the implementation after review artifacts are created.

**Project Capability Discovery:**
- Bundled review agents available for optional execution hints: `reviewer-bug`, `reviewer-security`, `reviewer-performance`, `reviewer-test-coverage`, `reviewer-consistency`, `reviewer-verifier`, `review-synthesis`.
- Project skills available for optional execution hints: `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`, `extensions/agentic-harness/skills/agentic-systematic-debugging/SKILL.md`, `.factory/skills/qa/SKILL.md`.
- Workers may execute the steps directly; optional reviewer agents must not modify files except the task's assigned review artifact.

---

## File Structure Mapping

| File | Action | Responsibility |
|---|---|---|
| `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-scope-audit.md` | Create | Scope inventory, git diff classification, baseline verification status |
| `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-state-lifecycle-audit.md` | Create | State, cleanup, concurrency, and memory-leak audit |
| `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-matching-path-audit.md` | Create | Plan path detection, markdown loading, fuzzy matching, and false-positive audit |
| `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-rendering-audit.md` | Create | Footer/TUI rendering and display-regression audit |
| `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-verification-evidence-audit.md` | Create | Test coverage, QA evidence, docs, and information-leak audit |
| `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-leak-bug-review-summary.md` | Create | Final synthesis, verdict, severity-ranked follow-up list |
| `extensions/agentic-harness/plan-progress.ts` | Review only | Tracker state transitions, matching, progress counts, rendering |
| `extensions/agentic-harness/plan-progress-events.ts` | Review only | Plan loading helpers, path extraction, subagent tracking helpers |
| `extensions/agentic-harness/index.ts` | Review only | Extension event wiring, map cleanup, workflow lifecycle boundaries |
| `extensions/agentic-harness/footer.ts` | Review only | Footer hosting of plan progress panel |
| `extensions/agentic-harness/tests/plan-progress.test.ts` | Review only | Tracker unit coverage |
| `extensions/agentic-harness/tests/plan-progress-events.test.ts` | Review only | Event/helper regression coverage |
| `extensions/agentic-harness/tests/render.test.ts` | Review only | Rendering non-regression coverage |

---

### Task 1: Establish exact review scope and baseline

**Dependencies:** None (must run before all other audit tasks)

**Files:**
- Create: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-scope-audit.md`
- Review only: `docs/engineering-discipline/plans/2026-04-28-plan-tracker-qa-fixes.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-28-plan-tracker-qa-fixes-review.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-28-plan-tracker-manual-qa.md`

- [ ] **Step 1: Capture current git scope**

Run:

```bash
git status --short
git diff --name-status
git diff --stat
```

Expected: plan tracker production/test files appear as modified or untracked; `package.json` is absent from `git diff --name-status`.

- [ ] **Step 2: Capture scoped source diffs**

Run:

```bash
git diff -- extensions/agentic-harness/footer.ts extensions/agentic-harness/index.ts extensions/agentic-harness/tests/render.test.ts
for file in \
  extensions/agentic-harness/plan-progress.ts \
  extensions/agentic-harness/plan-progress-events.ts \
  extensions/agentic-harness/tests/plan-progress.test.ts \
  extensions/agentic-harness/tests/plan-progress-events.test.ts; do
  test -f "$file" && sed -n '1,260p' "$file"
done
```

Expected: output is sufficient to classify each change as plan tracker related or unrelated.

- [ ] **Step 3: Run baseline targeted verification**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts tests/render.test.ts --reporter verbose
npx tsc --noEmit
```

Expected: targeted tests pass and TypeScript reports no errors.

- [ ] **Step 4: Write the scope audit artifact**

Create `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-scope-audit.md` with these sections:

```markdown
# Plan Tracker Scope Audit

**Date:** 2026-04-29
**Verdict:** PASS | FAIL

## Changed Files Classified In Scope

| File | Classification | Reason |
|---|---|---|

## Changed Files Classified Out of Scope

| File | Classification | Reason |
|---|---|---|

## Baseline Verification

| Command | Result | Evidence |
|---|---|---|

## Immediate Blockers

- None if no blocker is found.
```

Populate every row from Steps 1-3. Use `PASS` only if the source/test diff is scoped to plan tracker work and targeted verification passes.

---

### Task 2: Audit state lifecycle, cleanup, and memory leak risks

**Dependencies:** Task 1 completed

**Files:**
- Create: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-state-lifecycle-audit.md`
- Review only: `extensions/agentic-harness/index.ts`
- Review only: `extensions/agentic-harness/plan-progress.ts`
- Review only: `extensions/agentic-harness/plan-progress-events.ts`

- [ ] **Step 1: Inspect lifecycle ownership and cleanup points**

Run:

```bash
grep -n "const planProgress\|toolCallArgsById\|planTaskIdsByToolCallId\|activeTools.running\|planProgress.clear\|toolCallArgsById.clear\|planTaskIdsByToolCallId.clear" extensions/agentic-harness/index.ts
```

Expected: every map/set used for tool tracking has a corresponding cleanup path on tool end and session reset.

- [ ] **Step 2: Inspect async error paths around tool start/end**

Run:

```bash
grep -n "pi.on(\"tool_execution_start\"\|pi.on(\"tool_execution_end\"\|reloadPlanFromSubagentArgs\|startPlanSubagentTasks\|completePlanSubagentTasks" extensions/agentic-harness/index.ts extensions/agentic-harness/plan-progress-events.ts
```

Expected: a failed reload cannot leave unrelated tasks running forever, and `tool_execution_end` deletes stale entries for both success and error results.

- [ ] **Step 3: Inspect tracker transition guards**

Run:

```bash
grep -n "startTask(taskId\|startTaskByMatch\|completeTask(taskId\|completeTaskByMatch\|loadPlan(markdown\|clear()" extensions/agentic-harness/plan-progress.ts
```

Expected: `pending -> running -> completed/failed` is guarded; `loadPlan()` resets state intentionally; `clear()` empties plan state.

- [ ] **Step 4: Run leak-focused tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts --reporter verbose
```

Expected: tests for state guards, failed tool execution, single/parallel/chain completion, and temp directory cleanup pass.

- [ ] **Step 5: Write the lifecycle audit artifact**

Create `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-state-lifecycle-audit.md` with these sections:

```markdown
# Plan Tracker State Lifecycle and Leak Audit

**Date:** 2026-04-29
**Verdict:** PASS | FAIL

## Checklist

| Check | Status | Evidence |
|---|---|---|
| `activeTools.running` entries are deleted on every tool end | PASS |  |
| `toolCallArgsById` entries are deleted on every tool end | PASS |  |
| `planTaskIdsByToolCallId` entries are deleted on every tool end | PASS |  |
| Session reset clears active maps and tracker state | PASS |  |
| Plan reload failure preserves valid tracker state without stale task starts | PASS |  |
| Completed/failed tasks cannot be restarted accidentally | PASS |  |
| Test temp directories are removed after each event test | PASS |  |

## Findings

- None if every checklist row remains PASS.

## Recommended Follow-up

- None if no finding is recorded.
```

Replace `PASS` with `FAIL` for any row that contradicts the inspected code or test output, and record the exact file path and line number.

---

### Task 3: Audit plan path loading, markdown validation, and fuzzy task matching bugs

**Dependencies:** Task 1 completed

**Files:**
- Create: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-matching-path-audit.md`
- Review only: `extensions/agentic-harness/plan-progress.ts`
- Review only: `extensions/agentic-harness/plan-progress-events.ts`
- Review only: `extensions/agentic-harness/tests/plan-progress.test.ts`
- Review only: `extensions/agentic-harness/tests/plan-progress-events.test.ts`

- [ ] **Step 1: Inspect path recognition rules**

Run:

```bash
grep -n "ENGINEERING_PLAN_PATH_RE\|GENERIC_PLAN_PATH_RE\|ENGINEERING_PLAN_PATH_IN_TEXT_RE\|isPlanMarkdownPath\|extractPlanPathsFromArgs\|loadPlanFromTextOrFile\|loadPlanFromToolResultEvent" extensions/agentic-harness/plan-progress-events.ts
```

Expected: only intended plan markdown paths are loaded; invalid write confirmation text cannot replace an existing valid plan.

- [ ] **Step 2: Inspect matching rules and false-positive controls**

Run:

```bash
grep -n "STOP_WORDS\|normalizeMatchText\|significantWords\|textMatches\|Task \${task.id}\|startTaskByMatch\|completeTaskByMatch" extensions/agentic-harness/plan-progress.ts
```

Expected: task ID matching works, punctuation is normalized, stop words are ignored, and matching cannot advance already completed/failed tasks.

- [ ] **Step 3: Run matching/path regression tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts --reporter verbose
```

Expected: tests covering write input loading, read result loading, disk fallback, nested `tasks[]`/`chain[]` path extraction, fuzzy matching, and state guards pass.

- [ ] **Step 4: Manually check these bug scenarios against code and tests**

Check each scenario and record PASS or FAIL:

1. `write` result contains only `Wrote file`; existing plan remains loaded.
2. `read` result contains non-plan text; disk fallback is attempted only for a plan markdown path.
3. Relative paths resolve against `ctx.cwd`, not the process root.
4. `args.planFile`, top-level `reads`, nested `tasks[].reads`, nested `tasks[].planFile`, nested `chain[].reads`, nested `chain[].planFile`, and plan paths embedded in task text are considered.
5. Generic `/plans/*.md` matching cannot load arbitrary non-plan markdown from unrelated docs paths.
6. Fuzzy single-word overlap does not let stop words alone match a task.
7. A non-plan subagent task cannot complete a task that was never marked running.

- [ ] **Step 5: Write the matching/path audit artifact**

Create `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-matching-path-audit.md` with these sections:

```markdown
# Plan Tracker Path Loading and Matching Audit

**Date:** 2026-04-29
**Verdict:** PASS | FAIL

## Path Loading Checks

| Scenario | Status | Evidence |
|---|---|---|

## Matching Checks

| Scenario | Status | Evidence |
|---|---|---|

## Findings

- None if every scenario remains PASS.

## Recommended Follow-up

- None if no finding is recorded.
```

---

### Task 4: Audit footer/TUI rendering and display regression risks

**Dependencies:** Task 1 completed

**Files:**
- Create: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-rendering-audit.md`
- Review only: `extensions/agentic-harness/footer.ts`
- Review only: `extensions/agentic-harness/plan-progress.ts`
- Review only: `extensions/agentic-harness/tests/plan-progress.test.ts`
- Review only: `extensions/agentic-harness/tests/render.test.ts`

- [ ] **Step 1: Inspect footer hosting behavior**

Run:

```bash
grep -n "planProgress\|hasPlan\|planProgress.render\|return \[planBorder" extensions/agentic-harness/footer.ts
```

Expected: plan lines render above the normal footer only when `hasPlan()` is true.

- [ ] **Step 2: Inspect tracker render behavior**

Run:

```bash
grep -n "render(theme\|truncateToWidth\|getProgress\|completed / total\|spinnerFrames\|maxWidth" extensions/agentic-harness/plan-progress.ts
```

Expected: pending, running, completed, and failed statuses produce distinct icons; progress summary uses completed/total; long task names are truncated without throwing.

- [ ] **Step 3: Run rendering regression tests**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/render.test.ts --reporter verbose
```

Expected: footer hosting tests and read/write/edit summary rendering tests pass.

- [ ] **Step 4: Manually check these rendering bug scenarios against code and tests**

Check each scenario and record PASS or FAIL:

1. Empty tracker state renders the original footer without plan lines.
2. Active tracker state renders plan border, plan lines, normal border, normal footer line 1, and normal footer line 2 in that order.
3. A running task shows one of `◐`, `◓`, `◑`, `◒`.
4. A completed task shows `✓`; a failed task shows `✗`; a pending task shows `○`.
5. Progress percentage does not divide by zero because `hasPlan()` requires at least one task.
6. Existing read/write/edit tool summaries stay concise and do not expose full file contents in footer summaries.

- [ ] **Step 5: Write the rendering audit artifact**

Create `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-rendering-audit.md` with these sections:

```markdown
# Plan Tracker Rendering Audit

**Date:** 2026-04-29
**Verdict:** PASS | FAIL

## Rendering Checks

| Scenario | Status | Evidence |
|---|---|---|

## Regression Checks

| Scenario | Status | Evidence |
|---|---|---|

## Findings

- None if every scenario remains PASS.

## Recommended Follow-up

- None if no finding is recorded.
```

---

### Task 5: Audit test coverage, QA evidence, docs, and information-leak risks

**Dependencies:** Task 1 completed

**Files:**
- Create: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-verification-evidence-audit.md`
- Review only: `extensions/agentic-harness/tests/plan-progress.test.ts`
- Review only: `extensions/agentic-harness/tests/plan-progress-events.test.ts`
- Review only: `extensions/agentic-harness/tests/render.test.ts`
- Review only: `docs/engineering-discipline/plans/2026-04-28-plan-tracker-qa-fixes.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-28-plan-tracker-qa-fixes-review.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-28-plan-tracker-manual-qa.md`

- [ ] **Step 1: Inspect tests for required behavior coverage**

Run:

```bash
grep -n "does not wipe\|resolves relative\|reloads subagent\|extracts nested\|starts and completes\|failed tool\|state guards\|footer" \
  extensions/agentic-harness/tests/plan-progress.test.ts \
  extensions/agentic-harness/tests/plan-progress-events.test.ts \
  extensions/agentic-harness/tests/render.test.ts
```

Expected: every critical lifecycle path from the original plan has at least one test.

- [ ] **Step 2: Run all relevant automated verification**

Run:

```bash
cd extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts tests/render.test.ts --reporter verbose
npx tsc --noEmit
npx vitest run --reporter dot
```

Expected: targeted tests pass, TypeScript passes, and the full suite passes.

- [ ] **Step 3: Scan scoped docs/tests for accidental secrets or excessive content exposure**

Run:

```bash
grep -RInE "(api[_-]?key|secret|token|password|authorization|bearer|private key|BEGIN [A-Z ]*PRIVATE KEY)" \
  docs/engineering-discipline/plans/2026-04-28-plan-tracker-qa-fixes.md \
  docs/engineering-discipline/reviews/2026-04-28-plan-tracker-qa-fixes-review.md \
  docs/engineering-discipline/reviews/2026-04-28-plan-tracker-manual-qa.md \
  extensions/agentic-harness/tests/plan-progress.test.ts \
  extensions/agentic-harness/tests/plan-progress-events.test.ts \
  extensions/agentic-harness/tests/render.test.ts || true
```

Expected: no real secrets are present. Matches for words used as generic examples are acceptable only if no credential value appears.

- [ ] **Step 4: Check docs claims against test output**

Run:

```bash
grep -n "PASS\|408 tests\|44 tests\|manual\|screenshot\|API environment" \
  docs/engineering-discipline/plans/2026-04-28-plan-tracker-qa-fixes.md \
  docs/engineering-discipline/reviews/2026-04-28-plan-tracker-qa-fixes-review.md \
  docs/engineering-discipline/reviews/2026-04-28-plan-tracker-manual-qa.md
```

Expected: QA documents do not claim a human-observed interactive screenshot; automated evidence claims match actual commands from Step 2.

- [ ] **Step 5: Write the verification/evidence audit artifact**

Create `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-verification-evidence-audit.md` with these sections:

```markdown
# Plan Tracker Verification and Evidence Audit

**Date:** 2026-04-29
**Verdict:** PASS | FAIL

## Automated Verification

| Command | Result | Evidence |
|---|---|---|

## Coverage Checks

| Behavior | Status | Evidence |
|---|---|---|

## Information-Leak Checks

| Check | Status | Evidence |
|---|---|---|

## Documentation Accuracy Checks

| Claim | Status | Evidence |
|---|---|---|

## Findings

- None if every check remains PASS.

## Recommended Follow-up

- None if no finding is recorded.
```

---

### Task 6 (Final): Synthesize verdict and final verification

**Dependencies:** Tasks 1-5 completed

**Files:**
- Create: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-leak-bug-review-summary.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-scope-audit.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-state-lifecycle-audit.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-matching-path-audit.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-rendering-audit.md`
- Review only: `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-verification-evidence-audit.md`

- [ ] **Step 1: Read all audit artifacts**

Run:

```bash
for file in \
  docs/engineering-discipline/reviews/2026-04-29-plan-tracker-scope-audit.md \
  docs/engineering-discipline/reviews/2026-04-29-plan-tracker-state-lifecycle-audit.md \
  docs/engineering-discipline/reviews/2026-04-29-plan-tracker-matching-path-audit.md \
  docs/engineering-discipline/reviews/2026-04-29-plan-tracker-rendering-audit.md \
  docs/engineering-discipline/reviews/2026-04-29-plan-tracker-verification-evidence-audit.md; do
  echo "===== $file ====="
  sed -n '1,260p' "$file"
done
```

Expected: all five audit artifacts exist and include a `Verdict:` line.

- [ ] **Step 2: Run highest-level verification**

Run:

```bash
cd extensions/agentic-harness
npx vitest run --reporter dot
npx tsc --noEmit
```

Expected: full suite passes and TypeScript reports no errors.

- [ ] **Step 3: Check success criteria explicitly**

Record PASS or FAIL for each success criterion:

- [ ] Review states whether implementation is safe to keep, needs follow-up fixes, or should be reverted.
- [ ] Stale in-memory maps were checked.
- [ ] Tracker state leakage between workflows/sessions was checked.
- [ ] Unintended plan content loading was checked.
- [ ] Sensitive data exposure in docs/tests/logs was checked.
- [ ] Temp-file cleanup in tests was checked.
- [ ] Task matching false positives/false negatives were checked.
- [ ] Read/write event loading was checked.
- [ ] Subagent single/parallel/chain tracking was checked.
- [ ] Footer rendering was checked.
- [ ] Failure handling was checked.
- [ ] Regression test coverage was checked.
- [ ] Targeted tests, TypeScript, and full Vitest suite were recorded.

- [ ] **Step 4: Write final synthesis artifact**

Create `docs/engineering-discipline/reviews/2026-04-29-plan-tracker-leak-bug-review-summary.md` with these sections:

```markdown
# Plan Tracker Leak and Bug Review Summary

**Date:** 2026-04-29
**Final Verdict:** PASS | PASS WITH FOLLOW-UP | FAIL

## Executive Summary

One paragraph stating whether the implementation is safe to keep, needs follow-up fixes, or should be reverted.

## Audit Results

| Audit | Verdict | Blocking Findings | Non-Blocking Findings |
|---|---|---:|---:|
| Scope |  |  |  |
| State lifecycle/leaks |  |  |  |
| Path loading/matching |  |  |  |
| Rendering |  |  |  |
| Verification/evidence |  |  |  |

## Confirmed Findings

| Severity | File | Issue | Evidence | Recommended Fix |
|---|---|---|---|---|

## Success Criteria Check

| Criterion | Status | Evidence |
|---|---|---|

## Final Verification

| Command | Result | Evidence |
|---|---|---|

## Follow-up Plan Recommendation

- If Final Verdict is PASS: `No follow-up implementation plan is required.`
- If Final Verdict is PASS WITH FOLLOW-UP: list each non-blocking follow-up as a separate bullet with file path and suggested test.
- If Final Verdict is FAIL: list each blocking fix required before merge or release.
```

Use `PASS` when there are no blocking or non-blocking findings, `PASS WITH FOLLOW-UP` when only non-blocking follow-ups exist, and `FAIL` when any blocking defect or leak risk is confirmed.

---

## Self-Review

- [x] Spec coverage: The plan covers reviewing current implementation correctness, leak risks, bug risks, documentation evidence, and verification status.
- [x] Placeholder scan: The plan contains no deferred-work markers or unspecified implementation steps. Report templates require concrete PASS/FAIL evidence from executed commands.
- [x] Type consistency: All referenced files and commands match the discovered TypeScript/Vitest project structure.
- [x] Dependency verification: Task 1 gates all parallel audits; Tasks 2-5 create separate artifacts and can run in parallel after Task 1; Task 6 depends on all audits.
- [x] Verification coverage: The final task runs the discovered highest-level verification command (`npx vitest run --reporter dot && npx tsc --noEmit`) and checks all success criteria.
