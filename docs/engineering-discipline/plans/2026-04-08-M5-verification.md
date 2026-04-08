# Plan: M5 — Integration Verification

## Context Brief

**Goal:** Validate that all milestones work together as a complete system.

**Success Criteria:**
- Full test suite passes
- No regressions in pre-existing functionality
- Cross-milestone interfaces are exercised
- Extension loads and registers tools/commands without errors

## Task 1: Run full test suite

Execute: `npx vitest run`

Expected: All tests pass

## Task 2: Check extension TypeScript compilation

Execute: `npx tsc --noEmit extensions/autonomous-dev/`

Expected: No TypeScript errors

## Task 3: Verify files exist

Check that all milestone deliverables exist:
- [ ] `extensions/autonomous-dev/types.ts`
- [ ] `extensions/autonomous-dev/github.ts`
- [ ] `extensions/autonomous-dev/orchestrator.ts`
- [ ] `extensions/autonomous-dev/index.ts`
- [ ] `extensions/autonomous-dev/agents/autonomous-dev-worker.md`
- [ ] `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md`
- [ ] `extensions/autonomous-dev/tests/github.test.ts`
- [ ] `extensions/autonomous-dev/tests/orchestrator.test.ts`
- [ ] `extensions/autonomous-dev/package.json`

## Verification

- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] All milestone files exist
