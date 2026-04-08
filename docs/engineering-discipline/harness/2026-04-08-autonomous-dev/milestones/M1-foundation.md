# Milestone: M1 — Foundation — Types + GitHub Client

**ID:** M1
**Status:** pending
**Dependencies:** None
**Risk:** Low
**Effort:** Small

## Goal

Establish the type system and GitHub API client contract that all downstream components depend on.

## Success Criteria

- [ ] `extensions/autonomous-dev/types.ts` exports `AUTONOMOUS_LABELS` constant with all 6 label values (ready, in-progress, needs-clarification, review-requested, completed, failed)
- [ ] `extensions/autonomous-dev/types.ts` exports `WorkerResult` discriminated union (completed, needs-clarification, failed)
- [ ] `extensions/autonomous-dev/types.ts` exports `OrchestratorConfig`, `DEFAULT_CONFIG`, `GitHubError`
- [ ] `extensions/autonomous-dev/github.ts` implements all gh CLI wrappers (listIssuesByLabel, getIssueWithComments, postComment, addLabels, removeLabels, swapLabels, lockIssue, markNeedsClarification, resumeFromClarification, createPullRequest, detectRepo, hasNewCommentsAfter)
- [ ] `extensions/autonomous-dev/tests/github.test.ts` covers core gh operations with mocked execSync
- [ ] `npx vitest run extensions/autonomous-dev/tests/github.test.ts` passes

## Files Affected

- Create: `extensions/autonomous-dev/types.ts`
- Create: `extensions/autonomous-dev/github.ts`
- Create: `extensions/autonomous-dev/tests/github.test.ts`

## User Value

Zero direct user value, but establishes foundation all other work depends on. 5/5 abort tolerance — fully reusable if direction changes.

## Abort Point

No (minimum viable foundation)
