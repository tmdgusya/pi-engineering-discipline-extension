# Context Compaction Review

**Date:** 2026-04-05
**Plan Document:** `docs/engineering-discipline/plans/2026-04-05-context-compaction.md`
**Verdict:** FAIL

---

## 1. File Inspection Against Plan

| Planned File | Status | Notes |
|---|---|---|
| `extensions/agentic-harness/state.ts` (Create) | EXISTS | Content matches plan specification exactly. Exports `ExtensionState`, `DEFAULT_STATE`, `loadState`, `saveState`, `updateState`. |
| `extensions/agentic-harness/compaction.ts` (Create) | EXISTS | Content matches plan specification. Minor deviation: compacted text uses `[Compacted] tool result` instead of `[Compacted -- tool result]` but tests are consistent with implementation. |
| `extensions/agentic-harness/index.ts` (Modify) | EXISTS, PARTIALLY COMPLIANT | Contains all planned additions (imports, state variables, `STATE_FILE`, `context` handler, `session_before_compact`, `session_compact`, `tool_result` handler, state persistence in commands, `session_start` restore). However, also contains **out-of-scope changes**: (1) `tool_call` logging handler with TypeScript errors, (2) inline refactoring of chain/parallel execution replacing `runChain`/`runParallel` with `mapWithConcurrencyLimit`/manual loop, (3) progress status UI updates in subagent execution. |
| `extensions/agentic-harness/tests/state.test.ts` (Create) | EXISTS | Content matches plan specification exactly. 4 tests. |
| `extensions/agentic-harness/tests/compaction.test.ts` (Create) | EXISTS | Content matches plan. Test assertion for `"All User Messages"` adjusted to match actual prompt casing -- consistent. 11 tests. |
| `extensions/agentic-harness/tests/extension.test.ts` (Modify) | EXISTS | Registers new event handlers (`context`, `session_before_compact`, `session_compact`, `tool_result`). Also includes `tool_call` which is out of scope. Goal Document Tracking test simplified from plan but still validates handler registration. |

## 2. Test Results

| Test Command | Result | Notes |
|---|---|---|
| `npx vitest run` | PASS | 48 passed across 6 test files (state: 4, compaction: 11, agents: 8, subagent: 11, ultraplan: 2, extension: 12) |
| `npx tsc --noEmit` | **FAIL** | 2 errors in `index.ts` lines 425-426: `Property 'name' does not exist on type 'ToolCallEvent'` and `Property 'args' does not exist on type 'ToolCallEvent'`. These errors are in the **out-of-scope** `tool_call` handler (not part of the compaction plan). |

**Full Test Suite:** PASS (48 passed, 0 failed)

## 3. Code Quality

- [x] No placeholders
- [x] No debug code (no `console.log`, `TODO`, `FIXME`, `HACK`, `XXX`)
- [x] No commented-out code blocks
- [ ] No changes outside plan scope

**Findings:**

Three categories of out-of-scope changes in `index.ts`:

1. **`tool_call` handler (lines 417-447):** Logs subagent tool invocations via `ctx.ui.notify`. Not in plan. Causes the only TypeScript compilation errors (`event.name` and `event.args` do not exist on `ToolCallEvent`).

2. **Chain execution inlining (lines 223-280):** Replaced `runChain()` call with manual `for` loop that calls `runSingleAgent` directly, adding progress status updates and `onUpdate` callbacks. Not in plan.

3. **Parallel execution inlining (lines 290-326):** Replaced `runParallel()` call with `mapWithConcurrencyLimit` directly, adding progress status updates and `onUpdate` callbacks. Imports `mapWithConcurrencyLimit` and `MAX_CONCURRENCY` from `subagent.js`. Not in plan.

4. **Single-mode status UI (lines 337-345):** Added `ctx.ui.setStatus` calls around single-mode `runSingleAgent`. Not in plan.

Additionally, the `tool_result` handler uses `event.input.path` instead of `event.details?.file_path` as specified in the plan. This appears to be a deliberate adaptation to match the actual API shape, which is acceptable.

## 4. Git History

| Planned Commit | Actual Commit | Match |
|---|---|---|
| `feat: add extension state persistence module for compaction` | Not committed (files are untracked) | NO |
| `feat: add compaction module with prompts and microcompaction` | Not committed (files are untracked) | NO |
| `feat: wire compaction and microcompaction into extension entry point` | Not committed (index.ts is modified but unstaged) | NO |
| `feat: add active goal document tracking via tool_result handler` | Not committed (extension.test.ts modified but unstaged) | NO |

**No plan-related commits exist.** All new files (`state.ts`, `compaction.ts`, `tests/state.test.ts`, `tests/compaction.test.ts`) are untracked. Modified files (`index.ts`, `tests/extension.test.ts`) have unstaged changes.

## 5. Overall Assessment

The core compaction implementation is functionally complete and all 48 tests pass. The `state.ts` and `compaction.ts` modules closely match their plan specifications. The event handlers (`context`, `session_before_compact`, `session_compact`, `tool_result`) are correctly wired into `index.ts` with appropriate error handling and fallback behavior.

However, the implementation **fails** for two reasons:

1. **TypeScript compilation fails** due to an out-of-scope `tool_call` handler that references properties (`name`, `args`) not present on the `ToolCallEvent` type. This is a blocking defect.

2. **No commits were made.** The plan specified 4 incremental commits. All work exists only as uncommitted/untracked changes in the working tree.

Additionally, significant out-of-scope refactoring was applied to the subagent execution logic (chain inlining, parallel inlining, progress UI), which increases review surface area and risk.

## 6. Follow-up Actions

1. **[BLOCKING] Fix TypeScript error:** Either fix the `tool_call` handler to use correct property names from the `ToolCallEvent` type, or remove it entirely since it is out of scope.
2. **[BLOCKING] Commit the work:** Stage and commit the in-scope files according to the plan's 4-commit structure. Out-of-scope changes should be separated into their own commits.
3. **[RECOMMENDED] Separate out-of-scope changes:** The subagent execution refactoring (chain/parallel inlining, progress UI, `tool_call` handler) should be reverted from this changeset and submitted as a separate plan/PR.
4. **[MINOR] Verify `tool_result` handler field name:** Confirm that `event.input.path` is the correct property on the actual `ToolResultEvent` type from the ExtensionAPI. The plan specified `event.details?.file_path` -- the implementation may be correct but should be type-checked once the tsc issues are resolved.
