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

## Team Mode Exploration Test: subagent / team 오케스트레이션 관련 파일 조사

- [x] Identify likely entry points for `team` and `subagent` orchestration
- [x] Dispatch parallel explorers to inspect command surface, execution flow, and tests/docs
- [x] Summarize findings with file map and next-step recommendations

## Bug Fix Plan: team run state ENOENT on persist

Done when:
- [x] Reproduce the `team` persist failure or equivalent low-level `writeTeamRunRecord` collision deterministically
- [x] Add a failing regression test that captures the root cause
- [x] Apply the smallest fix to eliminate temp-file rename collisions during concurrent persists
- [x] Verify the new regression and related team-state/team tests pass

### Bug fix results
- Root cause: concurrent `writeTeamRunRecord()` calls could generate the same temp-file path because the name only used `process.pid` + `Date.now()`. Same-millisecond persists then raced on the same `*.tmp` path, causing `rename(...tmp, team-run.json)` to throw `ENOENT` after another writer had already moved the file.
- Regression test added: `extensions/agentic-harness/tests/team-state.test.ts`
- Fix applied: `extensions/agentic-harness/team-state.ts` now adds a random hex suffix to each temp-file path before `rename()`.
- Verification:
  - `cd extensions/agentic-harness && npm test -- --run tests/team-state.test.ts` ✅
  - `cd extensions/agentic-harness && npm test -- --run tests/team.test.ts` ✅
  - `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts` ✅
  - `cd extensions/agentic-harness && npm run build` ✅
  - `cd extensions/agentic-harness && npm test` ✅ (31 files, 286 tests)

## Bug Fix Plan: ask_user_question direct input fallback text should be English

Done when:
- [x] Reproduce the current Korean fallback label in the ask_user_question tool behavior
- [x] Add or update a regression test that expects the English fallback label
- [x] Change the fallback constant and schema/prompt text to use the English label consistently
- [x] Verify the targeted ask_user_question tests and extension build pass

### Bug fix results
- Reproduced via `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts` after changing the ask_user_question assertions to expect English; the suite failed because the tool still appended and matched `직접 입력하기`.
- Regression test updated: `extensions/agentic-harness/tests/extension.test.ts`
- Fix applied: `extensions/agentic-harness/index.ts` now uses `Enter custom response` for the fallback choice label and schema description.
- Verification:
  - `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts` ✅
  - `cd extensions/agentic-harness && npm run build` ✅

### Exploration results
- Native `team` runtime files: `extensions/agentic-harness/team.ts`, `extensions/agentic-harness/team-state.ts`
- Shared delegation runtime: `extensions/agentic-harness/subagent.ts`, `extensions/agentic-harness/runner-events.ts`, `extensions/agentic-harness/agents.ts`
- User-facing registration: `extensions/agentic-harness/index.ts`
- Strongest coverage: `extensions/agentic-harness/tests/team.test.ts`, `extensions/agentic-harness/tests/team-state.test.ts`, `extensions/agentic-harness/tests/subagent.test.ts`, `extensions/agentic-harness/tests/subagent-process.test.ts`, `extensions/agentic-harness/tests/extension.test.ts`
- Docs/evidence: `extensions/agentic-harness/README.md`, `README.md`, `docs/engineering-discipline/reviews/2026-04-27-roach-pi-team-mode-verification.md`
- Note: direct `team` tool invocation created `.pi/agent/runs/team-demo-test/team-run.json` but returned an `ENOENT` rename error from the tool wrapper; parallel `explorer` subagents succeeded as fallback for the investigation.

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

## Plan: Team mode tmux backend

- [x] Clarify desired behavior: use tmux when available, keep native fallback otherwise
- [x] Inspect current team/subagent architecture and verification surface
- [x] Write executable implementation plan in `docs/engineering-discipline/plans/2026-04-27-team-mode-tmux-backend.md`
- [x] Begin subagent execution
- [x] Task 1 complete — backend contract, schema, and state fields landed (`9444b54`)
- [x] Task 2 complete — tmux helper module and tests landed (`9c11abe`)
- [x] Task 3 complete — tmux backend runtime integration landed (`ae6ff4b`, fixup `f0e0e12`)
- [x] Task 4 complete — docs and root registration verification landed (`dc536b0`)
- [x] Task 5 complete — final verification passed

