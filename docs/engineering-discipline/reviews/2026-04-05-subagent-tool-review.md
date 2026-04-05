# Subagent Tool Implementation Review

**Date:** 2026-04-05
**Plan Document:** `docs/engineering-discipline/plans/2026-04-05-subagent-tool.md`
**Verdict:** PASS

---

## 1. File Inspection Against Plan

| Planned File | Status | Notes |
|---|---|---|
| `extensions/agentic-harness/agents.ts` | EXISTS, MATCHES | All 4 exports present: AgentConfig, parseFrontmatter, loadAgentsFromDir, discoverAgents. 107 lines. |
| `extensions/agentic-harness/subagent.ts` | EXISTS, MATCHES | All exports present: SubagentResult, getPiInvocation, extractFinalOutput, mapWithConcurrencyLimit, runSingleAgent, runParallel, runChain, MAX_PARALLEL_TASKS=8, MAX_CONCURRENCY=4. 246 lines. |
| `extensions/agentic-harness/index.ts` | EXISTS, MATCHES | `subagent` tool registered (line 182) with 6 promptGuidelines. PHASE_GUIDANCE updated: clarifying references "subagent tool in single mode", ultraplanning references "subagent tool's parallel mode" with all 5 reviewers named. /clarify and /ultraplan prompts updated. No "Explore subagent" or "Agent tool" references remain. |
| `extensions/agentic-harness/package.json` | EXISTS, DEVIATION | Plan specified adding `@mariozechner/pi-ai` dependency for `StringEnum`. Dependency was NOT added. See deviation note below. |
| `extensions/agentic-harness/tests/agents.test.ts` | EXISTS, MATCHES | 8 tests: parseFrontmatter (4) + loadAgentsFromDir (4). All match plan specification. |
| `extensions/agentic-harness/tests/subagent.test.ts` | EXISTS, MATCHES | 11 tests: extractFinalOutput (5) + mapWithConcurrencyLimit (4) + getPiInvocation (1) + Constants (1). All match plan specification. |
| `extensions/agentic-harness/tests/extension.test.ts` | EXISTS, MATCHES | "should register subagent tool" test added (checks name, promptSnippet, 6 promptGuidelines). /clarify test asserts "subagent". Ultraplan test asserts "subagent" and "Feasibility". |

**Deviation: `@mariozechner/pi-ai` not added to package.json**

The plan specified using `StringEnum` from `@mariozechner/pi-ai` for the `agentScope` parameter. During execution, a type incompatibility was discovered: `Type.Optional(TUnsafe<...>)` produced a TypeScript error. The worker used `Type.Unsafe<"user" | "project" | "both">` directly from `@sinclair/typebox` instead, which produces an identical runtime JSON Schema. This eliminated the need for the `@mariozechner/pi-ai` dependency. The deviation is functionally equivalent and avoids an unnecessary dependency.

## 2. Test Results

| Test Command | Result | Notes |
|---|---|---|
| `npm test` | PASS | 32 passed, 0 failed (4 test files, 348ms) |
| `npx tsc --noEmit` | PASS | Clean compile, no type errors |

**Full Test Suite:** PASS (32 passed, 0 failed)

**Test breakdown:**
- `tests/agents.test.ts`: 8 tests (parseFrontmatter: 4, loadAgentsFromDir: 4)
- `tests/subagent.test.ts`: 11 tests (extractFinalOutput: 5, mapWithConcurrencyLimit: 4, getPiInvocation: 1, Constants: 1)
- `tests/extension.test.ts`: 11 tests (registration: 3, ask_user_question: 4, before_agent_start: 1, /clarify: 1, /plan: 1, subagent registration: 1)
- `tests/ultraplan.test.ts`: 2 tests (delegation: 1, cancellation: 1)

## 3. Code Quality

- [x] No placeholders
- [x] No debug code
- [x] No commented-out code blocks
- [x] No changes outside plan scope

**Findings:**
- `extensions/agentic-harness/index.ts:167` — `Type.Unsafe<"user" | "project" | "both">` used instead of plan's `StringEnum(["user", "project", "both"])`. Runtime-equivalent, avoids dependency. Non-functional deviation.

## 4. Git History

| Planned Commit | Actual Commit | Match |
|---|---|---|
| Task 1: `feat: add agent discovery module (agents.ts)` | `e5b7ca59 feat: add agent discovery module (agents.ts)` | EXACT |
| Task 2: `feat: add subagent execution engine (subagent.ts)` | `83c7bf8b feat: add subagent execution engine (subagent.ts)` | EXACT |
| Task 3: `test: add agent discovery tests (parseFrontmatter, loadAgentsFromDir)` | `d59dd2fe test: add agent discovery tests (parseFrontmatter, loadAgentsFromDir)` | EXACT |
| Task 4: `test: add subagent execution engine tests (extractFinalOutput, concurrency, helpers)` | `71507045 test: add subagent execution engine tests (extractFinalOutput, concurrency, helpers)` | EXACT |
| Task 5: `feat: register subagent tool and update PHASE_GUIDANCE` | `2946bdc6 feat: register subagent tool and update PHASE_GUIDANCE` | EXACT |
| Task 6: `test: update tests for subagent tool registration and PHASE_GUIDANCE changes` | `f6c6598e test: update tests for subagent tool registration and PHASE_GUIDANCE changes` | EXACT |

**Commit scope verification:** All 6 commits modify only the files specified in their respective tasks. Task 5 commit (`2946bdc6`) modifies only `extensions/agentic-harness/index.ts` (1 file, 198 insertions, 9 deletions). Note: package.json was NOT modified in this commit despite the plan specifying it, because the `@mariozechner/pi-ai` dependency was not needed.

## 5. Overall Assessment

The implementation faithfully matches the plan document. All 7 planned files exist with correct content. All acceptance criteria are met:

- `agents.ts` discovers agents from `~/.pi/agent/agents/` (user) and `.pi/agents/` (project) -- confirmed
- `subagent.ts` spawns `pi --mode json -p --no-session` subprocesses -- confirmed
- Worker-pool concurrency control with MAX_CONCURRENCY=4, MAX_PARALLEL_TASKS=8 -- confirmed
- Chain mode replaces `{previous}` with prior step output, stops on first error -- confirmed
- AbortSignal handling with SIGTERM then SIGKILL after 5s -- confirmed
- `subagent` tool registered with TypeBox schema supporting single/parallel/chain modes -- confirmed
- PHASE_GUIDANCE references "subagent tool" (not "Agent tool" or "Explore subagents") -- confirmed
- Ultraplan guidance specifies all 5 mandatory reviewers (Feasibility, Architecture, Risk, Dependency, User Value) -- confirmed
- All 32 tests pass, TypeScript compiles clean, no residual artifacts -- confirmed

The only deviation is using `Type.Unsafe` instead of `StringEnum` for the `agentScope` enum, which is functionally equivalent and actually improves the design by avoiding an unnecessary runtime dependency.

## 6. Follow-up Actions

- The root `README.md` still contains outdated descriptions ("Native TUI questionnaire", references to HUD Dashboard). Update recommended.
- Consider creating sample agent `.md` files (e.g., `scout.md`, `reviewer.md`) in `~/.pi/agent/agents/` so the subagent tool has agents to invoke.
- Integration testing of the actual subprocess spawning (current tests cover helpers only, not the `spawn` calls) could be added in a future iteration.
- Streaming `onUpdate` progress during subagent execution was explicitly out of scope — consider for a future plan.
