# Plan: M4 — Integration — Worker Integration

## Context Brief

**Goal:** Wire the orchestrator's worker spawner to the actual subagent and add STATUS line parsing.

**Success Criteria:**
- Extension's worker spawner calls actual subagent
- Worker output parsing extracts STATUS: line
- Full test suite passes
- Extension registers without errors

**Files to modify:**
- `extensions/autonomous-dev/index.ts` — Wire worker spawner to agent
- Potentially `extensions/autonomous-dev/orchestrator.ts` — No changes needed if using setWorkerSpawner

**Dependencies (all complete):**
- M1: types.ts, github.ts
- M2: orchestrator.ts (with setWorkerSpawner method)
- M3a: index.ts (extension entry)
- M3b: autonomous-dev-worker.md (agent definition)

**Constraints:**
- Worker output parsing via regex from STATUS: line
- Agent spawn via agentic-harness subagent

---

## Task 1: Update extensions/autonomous-dev/index.ts

Modify the extension to wire the real worker spawner:

```typescript
import { runAgent } from "../agentic-harness/subagent.js";
import type { WorkerResult } from "./types.js";

// At the bottom of the default function (pi: ExtensionAPI), add:
```

Key changes:
1. Import `runAgent` from agentic-harness
2. Replace the stub worker spawner with a real one that:
   - Calls `runAgent` with the autonomous-dev-worker agent
   - Parses the STATUS line from the output
   - Returns a WorkerResult

---

## Task 2: Run full test suite

Execute: `npx vitest run extensions/autonomous-dev/tests/`

Expected: All tests pass

---

## Verification

- [ ] Extension loads without errors
- [ ] Worker spawner calls actual agent (not stubbed)
- [ ] STATUS parsing extracts completed/needs-clarification/failed
- [ ] All autonomous-dev tests pass