### Team mode tmux backend execution results
- Task 1 commit: `9444b54 feat: add team backend selection contract`
- Task 2 commit: `9c11abe feat: add tmux helper module for team backend`
- Task 3 commits: `ae6ff4b feat: integrate optional tmux backend for team workers`, `f0e0e12 fix: type tmux availability mock`
- Task 4 commit: `dc536b0 docs: describe team tmux backend and fallback behavior`
- Final verification: `cd extensions/agentic-harness && npm run build && npm test` ✅
- Focused regression: `cd extensions/agentic-harness && npm test -- --run tests/tmux.test.ts tests/team.test.ts tests/subagent-process.test.ts tests/extension.test.ts` ✅

## Bug Fix Plan: team mode should auto split/attach inside an existing tmux client

Done when:
- [x] Reproduce the current behavior where team mode creates a detached tmux session instead of splitting the operator's active tmux client
- [x] Add failing regression coverage for "inside tmux" pane creation/attach behavior
- [x] Implement the smallest root-cause fix so team mode reuses the current tmux session/window when launched from tmux, while preserving detached fallback outside tmux
- [x] Verify focused tmux/team/subagent tests and extension build pass

### Bug fix results
- Reproduced from the existing tmux helper behavior and tests: `createWorkerPanes()` always issued `tmux new-session -d ...`, so worker panes were created in a detached session rather than the operator's current tmux window.
- Regression coverage added in `extensions/agentic-harness/tests/tmux.test.ts` for current-window pane creation and in `extensions/agentic-harness/tests/team.test.ts` for team-level ready/cleanup behavior.
- Fix applied in `extensions/agentic-harness/tmux.ts`, `extensions/agentic-harness/team.ts`, and `extensions/agentic-harness/index.ts`: when `TMUX`/`TMUX_PANE` are present, team mode now splits worker panes into the current tmux window, emits a current-window ready message, and cleans up worker panes on successful completion; detached-session fallback remains unchanged outside tmux.
- Docs updated: `extensions/agentic-harness/README.md`.
- Verification:
  - `cd extensions/agentic-harness && npm test -- --run tests/tmux.test.ts tests/team.test.ts` ✅
  - `cd extensions/agentic-harness && npm test -- --run tests/subagent-process.test.ts tests/extension.test.ts && npm run build` ✅

## Plan: Team tmux backend bugfix hardening

- [x] Review reported bug list with independent bug/security/performance reviewers
- [x] Write executable hardening plan in `docs/engineering-discipline/plans/2026-04-27-team-tmux-bugfix-hardening.md`
- [x] Begin subagent execution
- [x] Task 1 complete — tmux shell command handling hardened (`1f1907c`)
- [x] Task 2 complete — tmux runtime log/lifecycle hardened (`f2c682a`)
- [x] Task 3 complete — team-level setup/session robustness hardened (`0bedd7c`)
- [x] Task 4 complete — tmux cleanup/sandbox caveats documented (`94302e3`)
- [x] Task 5 complete — final verification passed after residual tmux binary propagation fix

### Team tmux backend bugfix hardening final review notes
- Highest-level verification: PASS — `cd extensions/agentic-harness && npm run build && npm test` (33 files, 305 tests).
- Focused tmux hardening regression suite: PASS — `cd extensions/agentic-harness && npm test -- --run tests/shell.test.ts tests/tmux.test.ts tests/subagent-process.test.ts tests/team.test.ts tests/extension.test.ts` (5 files, 79 tests).
- Manual success criteria: PASS — residual issue fixed by typing `RunAgentOptions.tmuxPane.tmuxBinary/sessionAttempt`, removing the `index.ts` cast, and using `tmuxPane.tmuxBinary ?? "tmux"` for tmux runtime `send-keys` launch and C-c termination. Added regression coverage proving a custom tmux binary handles `send-keys`.
- Manual success criteria verified as covered by code/tests: shell-quoted `pipe-pane` log paths, stderr-only tmux helper warnings, detected tmux binary propagation through setup/runtime/cleanup, stale marker truncation, duplicate `tee` removal, useful tmux failure log tail, setup failure persistence, collision retry without deleting existing sessions, incremental log polling, tmux lifecycle/process-log events, and native behavior regression coverage.
- Hardening commits relevant to this work: `1f1907c fix: harden tmux shell command handling`; `f2c682a fix: harden tmux runtime log and lifecycle handling`; `0bedd7c fix: handle tmux setup failures and session collisions`; `94302e3 docs: clarify tmux cleanup and sandbox caveats`; `e80f23f fix: use resolved tmux binary for worker send-keys`.
