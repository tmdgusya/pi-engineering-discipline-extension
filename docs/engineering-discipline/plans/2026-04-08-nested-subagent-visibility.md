# 중첩 Subagent 실시간 가시성 Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Subagent가 다른 subagent를 호출할 때(depth 2+), 실행 중인 중첩 subagent의 존재를 TUI에서 트리 구조로 실시간 표시

**Architecture:** Child pi 프로세스의 `message_end`/`turn_end` 이벤트에서 assistant message의 `toolCall` 파트를 파싱하여 `name === "subagent"`인 호출을 감지. 감지된 정보를 `SingleResult.nestedCalls`에 저장하고, `onUpdate` 콜백을 통해 부모에게 전파. `renderSingleResult`에서 중첩 호출을 들여쓰기 트리 + 상태 아이콘으로 렌더링.

**Tech Stack:** TypeScript, pi-tui (Container, Text), vitest

**Work Scope:**
- **In scope:**
  - `types.ts`: `NestedSubagentCall` 인터페이스 및 `SingleResult.nestedCalls` 필드 추가
  - `runner-events.ts`: assistant message에서 subagent toolCall 감지 로직 추가
  - `render.ts`: `renderSingleResult`에서 중첩 subagent 트리 렌더링
  - 테스트: `runner-events.test.ts`, `render.test.ts`에 중첩 호출 관련 테스트 추가
- **Out of scope:**
  - `renderResult` 결과 표시 개선 (완료 후 결과)
  - 파일 기반 로깅
  - pi 코어 수정
  - footer 변경

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npx vitest run --reporter=verbose`
- **What it validates:** 230개 기존 테스트 회귀 없음 + 새 테스트 통과

---

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `extensions/agentic-harness/types.ts` | Modify | `NestedSubagentCall` 인터페이스 추가, `SingleResult`에 `nestedCalls` 필드 추가 |
| `extensions/agentic-harness/runner-events.ts` | Modify | `addAssistantMessage`에서 subagent toolCall 감지 |
| `extensions/agentic-harness/render.ts` | Modify | `renderSingleResult`에서 중첩 트리 렌더링 |
| `extensions/agentic-harness/tests/runner-events.test.ts` | Modify | 중첩 호출 감지 테스트 추가 |
| `extensions/agentic-harness/tests/render.test.ts` | Modify | 중첩 트리 렌더링 테스트 추가 |

---

### Task 1: NestedSubagentCall 타입 정의

**Dependencies:** None (can run in parallel)
**Files:**
- Modify: `extensions/agentic-harness/types.ts`

- [ ] **Step 1: `NestedSubagentCall` 인터페이스 추가**

`types.ts`의 `SingleResult` 인터페이스 위에 다음 인터페이스를 추가:

```ts
/** A nested subagent call detected from a child process's tool usage. */
export interface NestedSubagentCall {
  agent: string;
  task: string;
}
```

`SingleResult` 인터페이스에 `nestedCalls` 필드 추가 (선택적 필드, 기본값 빈 배열):

```ts
export interface SingleResult {
  agent: string;
  agentSource: "bundled" | "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: any[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  sawAgentEnd?: boolean;
  nestedCalls?: NestedSubagentCall[];
}
```

`emptyUsage` 옆에 헬퍼 함수 추가하지 않음 — `nestedCalls`는 선택적 필드이고 초기값 불필요 (runner-events에서 설정).

- [ ] **Step 2: 기존 테스트 회귀 확인**

Run: `npx vitest run --reporter=verbose`
Expected: ALL 230 tests PASS

- [ ] **Step 3: Commit**

```bash
git add extensions/agentic-harness/types.ts
git commit -m "feat: add NestedSubagentCall type and SingleResult.nestedCalls field"
```

---

### Task 2: Assistant Message에서 Subagent ToolCall 감지

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/runner-events.ts`
- Modify: `extensions/agentic-harness/tests/runner-events.test.ts`

- [ ] **Step 1: `addAssistantMessage`에 subagent toolCall 감지 로직 추가**

`runner-events.ts`의 `addAssistantMessage` 함수 내에서, 메시지 추가 후 content에서 subagent toolCall을 스캔하는 로직을 추가.

현재 `addAssistantMessage` 함수의 `return true;` 직전(즉, `result.messages.push(message)` 이후, `return true` 이전)에 다음 로직을 삽입:

```ts
function addAssistantMessage(result: SingleResult, message: any): boolean {
  if (!message || message.role !== "assistant") return false;

  updateMetadata(result, message);

  const sig = getMessageSignature(message);
  const seen = getSeenSignatures(result);
  if (seen.has(sig)) return false;
  seen.add(sig);

  result.messages.push(message);
  result.usage.turns++;

  const usage = message.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || 0;
  }

  // Detect nested subagent calls from toolCall parts
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (
        part?.type === "toolCall" &&
        part.name === "subagent" &&
        part.arguments
      ) {
        if (!result.nestedCalls) result.nestedCalls = [];
        const args = part.arguments as Record<string, unknown>;
        const agent = (args.agent as string) || "unknown";
        const task = typeof args.task === "string"
          ? args.task.slice(0, 120)
          : "(no task)";
        result.nestedCalls.push({ agent, task });
      }
    }
  }

  return true;
}
```

