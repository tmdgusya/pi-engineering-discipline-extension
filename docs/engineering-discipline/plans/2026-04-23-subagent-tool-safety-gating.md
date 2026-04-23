# Subagent Tool Spawn Gating & Cleanup Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** `agentic-harness`의 `subagent` tool 실행 경로에서 동시 실행 상한(10)을 강제하고, abort 전파/cleanup을 tool 계층에서 보강해 리소스 누수 위험을 낮춘다.

**Architecture:** `extensions/agentic-harness/index.ts`에 tool-layer safety wrapper를 추가해 `runAgent` 호출 전후를 통제한다. wrapper는 글로벌 in-flight 카운터를 기준으로 fail-fast gate를 수행하고, tool call별 abort controller를 등록/정리한다. 기존 `runAgent` 내부 정리 로직은 유지하고, 상위 계층에서 queued/active 실행을 더 강하게 차단한다.

**Tech Stack:** TypeScript (ESM), Vitest, Node AbortController/AbortSignal

**Work Scope:**
- **In scope:**
  - `index.ts`에 subagent run gate(상한 10, 즉시 실패) 추가
  - single/parallel/chain/slop-cleaner 4개 경로 전부 gate wrapper 적용
  - tool-layer abort propagation + guaranteed cleanup 추가
  - subagent tool safety 테스트 추가
- **Out of scope:**
  - `subagent.ts` 런타임 전역 수정
  - `autonomous-dev` 경로 수정
  - env/CLI 신규 설정 도입

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npm --prefix extensions/agentic-harness test`
- **What it validates:** harness extension의 unit/integration 성격 테스트(특히 subagent/tool execution 경로)가 회귀 없이 통과함을 검증

**Project Capability Discovery:**
- `.claude/agents`, `.claude/skills` 없음 (프로젝트 전용 에이전트/스킬 힌트 없음)

---

## File Structure Mapping

- **Modify:** `extensions/agentic-harness/index.ts`
  - 역할: subagent tool 실행 안전장치(gate + abort + cleanup) 구현
- **Create:** `extensions/agentic-harness/tests/subagent-tool-safety.test.ts`
  - 역할: tool-layer gate/fail-fast/abort-cleanup 시나리오 검증

---

### Task 1: Add tool-layer subagent gate primitives

**Dependencies:** None (runs first)
**Files:**
- Modify: `extensions/agentic-harness/index.ts:36-41,211-236`
- Test: `extensions/agentic-harness/tests/subagent-tool-safety.test.ts`

- [ ] **Step 1: Add module-level gate state in `index.ts`**

Insert near existing module state (`currentPhase`, `cacheStats`, `activeTools`):

```ts
type SubagentGateState = {
  inFlight: number;
  controllersByToolCall: Map<string, Set<AbortController>>;
};

const subagentGateState: SubagentGateState = {
  inFlight: 0,
  controllersByToolCall: new Map(),
};
```

- [ ] **Step 2: Add helper functions inside extension factory for acquire/release/cleanup**

Add helpers before `pi.registerTool({ name: "subagent", ... })`:

```ts
const registerController = (toolCallId: string, controller: AbortController) => {
  const set = subagentGateState.controllersByToolCall.get(toolCallId) ?? new Set<AbortController>();
  set.add(controller);
  subagentGateState.controllersByToolCall.set(toolCallId, set);
};

const unregisterController = (toolCallId: string, controller: AbortController) => {
  const set = subagentGateState.controllersByToolCall.get(toolCallId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) subagentGateState.controllersByToolCall.delete(toolCallId);
};

const cleanupToolCallControllers = (toolCallId: string) => {
  const set = subagentGateState.controllersByToolCall.get(toolCallId);
  if (!set) return;
  for (const controller of set) controller.abort(`tool_call_cleanup:${toolCallId}`);
  subagentGateState.controllersByToolCall.delete(toolCallId);
};

const buildCapacityError = (mode: "single" | "parallel") => ({
  content: [{ type: "text" as const, text: `Subagent concurrency limit reached (${MAX_CONCURRENCY}). Try fewer concurrent calls.` }],
  details: makeDetails(mode)([]),
  isError: true,
});
```

- [ ] **Step 3: Add gated `runAgentWithSafety` wrapper**

```ts
const runAgentWithSafety = async (
  toolCallId: string,
  mode: "single" | "parallel",
  args: Parameters<typeof runAgent>[0],
  parentSignal: AbortSignal,
) => {
  if (parentSignal.aborted) throw new Error("subagent_parent_aborted_before_start");
  if (subagentGateState.inFlight >= MAX_CONCURRENCY) return buildCapacityError(mode);

  const localController = new AbortController();
  registerController(toolCallId, localController);
  subagentGateState.inFlight += 1;

  const mergedSignal = AbortSignal.any([parentSignal, localController.signal]);

  try {
    return await runAgent({ ...args, signal: mergedSignal });
  } finally {
    unregisterController(toolCallId, localController);
    subagentGateState.inFlight = Math.max(0, subagentGateState.inFlight - 1);
  }
};
```

- [ ] **Step 4: Run type-check to catch helper typing errors**

Run: `npm --prefix extensions/agentic-harness run build`  
Expected: `tsc --noEmit` exits with code 0.

- [ ] **Step 5: Commit Task 1**

```bash
git -C /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension add extensions/agentic-harness/index.ts
git -C /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension commit -m "feat(agentic-harness): add tool-layer subagent gate primitives"
```

---

### Task 2: Apply gate wrapper to all subagent spawn paths + cleanup hooks

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts:228,236-487,1235-1246`

- [ ] **Step 1: Replace all direct `runAgent(...)` calls with `runAgentWithSafety(...)`**

