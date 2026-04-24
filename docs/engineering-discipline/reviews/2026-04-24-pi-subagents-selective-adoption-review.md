# pi-subagents Selective Adoption Review

**Date:** 2026-04-24 23:22
**Plan Document:** `docs/engineering-discipline/harness/pi-subagents-selective-adoption/milestones/milestones.md`
**Verdict:** PASS

---

## 1. File Inspection Against Plan

| Planned / Inferred File | Status | Notes |
|---|---|---|
| `extensions/agentic-harness/agents.ts` | OK | `AgentConfig` includes optional `maxOutput`, `maxSubagentDepth`, `output`, `defaultReads`, `defaultProgress`, `context`, and `worktree`. Frontmatter parser remains dependency-free and supports quoted values, comments, numeric fields, booleans, comma arrays, and bracket arrays while preserving existing fields. |
| `extensions/agentic-harness/types.ts` | OK | Adds truncation, artifact, context, and worktree metadata. `truncateForModel` hard-caps model-facing output and `getResultSummaryText` records metadata. |
| `extensions/agentic-harness/subagent.ts` | OK | Applies agent-level `maxSubagentDepth` as a stricter cap, supports artifact-backed `output`/`reads`/`progress`, supports `fresh`/`fork` context modes with fork fail-fast behavior, and supports opt-in worktree execution. |
| `extensions/agentic-harness/artifacts.ts` | OK | Creates run artifact directories, restricts output/progress paths to the run directory, restricts declared reads to workspace-relative paths, and performs bounded reads. |
| `extensions/agentic-harness/worktree.ts` | OK | Creates detached git worktrees, captures capped non-binary diff/status artifacts, and records cleanup status. |
| `extensions/agentic-harness/index.ts` | OK | Public tool schema exposes `maxOutput`, `output`, `reads`, `progress`, `context`, and `worktree`; single/parallel/chain paths pass options through and preserve existing plan-validator behavior. |
| `extensions/agentic-harness/render.ts` | OK | Displays truncation, artifact, context, and worktree metadata without driving core behavior. |
| `extensions/agentic-harness/tests/agents.test.ts` | OK | Covers extended frontmatter fields and invalid extended values. |
| `extensions/agentic-harness/tests/types.test.ts` | OK | Covers truncation behavior and metadata. |
| `extensions/agentic-harness/tests/artifacts.test.ts` | OK | Covers artifact path creation, bounded declared reads, and path escape rejection. |
| `extensions/agentic-harness/tests/worktree.test.ts` | OK | Covers worktree creation, diff capture, and cleanup. |
| `extensions/agentic-harness/tests/render.test.ts` | OK | Covers metadata rendering. |

## 2. Test Results

| Test Command | Result | Notes |
|---|---|---|
| `cd extensions/agentic-harness && npm ci && npm run build && npm test` | PASS | `npm ci` completed, `tsc --noEmit` passed, and Vitest passed. npm audit reports 8 pre-existing vulnerabilities; no new dependencies were added. |

**Full Test Suite:** PASS — 29 test files passed, 262 tests passed.

## 3. Code Quality

- [x] No placeholders
- [x] No debug code
- [x] No commented-out code blocks identified in inspected implementation files
- [x] No changes outside plan scope identified during inspection

**Findings:**
- No blocking code-quality findings.
- The implementation intentionally keeps new functionality additive to preserve existing workflows.

## 4. Git History

| Planned Commit | Actual Commit | Match |
|---|---|---|
| Not specified in milestone plan | Relevant changes are currently uncommitted in the working tree. | N/A |

## 5. Overall Assessment

The implementation satisfies the milestone plan:

- M1 frontmatter/config contract is implemented.
- M2 `maxOutput` and delegation depth controls are implemented.
- M3 artifact directory foundation is implemented.
- M4 file-based `output`/`reads`/`progress` IO is implemented with path restrictions.
- M5 context modes are implemented with `fresh` compatibility and `fork` fail-fast semantics.
- M6 opt-in worktree isolation helpers are implemented and tested.
- M7 public schema/rendering/compatibility wiring is present.
- M_final verification command passes.

Verdict: **PASS**.

## 6. Follow-up Actions

- Optional: add deeper integration tests for full `runAgent` artifact-output orchestration and `context: "fork"` positive path when a real parent session id is available.
- Optional: address existing npm audit findings separately; they are outside this plan and no new dependencies were introduced.
