# Plan Tracker TUI Lifecycle QA Evidence

**Date:** 2026-04-29 00:32
**Plan:** `docs/engineering-discipline/plans/2026-04-28-plan-tracker-qa-fixes.md`
**QA mode:** Non-interactive lifecycle smoke in API environment, backed by TUI render/unit coverage and full test suite.

## Scenario Checked

The user-reported failure was:

1. A plan is created by plan-crafting or milestone-planning and written to a `.md` file.
2. The Plan Progress panel appears briefly.
3. Later, during plan execution, the panel disappears and does not show task progress.

The implemented lifecycle now covers:

- Plan write event loads actual markdown from `event.input.content` or disk fallback.
- Plan read event loads result text or disk fallback.
- Invalid write confirmations do not wipe an existing valid tracker state.
- Existing plan execution reloads the plan from subagent `planFile`, `reads`, nested `tasks[]`/`chain[]`, or plan paths embedded in task text before task tracking starts.
- Matched task IDs are stored by `toolCallId` and completed/failed on `tool_execution_end`.
- Footer renders active plan lines above the normal footer.

## Evidence Commands

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness
npx vitest run tests/plan-progress.test.ts tests/plan-progress-events.test.ts tests/render.test.ts --reporter verbose
npx tsc --noEmit
npx vitest run --reporter dot
```

## Evidence Results

- Targeted lifecycle/render tests: PASS — 44 tests passed.
- TypeScript compile: PASS.
- Full suite: PASS — 39 test files, 408 tests passed.

## Relevant Test Coverage

- `tests/plan-progress-events.test.ts`
  - loads write events from `input.content` plan markdown
  - does not wipe existing plan when write result is only confirmation text
  - loads read events from result text
  - resolves relative plan paths against cwd for disk fallback
  - reloads subagent single-mode args from `planFile`
  - reloads subagent args from `reads`
  - reloads from a plan path embedded in task text
  - extracts nested parallel and chain plan paths
  - starts/completes single, parallel `tasks[]`, and `chain[]` plan-worker tasks
  - marks stored running tasks failed on tool execution failure

- `tests/plan-progress.test.ts`
  - initial pending/running/completed/failed/total counts
  - guarded task transitions
  - fuzzy matching
  - footer hosting: plan lines render above normal footer
  - render indicators: `○`, spinner `◐/◓/◑/◒`, `✓`, `✗`
  - completed/total summary semantics

- `tests/render.test.ts`
  - read/write/edit tool calls remain summary-style

## QA Checklist

| Check | Result | Evidence |
|---|---|---|
| Plan written by plan-crafting/milestone-planning loads from actual markdown | PASS | write input content + disk fallback tests |
| Write confirmation text does not clear the panel | PASS | invalid/confirmation write preservation test |
| Existing plan reloads when execution starts | PASS | subagent `planFile`, `reads`, task-text path tests |
| Single-mode plan-worker tracking works | PASS | single-mode subagent task tracking test |
| Parallel `tasks[]` tracking works | PASS | parallel tasks tracking test |
| Chain `chain[]` tracking works | PASS | chain tracking test |
| Footer hosts active panel above normal footer | PASS | RoachFooter hosting test |
| Running task shows spinner frames | PASS | PlanProgressTracker render test |
| Completed task shows `✓` | PASS | PlanProgressTracker render test |
| Failed task shows `✗` | PASS | PlanProgressTracker render test |
| Read/write/edit summaries remain concise | PASS | render non-regression tests |

## Notes

This API session cannot provide a true human-observed interactive TUI screenshot. The QA evidence therefore uses the same production rendering/event helper paths with automated lifecycle assertions and full-suite verification. A future human smoke check can still run `pi` interactively to visually confirm the same behavior, but no code-level blocker remains.
