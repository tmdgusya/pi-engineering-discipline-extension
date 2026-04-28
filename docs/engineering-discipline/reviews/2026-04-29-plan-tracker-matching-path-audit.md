# Plan Tracker Path Loading and Matching Audit

**Date:** 2026-04-29
**Verdict:** PASS

## Path Loading Checks

| Scenario | Status | Evidence |
|---|---|---|
| Only intended plan markdown paths are recognized | PASS | `extensions/agentic-harness/plan-progress-events.ts:18-20` defines engineering-plan and generic `plans/` path regexes; `isPlanMarkdownPath()` applies them at `:26-28`. |
| Invalid write confirmation text cannot replace an existing valid plan | PASS | `loadPlanFromToolResultEvent()` uses `input.content` for writes at `extensions/agentic-harness/plan-progress-events.ts:125-129`; `loadPlanFromTextOrFile()` only calls `tracker.loadPlan()` when `hasPlanTasks()` succeeds at `:98-100` or disk fallback succeeds at `:106-108`. Test `does not wipe an existing plan when a write event only has a confirmation result` passed at `extensions/agentic-harness/tests/plan-progress-events.test.ts:131`. |
| `write` result contains only `Wrote file`; existing plan remains loaded | PASS | The write path ignores result text and validates only `input.content`/disk fallback (`extensions/agentic-harness/plan-progress-events.ts:125-129`); regression test at `extensions/agentic-harness/tests/plan-progress-events.test.ts:131` passed. |
| `read` result contains non-plan text; disk fallback is attempted only for a plan markdown path | PASS | `loadPlanFromToolResultEvent()` rejects non-plan paths before extracting read text (`extensions/agentic-harness/plan-progress-events.ts:123`), then `loadPlanFromTextOrFile()` falls back to disk only for valid plan paths (`:103-108`). Disk fallback regression test passed at `extensions/agentic-harness/tests/plan-progress-events.test.ts:160`. |
| Relative paths resolve against `ctx.cwd`, not the process root | PASS | `resolvePlanPath()` uses `resolve(cwd ?? process.cwd(), filePath)` for relative paths (`extensions/agentic-harness/plan-progress-events.ts:39-40`); read/write fallback test with explicit `cwd` passed at `extensions/agentic-harness/tests/plan-progress-events.test.ts:160`. |
| `args.planFile`, top-level `reads`, nested `tasks[].reads`, nested `tasks[].planFile`, nested `chain[].reads`, nested `chain[].planFile`, and plan paths embedded in task text are considered | PASS | `extractPlanPathsFromArgs()` adds top-level `planFile`, `reads`, task-text paths, and nested `tasks`/`chain` at `extensions/agentic-harness/plan-progress-events.ts:72-81`; nested item handling includes `record.planFile`, `record.reads`, and task text at `:61-68`. Tests for top-level `planFile`, top-level `reads`, task-text paths, and nested parallel/chain extraction passed at `extensions/agentic-harness/tests/plan-progress-events.test.ts:184`, `:200`, `:215`, and `:229`. |
| Generic `/plans/*.md` matching cannot load arbitrary non-plan markdown from unrelated docs paths | PASS | Generic path recognition is limited to `plans`/`plan` directories (`extensions/agentic-harness/plan-progress-events.ts:19`), and `loadPlanFromTextOrFile()` requires `hasPlanTasks()` before loading text or disk content (`:98-108`), so non-plan markdown is rejected. |

## Matching Checks

| Scenario | Status | Evidence |
|---|---|---|
| Task ID matching works | PASS | `startTaskByMatch()` and `completeTaskByMatch()` check normalized `Task ${task.id}` strings at `extensions/agentic-harness/plan-progress.ts:113-118` and `:139-144`; `matches Task N references` passed at `extensions/agentic-harness/tests/plan-progress.test.ts:197`. |
| Punctuation is normalized | PASS | `normalizeMatchText()` lowercases and replaces non-alphanumeric runs with spaces at `extensions/agentic-harness/plan-progress.ts:36-41`, and all matching flows use it before comparisons (`:51-52`, `:113`, `:139`). |
| Stop words are ignored | PASS | `STOP_WORDS` is defined at `extensions/agentic-harness/plan-progress.ts:13-33`; `significantWords()` filters words shorter than four characters and stop words at `:44-47`. Test `does not match stop words alone` passed at `extensions/agentic-harness/tests/plan-progress.test.ts:213`. |
| Fuzzy single-word overlap does not let stop words alone match a task | PASS | `textMatches()` returns false when either significant-word list is empty (`extensions/agentic-harness/plan-progress.ts:62-64`), and the stop-word-only regression test passed at `extensions/agentic-harness/tests/plan-progress.test.ts:213`. |
| Matching cannot advance already completed/failed tasks | PASS | Starts only consider pending tasks (`extensions/agentic-harness/plan-progress.ts:115`), and completions only consider running tasks (`:141`). Lifecycle guard test passed at `extensions/agentic-harness/tests/plan-progress.test.ts:151`. |
| A non-plan subagent task cannot complete a task that was never marked running | PASS | `completePlanSubagentTasks()` without stored IDs delegates to `completeTaskByMatch()` (`extensions/agentic-harness/plan-progress-events.ts:186-204`), and `completeTaskByMatch()` skips every task whose status is not `running` (`extensions/agentic-harness/plan-progress.ts:141`). Non-plan subagent start behavior is covered at `extensions/agentic-harness/tests/plan-progress-events.test.ts:294`; stored-ID completion tests passed at `:238`, `:258`, `:276`, and failure completion at `:310`. |
| Matching/path regression tests pass | PASS | `cd extensions/agentic-harness && npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts --reporter verbose` reported `Test Files  2 passed (2)` and `Tests  25 passed (25)`. |

## Findings

- None.

## Recommended Follow-up

- None.
