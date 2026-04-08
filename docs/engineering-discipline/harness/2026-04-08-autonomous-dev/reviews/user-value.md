# User Value Analysis: Autonomous Dev Engine

## Value-Ordered Milestone Sequence

### 1. GitHub Client (M1)
- **Value:** A verified, standalone GitHub API layer. User sees tests go green.
- **Demo:** Run tests with mocked gh CLI
- **Abort tolerance:** ⭐⭐⭐⭐⭐

### 2. Extension Entry Point (M4a)
- **Value:** User can type `/autonomous-dev start`, `/autonomous-dev stop`, `/autonomous-dev status`
- **Demo:** Load pi, run `/autonomous-dev status` — see "not running" response
- **Abort tolerance:** ⭐⭐⭐⭐

### 3. Worker Agent Definition (M4b)
- **Value:** Highest-value deliverable — defines how the system judges ambiguity
- **Demo:** Feed sample issue into worker agent, verify STATUS marker output
- **Abort tolerance:** ⭐⭐

### 4. Orchestrator (M2)
- **Value:** Wires client + agent into polling loop with label locking
- **Demo:** Run orchestrator tests — verify poll cycle, clarification, max rounds
- **Abort tolerance:** ⭐⭐

### 5. Skill Documentation (M5)
- **Value:** Discoverable documentation — low direct value
- **Abort tolerance:** ⭐⭐⭐⭐

### 6. Integration + E2E (M6)
- **Value:** Everything works end-to-end
- **Demo:** Label issue `autonomous-dev:ready`, run `/autonomous-dev start`, watch PR appear
- **Abort tolerance:** ⭐

## Minimum Viable Milestone
**M1 (GitHub client)** — proven, reusable, zero waste if aborted

## Natural Abort Points
| After | What You Have |
|-------|---------------|
| M1 | Tested gh CLI wrapper — reusable for any gh automation |
| M2 | Orchestrator with full clarification loop |
| M4 | Functional extension with GitHub tools + commands |

## Low-Value Milestones to Cut If Short on Time
1. SKILL.md — can be written after everything works
2. Integration step — mechanical wiring if M1-M4 complete

## Recommended Restructure
Split Task 3 into two milestones:
- M4a: Extension entry (tools + commands, extension loads)
- M4b: Worker agent (STATUS marker protocol)