- [ ] **Step 2: 중첩 호출 감지 테스트 작성**

`runner-events.test.ts`에 다음 테스트를 추가:

```ts
describe("nested subagent detection", () => {
  it("should detect a subagent toolCall in message_end", () => {
    const result: SingleResult = {
      agent: "reviewer",
      agentSource: "bundled",
      task: "review code",
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me run the tests." },
          {
            type: "toolCall",
            name: "subagent",
            arguments: { agent: "worker", task: "Run vitest on the project" },
          },
        ],
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
      },
    });
    const changed = processPiJsonLine(line, result);
    assert.ok(changed);
    assert.equal(result.nestedCalls?.length, 1);
    assert.equal(result.nestedCalls![0].agent, "worker");
    assert.equal(result.nestedCalls![0].task, "Run vitest on the project");
  });

  it("should detect multiple subagent calls across messages", () => {
    const result: SingleResult = {
      agent: "simplify",
      agentSource: "bundled",
      task: "simplify code",
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    // First message with first subagent call
    const line1 = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "subagent", arguments: { agent: "explorer", task: "Find patterns" } },
        ],
        usage: { input: 50, output: 20, totalTokens: 70 },
      },
    });
    // Second message with second subagent call
    const line2 = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Now let me check dependencies." },
          { type: "toolCall", name: "subagent", arguments: { agent: "worker", task: "Fix imports" } },
        ],
        usage: { input: 80, output: 30, totalTokens: 110 },
      },
    });
    processPiJsonLine(line1, result);
    processPiJsonLine(line2, result);
    assert.equal(result.nestedCalls?.length, 2);
    assert.equal(result.nestedCalls![0].agent, "explorer");
    assert.equal(result.nestedCalls![1].agent, "worker");
  });

  it("should not detect non-subagent toolCalls", () => {
    const result: SingleResult = {
      agent: "worker",
      agentSource: "bundled",
      task: "run tests",
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "bash", arguments: { command: "npm test" } },
        ],
        usage: { input: 50, output: 20, totalTokens: 70 },
      },
    });
    processPiJsonLine(line, result);
    assert.equal(result.nestedCalls?.length ?? 0, 0);
  });

  it("should not crash on messages without content array", () => {
    const result: SingleResult = {
      agent: "worker",
      agentSource: "bundled",
      task: "run",
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: "plain string content",
        usage: { input: 10, output: 5, totalTokens: 15 },
      },
    });
    const changed = processPiJsonLine(line, result);
    assert.ok(changed);
    assert.equal(result.nestedCalls, undefined);
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `npx vitest run extensions/agentic-harness/tests/runner-events.test.ts --reporter=verbose`
Expected: ALL tests PASS (기존 + 새 테스트 4개)

- [ ] **Step 4: Commit**

```bash
git add extensions/agentic-harness/runner-events.ts extensions/agentic-harness/tests/runner-events.test.ts
git commit -m "feat: detect nested subagent calls from child process messages"
```

---

### Task 3: 중첩 Subagent 트리 렌더링

**Dependencies:** Runs after Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/render.ts`
- Modify: `extensions/agentic-harness/tests/render.test.ts`

- [ ] **Step 1: `renderNestedCalls` 헬퍼 함수 추가**

`render.ts`에 `renderSingleResult` 함수 위에 다음 헬퍼를 추가:

```ts
function renderNestedCalls(r: SingleResult, fg: ThemeFg): string {
  if (!r.nestedCalls || r.nestedCalls.length === 0) return "";
  const isRunning = r.exitCode === -1;
  const lines: string[] = [];
  for (const call of r.nestedCalls) {
    const icon = isRunning ? fg("warning", "⏳") : fg("success", "✓");
    const taskPreview = truncate(call.task, 50);
    lines.push(`  ${fg("muted", "└─")} ${icon} ${fg("accent", call.agent)} ${fg("dim", taskPreview)}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: `renderSingleResult` collapsed 뷰에 중첩 호출 표시 추가**

`renderSingleResult` 함수의 collapsed 분기에서, tool call display items 렌더링 이후에 nested calls를 추가.

현재 collapsed 분기의 구조:
```
icon agent (source)
[display items or error]
[usage]
```

다음과 같이 변경 (display items 이후, usage 이전에 nested calls 삽입):

collapsed 분기에서 `renderDisplayItems(...)` 호출 이후, usage 이전에:

