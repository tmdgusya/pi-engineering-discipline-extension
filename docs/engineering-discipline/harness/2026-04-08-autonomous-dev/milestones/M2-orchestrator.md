# Milestone: M2 — Core — Orchestrator with Polling

**ID:** M2
**Status:** pending
**Dependencies:** M1
**Risk:** Medium
**Effort:** Medium

## Goal

Build the clarification-aware orchestrator that polls GitHub, manages state transitions, and handles the autonomous development lifecycle.

## Success Criteria

- [ ] `extensions/autonomous-dev/orchestrator.ts` implements `AutonomousDevOrchestrator` class with start(), stop(), getStatus(), pollCycle()
- [ ] State machine handles: idle → processing → clarification → processing → complete/failed transitions
- [ ] Polling loop with configurable interval (default 60s)
- [ ] Clarification detection correctly identifies author responses after bot questions
- [ ] Max clarification rounds enforcement (default 3)
- [ ] `onSpawnWorker` callback is stubbed to return success (no actual subagent spawning)
- [ ] `extensions/autonomous-dev/tests/orchestrator.test.ts` covers state machine, clarification loop, max rounds with vi.useFakeTimers
- [ ] `npx vitest run extensions/autonomous-dev/tests/orchestrator.test.ts` passes

## Files Affected

- Create: `extensions/autonomous-dev/orchestrator.ts`
- Create: `extensions/autonomous-dev/tests/orchestrator.test.ts`

## User Value

No visible user value yet — internal orchestration only.

## Abort Point

No (core logic, no viable alternative)

## Notes

Highest race condition risk per Risk analysis. Label-based "locking" is not truly atomic — the remove→add sequence can race. Document this limitation.
