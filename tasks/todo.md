# Task: Selective pi-subagents Feature Adoption Milestone Plan

**Created:** 2026-04-24 22:13
**Status:** milestone-planning

## Goal
Plan a dependency-light implementation of selected `nicobailon/pi-subagents` ideas into `extensions/agentic-harness`, explicitly excluding Model Fallback.

## Scope
- [x] Compose a self-contained Problem Brief
- [x] Run 5 independent milestone reviewers in parallel
- [x] Synthesize reviewer outputs into a milestone DAG
- [x] Validate the DAG independently
- [x] Present milestone plan for user approval
- [x] Save approved milestone artifacts under `docs/engineering-discipline/harness/pi-subagents-selective-adoption/`
- [x] Implement milestones M1–M7
- [x] Run parallel review and address findings
- [x] Run final verification
- [x] Save independent review document

## Follow-up Plan: Subagent Integration Test Hardening

- [x] Write executable plan for fork positive-path and artifact output orchestration integration tests
- [x] Execute follow-up plan if approved

### Follow-up execution results
- Added fork positive-path integration coverage in `extensions/agentic-harness/tests/subagent-process.test.ts`.
- Added artifact output orchestration integration coverage in `extensions/agentic-harness/tests/subagent-process.test.ts` and `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`.
- Hardened `extensions/agentic-harness/tests/extension.test.ts` so root-session tests clear inherited subagent environment variables.
- Stabilized the existing late-abort semantic-success test by waiting for semantic output before aborting.
- Final verification: PASS — `cd extensions/agentic-harness && npm ci && npm run build && npm test` (29 files, 264 tests).

## Requested Feature Set
- `maxOutput` / output truncation
- agent-level `maxSubagentDepth`
- dependency-free frontmatter parser improvements
- `output` / `reads` / `progress` file-based IO
- chain/run artifact directory
- parallel `worktree` isolation
- `context: "fork"` session mode

## Excluded
- Model Fallback
- depending on `pi-subagents` as a package
- Agents Manager TUI
- MCP direct tools
- Intercom bridge
- Gist session sharing
- full async/background framework

## Verification Strategy
- **Command:** `cd extensions/agentic-harness && npm ci && npm run build && npm test`
- **Validates:** extension-local dependency install, strict TypeScript build, and full Vitest regression suite.

## Review

### Reviewer Dispatch
- 5/5 reviewers completed successfully:
  - reviewer-feasibility
  - reviewer-architecture
  - reviewer-risk
  - reviewer-dependency
  - reviewer-user-value

### Key synthesis decisions
- Treat `context: "fork"` as spike-gated because current child launch uses `--no-session` and true fork feasibility depends on Pi session support.
- Keep worktree isolation opt-in and late because it has the highest repository-state/cleanup risk.
- Establish config/result contracts before exposing public schema and runtime behavior.
- Keep all new fields additive and dependency-free; no Model Fallback or `pi-subagents` package dependency.

### Status
- Milestone DAG drafted and independently validated.
- User requested autonomous execution through completion.
- Implementation completed.
- Final verification passed: `cd extensions/agentic-harness && npm ci && npm run build && npm test`.

### Final verification
- Build: PASS (`tsc --noEmit`)
- Tests: PASS — 29 files, 262 tests
- Review: PASS — `docs/engineering-discipline/reviews/2026-04-24-pi-subagents-selective-adoption-review.md`
- Note: `npm ci` reported 8 existing npm audit vulnerabilities; no new dependencies were added in this change.
