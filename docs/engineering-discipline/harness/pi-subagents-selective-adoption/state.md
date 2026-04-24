# State: pi-subagents Selective Adoption

**Status:** completed
**Started:** 2026-04-24
**Verification Strategy:** `cd extensions/agentic-harness && npm ci && npm run build && npm test`

## Non-goals
- No Model Fallback.
- No dependency on `nicobailon/pi-subagents`.
- No new third-party runtime dependency.
- No Agents Manager TUI/CRUD, MCP direct tools, Intercom bridge, Gist sharing, or full async/background framework.

## Milestones
| ID | Name | Status | Dependencies | Attempts |
|---|---|---|---|---:|
| M1 | Baseline Contracts and Frontmatter Foundation | completed | - | 1 |
| M2 | Safe Output and Delegation Limits | completed | M1 | 1 |
| M3 | Run Artifact Directory | completed | M1 | 1 |
| M4 | File-Based IO | completed | M3 | 1 |
| M5 | Session Context Modes | completed | M1,M2 | 1 |
| M6 | Parallel Worktree Isolation | completed | M3,M4 | 1 |
| M7 | Public Schema, Rendering, and Compatibility | completed | M1,M2,M3,M4,M5,M6 | 1 |
| M_final | Integration Verification | completed | M7 | 2 |

## Execution Log
- 2026-04-24: User approved autonomous execution through the end without intermediate questions.
- 2026-04-24: Implemented selected feature set and ran parallel code review.
- 2026-04-24: Addressed review findings for path safety, truncation bounds, bounded IO, worktree defaults, rendering coverage, and semantic abort handling.
- 2026-04-24: Final verification passed: `cd extensions/agentic-harness && npm ci && npm run build && npm test`.
