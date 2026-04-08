# Synthesis: Autonomous Dev Engine Milestone Plan

## Conflict Resolution Log
| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| M3 boundaries (single vs split) | **Split M3 into M3a and M3b** | Architecture and User Value both recommend splitting extension plumbing from worker agent definition. These are distinct concerns with different risk profiles and test strategies. |
| Milestone count (4 vs 5 vs 6) | **Adopt 5 milestones** | 4 is too few. 6 over-segments. 5 provides clean boundaries without over-segmentation. |
| Skill documentation placement | **Include in M3b** | User Value's Skill Documentation is low-value and tightly coupled to worker agent definition. Better as part of M3b deliverable. |
| Parallel Issue Processing scope | **Exclude from MVP** | Risk analysis identifies concurrency complexity as out of scope. MVP focuses on sequential processing. |

## Milestone DAG

### M1: Foundation — Types + GitHub Client
- **Goal:** Establish the type system and GitHub API client contract that all downstream components depend on.
- **Success Criteria:**
  - [ ] `extensions/autonomous-dev/types.ts` exports `AUTONOMOUS_LABELS` constant with all 6 label values (ready, in-progress, needs-clarification, review-requested, completed, failed)
  - [ ] `extensions/autonomous-dev/types.ts` exports `WorkerResult` discriminated union (completed, needs-clarification, failed)
  - [ ] `extensions/autonomous-dev/types.ts` exports `OrchestratorConfig`, `DEFAULT_CONFIG`, `GitHubError`
  - [ ] `extensions/autonomous-dev/github.ts` implements all gh CLI wrappers (listIssuesByLabel, getIssueWithComments, postComment, addLabels, removeLabels, swapLabels, lockIssue, markNeedsClarification, resumeFromClarification, createPullRequest, detectRepo, hasNewCommentsAfter)
  - [ ] `extensions/autonomous-dev/tests/github.test.ts` covers core gh operations with mocked execSync
  - [ ] `npx vitest run extensions/autonomous-dev/tests/github.test.ts` passes
- **Dependencies:** None
- **Files:** `extensions/autonomous-dev/types.ts`, `extensions/autonomous-dev/github.ts`, `extensions/autonomous-dev/tests/github.test.ts`
- **Risk:** Low
- **Effort:** Small
- **User Value:** Zero direct user value, but establishes foundation all other work depends on. 5/5 abort tolerance — fully reusable if direction changes.
- **Abort Point:** No (minimum viable foundation)

### M2: Core — Orchestrator with Polling
- **Goal:** Build the clarification-aware orchestrator that polls GitHub, manages state transitions, and handles the autonomous development lifecycle.
- **Success Criteria:**
  - [ ] `extensions/autonomous-dev/orchestrator.ts` implements `AutonomousDevOrchestrator` class with start(), stop(), getStatus(), pollCycle()
  - [ ] State machine handles: idle → processing → clarification → processing → complete/failed transitions
  - [ ] Polling loop with configurable interval (default 60s)
  - [ ] Clarification detection correctly identifies author responses after bot questions
  - [ ] Max clarification rounds enforcement (default 3)
  - [ ] `onSpawnWorker` callback is stubbed to return success (no actual subagent spawning)
  - [ ] `extensions/autonomous-dev/tests/orchestrator.test.ts` covers state machine, clarification loop, max rounds with vi.useFakeTimers
  - [ ] `npx vitest run extensions/autonomous-dev/tests/orchestrator.test.ts` passes
- **Dependencies:** M1
- **Files:** `extensions/autonomous-dev/orchestrator.ts`, `extensions/autonomous-dev/tests/orchestrator.test.ts`
- **Risk:** Medium (highest race condition risk per Risk analysis)
- **Effort:** Medium
- **User Value:** No visible user value yet — internal orchestration only.
- **Abort Point:** No (core logic, no viable alternative)

