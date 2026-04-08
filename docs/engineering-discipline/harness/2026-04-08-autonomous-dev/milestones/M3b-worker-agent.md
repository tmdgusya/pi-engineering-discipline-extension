# Milestone: M3b — Worker Agent — Definition + Skill

**ID:** M3b
**Status:** pending
**Dependencies:** M1
**Risk:** Medium
**Effort:** Small

## Goal

Define the worker subagent with STATUS output contract and create skill documentation.

## Success Criteria

- [ ] `extensions/autonomous-dev/agents/autonomous-dev-worker.md` defines agent with tools, workflow steps, STATUS output format
- [ ] STATUS: needs-clarification outputs QUESTION: field
- [ ] STATUS: completed outputs PR_URL: and SUMMARY: fields
- [ ] STATUS: failed outputs ERROR: field
- [ ] `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md` documents label protocol and commands

## Files Affected

- Create: `extensions/autonomous-dev/agents/autonomous-dev-worker.md`
- Create: `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md`

## User Value

Defines the contract that makes the whole system work.

## Abort Point

Yes (agent definition can change, contract is the key artifact)

## Notes

Highest-value deliverable. STATUS output parsing is fragile — relies on LLM outputting structured text. Consider structured output in future iterations.