```ts
  // After: text += `\n${renderDisplayItems(displayItems, false, ...)}`
  // Add nested calls tree
  const nestedText = renderNestedCalls(r, theme.fg.bind(theme));
  if (nestedText) text += `\n${nestedText}`;
```

구체적으로, collapsed 뷰의 `else` 분기 (displayItems가 있는 경우)를 다음과 같이 수정:

```ts
  } else {
    text += `\n${renderDisplayItems(displayItems, false, theme.fg.bind(theme), COLLAPSED_LINE_COUNT)}`;
    if (countDisplayLines(displayItems) > COLLAPSED_LINE_COUNT) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
  }
```

→

```ts
  } else {
    text += `\n${renderDisplayItems(displayItems, false, theme.fg.bind(theme), COLLAPSED_LINE_COUNT)}`;
    if (countDisplayLines(displayItems) > COLLAPSED_LINE_COUNT) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
  }

  const nestedText = renderNestedCalls(r, theme.fg.bind(theme));
  if (nestedText) text += `\n${nestedText}`;
```

즉, 에러 메시지 분기와 displayItems 분기 모두 이후에, usage 이전에 nested calls를 삽입.

- [ ] **Step 3: `renderSingleResult` expanded 뷰에도 중첩 호출 표시 추가**

expanded 뷰에서는 tool call 목록 이후, Output 섹션 이전에 nested calls 섹션을 추가:

```ts
    // After tool call items loop, before Output section:
    // Nested subagent calls
    if (r.nestedCalls && r.nestedCalls.length > 0) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Nested Calls ───"), 0, 0));
      const nestedText = renderNestedCalls(r, theme.fg.bind(theme));
      container.addChild(new Text(nestedText, 0, 0));
    }
```

- [ ] **Step 4: 렌더링 테스트 작성**

`render.test.ts`에 다음 테스트를 추가:

```ts
import type { NestedSubagentCall, SingleResult } from "../types.js";

describe("renderNestedCalls via renderSingleResult", () => {
  // We test by creating a SingleResult with nestedCalls and checking the collapsed render output.
  // Since renderSingleResult is not exported, we test via renderResult.

  it("should show nested subagent calls in collapsed result", () => {
    const result: SingleResult = {
      agent: "reviewer-architecture",
      agentSource: "bundled",
      task: "review the plan",
      exitCode: -1,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check the implementation." },
            { type: "toolCall", name: "subagent", arguments: { agent: "worker", task: "Run the test suite" } },
          ],
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      ],
      stderr: "",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 150, turns: 1 },
      nestedCalls: [{ agent: "worker", task: "Run the test suite" }],
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult(
      { content: [{ type: "text", text: "(running...)" }], details },
      false,
      theme,
    );
    const text = rendered.toString();
    assert.ok(text.includes("worker"), `Expected "worker" in rendered output: ${text}`);
    assert.ok(text.includes("⏳"), `Expected ⏳ icon in rendered output: ${text}`);
    assert.ok(text.includes("└─"), `Expected tree branch in rendered output: ${text}`);
  });

  it("should show ✓ for nested calls when parent completed", () => {
    const result: SingleResult = {
      agent: "reviewer-architecture",
      agentSource: "bundled",
      task: "review the plan",
      exitCode: 0,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Review complete." },
          ],
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      ],
      stderr: "",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 150, turns: 1 },
      stopReason: "end_turn",
      nestedCalls: [{ agent: "worker", task: "Run the test suite" }],
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult(
      { content: [{ type: "text", text: "Review complete." }], details },
      false,
      theme,
    );
    const text = rendered.toString();
    assert.ok(text.includes("worker"), `Expected "worker" in rendered output: ${text}`);
    assert.ok(text.includes("✓"), `Expected ✓ icon in rendered output: ${text}`);
  });
});
```

- [ ] **Step 5: 테스트 실행**

Run: `npx vitest run extensions/agentic-harness/tests/render.test.ts --reporter=verbose`
Expected: ALL tests PASS (기존 13개 + 새 테스트 2개)

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/render.ts extensions/agentic-harness/tests/render.test.ts
git commit -m "feat: render nested subagent calls as indented tree with status icons"
```

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL tests PASS (기존 230개 + 새 테스트 6개 = 236개)

- [ ] **Step 2: Verify plan success criteria**

- [ ] depth 1 subagent가 depth 2 subagent를 호출할 때, TUI에서 트리 구조(`└─`)로 표시됨
- [ ] 실행 중(⏳), 완료(✓) 상태 아이콘 표시
- [ ] 기존 단일 레벨 subagent 표시는 변경 없이 동작 (nestedCalls 없으면 기존과 동일)

- [ ] **Step 3: Run full test suite for regressions**

Run: `npx vitest run --reporter=verbose`
Expected: No regressions — all tests pass