### M3a: Extension Entry — Tools + Commands
- **Goal:** Implement the pi extension entry points: 5 GitHub tools and `/autonomous-dev` slash command.
- **Success Criteria:**
  - [ ] `extensions/autonomous-dev/index.ts` registers 5 tools: gh_issue_list, gh_issue_read, gh_issue_comment, gh_label, gh_pr_create
  - [ ] Each tool has TypeBox schema with proper parameters
  - [ ] `/autonomous-dev` command handles subcommands: start, stop, status
  - [ ] Extension loads without errors (registered in package.json)
  - [ ] `pi.on("session_shutdown")` gracefully stops orchestrator
- **Dependencies:** M1, M2
- **Files:** `extensions/autonomous-dev/index.ts`, `package.json` (extension entry)
- **Risk:** Medium
- **Effort:** Medium
- **User Value:** First visible user-facing artifact — developers can see tools and invoke commands.
- **Abort Point:** Yes (tools are wrappers, can be reimplemented)

### M3b: Worker Agent — Definition + Skill
- **Goal:** Define the worker subagent with STATUS output contract and create skill documentation.
- **Success Criteria:**
  - [ ] `extensions/autonomous-dev/agents/autonomous-dev-worker.md` defines agent with tools, workflow steps, STATUS output format
  - [ ] STATUS: needs-clarification outputs QUESTION: field
  - [ ] STATUS: completed outputs PR_URL: and SUMMARY: fields
  - [ ] STATUS: failed outputs ERROR: field
  - [ ] `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md` documents label protocol and commands
- **Dependencies:** M1
- **Files:** `extensions/autonomous-dev/agents/autonomous-dev-worker.md`, `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md`
- **Risk:** Medium (integration risk with pi pipeline)
- **Effort:** Small
- **User Value:** Defines the contract that makes the whole system work.
- **Abort Point:** Yes (agent definition can change, contract is the key artifact)

### M4: Integration — Worker Integration + E2E Tests
- **Goal:** Wire the orchestrator to the worker agent, implement actual subagent spawning, and validate end-to-end.
- **Success Criteria:**
  - [ ] `extensions/autonomous-dev/index.ts` implements `onSpawnWorker` using `runAgent()` from agentic-harness
  - [ ] Worker output parsing extracts STATUS: line reliably with regex
  - [ ] Full test suite passes: `npx vitest run extensions/autonomous-dev/tests/`
  - [ ] No regressions in existing tests
  - [ ] package.json includes autonomous-dev in extensions array
- **Dependencies:** M2, M3a, M3b
- **Files:** `extensions/autonomous-dev/index.ts` (updated), `package.json` (extension entry)
- **Risk:** Medium
- **Effort:** Medium
- **User Value:** This is "the whole point" — full autonomous development workflow.
- **Abort Point:** No (this is the deliverable)

### M5: Integration Verification
- **Goal:** Validate that all milestones work together as a complete system.
- **Success Criteria:**
  - [ ] Full test suite passes: `npx vitest run`
  - [ ] No regressions in pre-existing functionality
  - [ ] Cross-milestone interfaces are exercised
  - [ ] Extension loads and registers tools/commands without errors
- **Dependencies:** ALL other milestones
- **Files:** None (read-only verification)
- **Risk:** Medium
- **Effort:** Small
- **User Value:** Confidence that the system works as a whole.
- **Abort Point:** No (final gate)

## Execution Order
```
Phase 1 (sequential): M1 (Foundation)
Phase 2 (parallel):   M2, M3a, M3b (all depend only on M1)
Phase 3 (sequential): M4 (Integration — depends on all of Phase 2)
Phase 4 (sequential): M5 (Verification — final gate)
```

## DAG Visualization
```
M1 (Foundation)
   │
   ├──→ M2 (Orchestrator)
   │
   ├──→ M3a (Extension Entry)
   │
   └──→ M3b (Worker Agent)
              │
              ↓
           M4 (Integration)
              │
              ↓
           M5 (Verification)
```

## Rejected Proposals
| Proposal | Source | Reason for rejection |
|----------|--------|---------------------|
| Single M3 combining Extension + Agent | Feasibility | Creates overly large milestone. M3a and M3b have different risk profiles. |
| 6 milestones (split skill doc separately) | User Value | Over-segments. Skill documentation is tightly coupled to worker agent definition. |
| Parallel Issue Processing (M6) | Risk Analysis | Out of scope for MVP. Concurrency complexity adds significant risk. |
