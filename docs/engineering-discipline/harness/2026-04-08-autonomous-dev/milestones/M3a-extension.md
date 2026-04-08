# Milestone: M3a — Extension Entry — Tools + Commands

**ID:** M3a
**Status:** pending
**Dependencies:** M1, M2
**Risk:** Medium
**Effort:** Medium

## Goal

Implement the pi extension entry points: 5 GitHub tools and `/autonomous-dev` slash command.

## Success Criteria

- [ ] `extensions/autonomous-dev/index.ts` registers 5 tools: gh_issue_list, gh_issue_read, gh_issue_comment, gh_label, gh_pr_create
- [ ] Each tool has TypeBox schema with proper parameters
- [ ] `/autonomous-dev` command handles subcommands: start, stop, status
- [ ] Extension loads without errors (registered in package.json)
- [ ] `pi.on("session_shutdown")` gracefully stops orchestrator

## Files Affected

- Create: `extensions/autonomous-dev/index.ts`
- Modify: `package.json` (add extension entry)

## User Value

First visible user-facing artifact — developers can see tools and invoke commands.

## Abort Point

Yes (tools are wrappers, can be reimplemented)

## Notes

Hard dependency on agentic-harness for discoverAgents and runAgent. Acceptable constraint for MVP.
