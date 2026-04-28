# Plan Tracker State Lifecycle and Leak Audit

**Date:** 2026-04-29
**Verdict:** FAIL

## Checklist

| Check | Status | Evidence |
|---|---|---|
| `activeTools.running` entries are deleted on every tool end | PASS | `extensions/agentic-harness/index.ts:1557` sets `activeTools.running`; `extensions/agentic-harness/index.ts:1572` deletes by `toolCallId` in `tool_execution_end`; `extensions/agentic-harness/index.ts:1592` clears on `session_start`. |
| `toolCallArgsById` entries are deleted on every tool end | PASS | `extensions/agentic-harness/index.ts:1094` stores tool call args; `extensions/agentic-harness/index.ts:1582` deletes by `toolCallId` in `tool_execution_end`; `extensions/agentic-harness/index.ts:1593` clears on `session_start`. |
| `planTaskIdsByToolCallId` entries are deleted on every tool end | PASS | `extensions/agentic-harness/index.ts:1565` stores matched plan task ids; `extensions/agentic-harness/index.ts:1583` deletes by `toolCallId` in `tool_execution_end`; `extensions/agentic-harness/index.ts:1594` clears on `session_start`. |
| Session reset clears active maps and tracker state | PASS | `extensions/agentic-harness/index.ts:1592-1595` clears `activeTools.running`, `toolCallArgsById`, `planTaskIdsByToolCallId`, and `planProgress` on `session_start`; workflow commands also call `planProgress.clear()` at `extensions/agentic-harness/index.ts:1240`, `1267`, and `1497`. |
| Plan reload failure preserves valid tracker state without stale task starts | FAIL | `extensions/agentic-harness/index.ts:1562-1563` ignores the boolean result of `reloadPlanFromSubagentArgs(...)` and always calls `startPlanSubagentTasks(...)` when args exist. `extensions/agentic-harness/plan-progress-events.ts:132-140` returns `false` when no referenced plan can be loaded, while `extensions/agentic-harness/plan-progress-events.ts:172-183` can still start matching tasks against the previously loaded tracker. |
| Completed/failed tasks cannot be restarted accidentally | PASS | `extensions/agentic-harness/plan-progress.ts:102-107` only starts a task when status is `pending`; `extensions/agentic-harness/plan-progress.ts:110-126` skips non-`pending` tasks in match-based starts; `extensions/agentic-harness/plan-progress.ts:128-133` only completes `running` tasks; `extensions/agentic-harness/plan-progress.ts:136-153` skips non-`running` tasks in match-based completion. |
| Test temp directories are removed after each event test | PASS | `extensions/agentic-harness/tests/plan-progress-events.test.ts:103-108` has `afterEach` popping every temp root and calling `rm(root, { recursive: true, force: true })`. Leak-focused tests passed: `Test Files  2 passed (2)`, `Tests  25 passed (25)`. |

## Findings

- `extensions/agentic-harness/index.ts:1562-1563` can start tasks from a stale previously loaded plan when `reloadPlanFromSubagentArgs(...)` fails to load the plan referenced by the current subagent args. The reload helper preserves the prior valid tracker state on failure (`extensions/agentic-harness/plan-progress-events.ts:132-140`), but the caller does not check whether the current args referenced a plan that failed to load before calling `startPlanSubagentTasks(...)`. This is a state-lifecycle false progress risk during the subagent run.
- Potential stale-map risk: `extensions/agentic-harness/index.ts:1094` stores every `tool_call` before approval/blocking paths such as `extensions/agentic-harness/index.ts:1103`, `1124`, `1148`, `1160`, `1173`, and `1197`. The observed cleanup is on `tool_execution_end` (`extensions/agentic-harness/index.ts:1582-1583`) and `session_start` (`extensions/agentic-harness/index.ts:1593-1594`); if blocked calls do not emit `tool_execution_end`, these entries remain until session reset.

## Recommended Follow-up

- In `extensions/agentic-harness/index.ts`, gate `startPlanSubagentTasks(...)` on successful reload when the current subagent args contain plan paths, and add a regression test for failed subagent plan reload not starting tasks from a previously loaded plan.
- Add or confirm cleanup coverage for blocked `tool_call` events so `toolCallArgsById` cannot retain entries until session reset when execution is denied before `tool_execution_start`/`tool_execution_end`.
