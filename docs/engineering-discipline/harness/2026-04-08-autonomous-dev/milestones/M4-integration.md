# Milestone: M4 — Integration — Worker Integration

**ID:** M4
**Status:** pending
**Dependencies:** M2, M3a, M3b
**Risk:** Medium
**Effort:** Medium

## Goal

Wire the orchestrator to the worker agent, implement actual subagent spawning, and validate end-to-end.

## Success Criteria

- [ ] `extensions/autonomous-dev/index.ts` implements `onSpawnWorker` using `runAgent()` from agentic-harness
- [ ] Worker output parsing extracts STATUS: line reliably with regex
- [ ] Full test suite passes: `npx vitest run extensions/autonomous-dev/tests/`
- [ ] No regressions in existing tests
- [ ] package.json includes autonomous-dev in extensions array

## Files Affected

- Modify: `extensions/autonomous-dev/index.ts` (update onSpawnWorker implementation)
- Modify: `package.json` (verify extension entry)

## User Value

This is "the whole point" — full autonomous development workflow.

## Abort Point

No (this is the deliverable)

## Notes

This connects the stubbed orchestrator to the actual worker agent. Integration test should verify full lifecycle without hitting real GitHub API.
