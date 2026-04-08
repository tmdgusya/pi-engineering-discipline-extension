# Architecture Analysis: Autonomous Dev Engine

## Key Interfaces and Contracts
| Interface | Location | Purpose |
|-----------|----------|---------|
| GitHub Client | `github.ts` | gh CLI wrappers returning typed data |
| Orchestrator | `orchestrator.ts` | Polling scheduler with worker callback |
| Worker Result | `types.ts` | `WorkerResult` discriminated union |
| Label Protocol | `types.ts` | `AUTONOMOUS_LABELS` constants |
| Extension Tools | `index.ts` | 5 tools + 1 command (public API) |
| Worker Output Contract | `agents/*.md` | `STATUS:` line parsing |

## Dependency Direction
```
types.ts (no deps)          ← Foundation
    ↓
github.ts → types.ts       ← Core GitHub operations
    ↓
orchestrator.ts → types.ts, github.ts
    ↓
index.ts → types.ts, github.ts, orchestrator.ts, agentic-harness
    ↓
autonomous-dev-worker.md (consumed by index.ts via subagent.ts)
    ↓
skills/autonomous-dev/SKILL.md (skill definition)
```

## Interface Risks
1. **Worker output parsing is fragile** — relies on LLM outputting structured text
2. **Label swap is not truly atomic** — remove→add sequentially
3. **gh CLI version dependencies** — requires recent gh version
4. **Worker agent output contract is implicit** — defined in markdown, not enforced

## Pattern Conflicts
1. Orchestrator uses standalone `setInterval` instead of session-loop
2. Hard dependency on agentic-harness (acceptable for MVP)
3. Worker agent does not use existing agentic pipeline (single monolithic agent)
4. No parallelism in MVP scope but architecture assumes it

## Summary
| Milestone | Working State | Key Interfaces |
|-----------|---------------|----------------|
| 1: Types + GitHub Client | Yes | `GitHubIssue`, `AUTONOMOUS_LABELS`, all github.ts functions |
| 2: Orchestrator | Yes (stubbed worker) | `AutonomousDevOrchestrator`, callbacks |
| 3: Extension Entry | Yes | 5 pi tools, `/autonomous-dev` command |
| 4: Worker Agent | Limited | `STATUS:` output contract |
| 5: Integration | Yes (complete) | Worker integration, output parsing |