Update 4 call sites:
- chain path (`~line 312`)
- parallel path mapper (`~line 379`)
- single path (`~line 433`)
- slop-cleaner path (`~line 448`)

Example replacement pattern:

```ts
const result = await runAgentWithSafety(toolCallId, "single", {
  agent: singleAgent,
  agentName: agent,
  task: effectiveTask,
  cwd: cwd || defaultCwd,
  depthConfig,
  sandbox: sandboxFor(cwd || defaultCwd),
  onUpdate,
  makeDetails: makeDetails("single"),
  signal,
}, signal);
```

If wrapper returns capacity error object, return it immediately from execute branch.

- [ ] **Step 2: Add execute-level `try/finally` cleanup**

Wrap the body of `execute` so `cleanupToolCallControllers(toolCallId)` is always called:

```ts
execute: async (toolCallId, params, signal, onUpdate, ctx) => {
  try {
    // existing execute logic
  } finally {
    cleanupToolCallControllers(toolCallId);
  }
}
```

- [ ] **Step 3: Align prompt guideline with constants**

Replace hardcoded guideline string with constant-based template:

```ts
`Max ${MAX_PARALLEL_TASKS} parallel tasks with ${MAX_CONCURRENCY} concurrent. Chain mode stops on first error.`
```

- [ ] **Step 4: Add defensive cleanup on extension events**

Extend `tool_execution_end` and `session_start` handlers:

```ts
pi.on("tool_execution_end", async (event, _ctx) => {
  activeTools.running.delete(event.toolCallId);
  cleanupToolCallControllers(event.toolCallId);
});

pi.on("session_start", async (_event, ctx) => {
  // existing resets...
  subagentGateState.inFlight = 0;
  subagentGateState.controllersByToolCall.clear();
});
```

- [ ] **Step 5: Run focused tests for existing subagent lifecycle behavior**

Run: `npm --prefix extensions/agentic-harness test -- tests/subagent-process.test.ts tests/subagent.test.ts`  
Expected: both suites PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git -C /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension add extensions/agentic-harness/index.ts
git -C /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension commit -m "feat(agentic-harness): gate subagent spawns and enforce tool-call cleanup"
```

---

### Task 3: Add tests for fail-fast gate and abort cleanup

**Dependencies:** Runs after Task 2 completes
**Files:**
- Create: `extensions/agentic-harness/tests/subagent-tool-safety.test.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts` (only if shared mocks/helpers need export)

- [ ] **Step 1: Create new test file with mocked `runAgent` and deterministic barriers**

Create `tests/subagent-tool-safety.test.ts` with module mocks:

```ts
import { describe, it, expect, vi } from "vitest";

const runAgentMock = vi.fn();

vi.mock("../subagent.js", async () => {
  const actual = await vi.importActual<any>("../subagent.js");
  return {
    ...actual,
    runAgent: runAgentMock,
  };
});

vi.mock("../agents.js", () => ({
  discoverAgents: vi.fn(async () => [{ name: "worker", prompt: "", model: "default" }, { name: "slop-cleaner", prompt: "", model: "default" }]),
}));
```

- [ ] **Step 2: Add fail-fast cap test (11th spawn fails when 10 in flight)**

Add test scenario:
1. `runAgentMock` returns unresolved promises for first 10 calls.
2. Launch 11th `subagent.execute(...)` call concurrently.
3. Assert 11th result contains `isError: true` and `Subagent concurrency limit reached (10)`.

Run: `npm --prefix extensions/agentic-harness test -- tests/subagent-tool-safety.test.ts -t "fails fast when capacity is full"`  
Expected: PASS.

- [ ] **Step 3: Add abort/cleanup test**

Add test scenario:
1. Create parent `AbortController`.
2. Start one subagent execute call; abort parent signal.
3. Assert no additional queued call starts and gate state is released (subsequent call can run).

Run: `npm --prefix extensions/agentic-harness test -- tests/subagent-tool-safety.test.ts -t "cleans up controllers and releases capacity after abort"`  
Expected: PASS.

- [ ] **Step 4: Run full new test file**

Run: `npm --prefix extensions/agentic-harness test -- tests/subagent-tool-safety.test.ts`  
Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git -C /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension add extensions/agentic-harness/tests/subagent-tool-safety.test.ts extensions/agentic-harness/tests/extension.test.ts
git -C /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension commit -m "test(agentic-harness): cover subagent tool gate and cleanup"
```

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run: `npm --prefix extensions/agentic-harness test`  
Expected: ALL PASS.

- [ ] **Step 2: Verify plan success criteria**

Manually check each criterion from the header:
- [ ] 10 초과 동시 실행 시 즉시 실패한다.
- [ ] single/parallel/chain/slop-cleaner 4개 경로 모두 gate를 통과한다.
- [ ] abort 시 queued 실행 차단 및 cleanup이 보장된다.
- [ ] subagent tool safety 테스트가 재현 가능하게 통과한다.

- [ ] **Step 3: Run type-check/build for regressions**

Run: `npm --prefix extensions/agentic-harness run build`  
Expected: PASS (`tsc --noEmit` exits 0).

---

## Self-Review

- Spec coverage: spawn gate/fail-fast, abort propagation, cleanup, test coverage를 모두 별도 태스크로 반영함.
- Placeholder scan: TBD/TODO/"적절히" 같은 placeholder 없음.
- Type consistency: gate 상수는 `MAX_CONCURRENCY`, 병렬 제한은 `MAX_PARALLEL_TASKS`로 일관 사용.
- Dependency verification: 동일 파일(`index.ts`) 수정 태스크(Task 1,2)는 직렬화했고 테스트(Task 3)는 구현 후 실행하도록 의존성 설정.
- Verification coverage: Final Verification Task 포함, 테스트 스위트 + 타입체크 명령 포함.
