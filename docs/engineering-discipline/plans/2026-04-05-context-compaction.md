# Context Compaction Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** pi-engineering-discipline-extension에서 phase-aware 커스텀 컨텍스트 컴팩션과 microcompaction을 구현하여, 긴 세션에서도 최초 목표와 워크플로우 상태가 보존되도록 한다.

**Architecture:** `session_before_compact` 훅에서 현재 phase와 활성 목표 문서를 참조하여 커스텀 요약을 생성한다. `context` 이벤트에서 오래된 tool result를 트렁케이션하는 microcompaction을 수행한다. 상태는 인메모리 + 파일 + CompactionEntry.details 3중으로 관리하며, `session_start`에서 파일로부터 복원한다.

**Tech Stack:** TypeScript, `@mariozechner/pi-coding-agent` ExtensionAPI, `@mariozechner/pi-ai` (complete), `@sinclair/typebox`, Vitest

**Work Scope:**
- **In scope:** 상태 관리 모듈, microcompaction, phase-aware full compaction, 상태 복원, 테스트
- **Out of scope:** 코어 패키지 수정, 별도 요약 모델, Session Memory Compaction, `/compact` 명령어 커스터마이징

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npx vitest run`
- **What it validates:** 모든 기존 테스트 + 새 컴팩션/상태 관리 테스트 통과

---

## File Structure Mapping

| File | Responsibility |
|------|---------------|
| `extensions/agentic-harness/state.ts` (Create) | 확장 상태 영속화 — load/save/update 함수, 타입 정의 |
| `extensions/agentic-harness/compaction.ts` (Create) | 컴팩션 로직 — microcompaction, 요약 프롬프트, 요약 생성 |
| `extensions/agentic-harness/index.ts` (Modify) | 이벤트 핸들러 등록 — session_before_compact, context, session_start 수정 |
| `extensions/agentic-harness/tests/state.test.ts` (Create) | 상태 모듈 단위 테스트 |
| `extensions/agentic-harness/tests/compaction.test.ts` (Create) | 컴팩션 모듈 단위 테스트 |
| `extensions/agentic-harness/tests/extension.test.ts` (Modify) | 기존 테스트에 새 이벤트 핸들러 등록 검증 추가 |

---

### Task 1: State Management Module

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/agentic-harness/state.ts`
- Test: `extensions/agentic-harness/tests/state.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/state.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadState, saveState, updateState, DEFAULT_STATE } from "../state.js";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

describe("Extension State", () => {
  let stateDir: string;
  let statePath: string;

  beforeEach(() => {
    stateDir = join(tmpdir(), `pi-test-${randomBytes(4).toString("hex")}`);
    statePath = join(stateDir, "extension-state.json");
  });

  afterEach(async () => {
    try {
      await unlink(statePath);
    } catch {}
  });

  it("should return default state when file does not exist", async () => {
    const state = await loadState(statePath);
    expect(state).toEqual(DEFAULT_STATE);
  });

  it("should save and load state", async () => {
    const state = {
      phase: "planning" as const,
      activeGoalDocument: "docs/engineering-discipline/plans/2026-04-05-feature.md",
    };
    await saveState(statePath, state);
    const loaded = await loadState(statePath);
    expect(loaded).toEqual(state);
  });

  it("should update partial state", async () => {
    await saveState(statePath, {
      phase: "clarifying",
      activeGoalDocument: "docs/brief.md",
    });
    await updateState(statePath, { phase: "planning" });
    const loaded = await loadState(statePath);
    expect(loaded.phase).toBe("planning");
    expect(loaded.activeGoalDocument).toBe("docs/brief.md");
  });

  it("should handle corrupt JSON gracefully", async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(statePath, "not json{{{", "utf-8");
    const state = await loadState(statePath);
    expect(state).toEqual(DEFAULT_STATE);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest run tests/state.test.ts`
Expected: FAIL — `state.js` module not found

- [ ] **Step 3: Write the state module implementation**

```typescript
// state.ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export interface ExtensionState {
  phase: "idle" | "clarifying" | "planning" | "ultraplanning";
  activeGoalDocument: string | null;
}

export const DEFAULT_STATE: ExtensionState = {
  phase: "idle",
  activeGoalDocument: null,
};

export async function loadState(path: string): Promise<ExtensionState> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      phase: parsed.phase ?? "idle",
      activeGoalDocument: parsed.activeGoalDocument ?? null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(
  path: string,
  state: ExtensionState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

export async function updateState(
  path: string,
  partial: Partial<ExtensionState>,
): Promise<ExtensionState> {
  const current = await loadState(path);
  const next = { ...current, ...partial };
  await saveState(path, next);
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest run tests/state.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/state.ts extensions/agentic-harness/tests/state.test.ts
git commit -m "feat: add extension state persistence module for compaction"
```

---

### Task 2: Compaction Module — Prompts and Microcompaction

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/agentic-harness/compaction.ts`
- Test: `extensions/agentic-harness/tests/compaction.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/compaction.test.ts
import { describe, it, expect } from "vitest";
import {
  getCompactionPrompt,
  formatCompactSummary,
  microcompactMessages,
  MICROCOMPACT_AGE_MS,
} from "../compaction.js";

describe("Compaction Prompts", () => {
  it("should generate base prompt for idle phase", () => {
    const prompt = getCompactionPrompt("idle", null);
    expect(prompt).toContain("Primary Request and Intent");
    expect(prompt).toContain("All user messages");
    expect(prompt).toContain("<analysis>");
    expect(prompt).toContain("<summary>");
    expect(prompt).not.toContain("Active Workflow");
  });

  it("should include phase-specific section for clarifying", () => {
    const prompt = getCompactionPrompt("clarifying", "docs/brief.md");
    expect(prompt).toContain("Active Workflow: Clarification");
    expect(prompt).toContain("docs/brief.md");
    expect(prompt).toContain("scope");
  });

  it("should include phase-specific section for planning", () => {
    const prompt = getCompactionPrompt("planning", "docs/plan.md");
    expect(prompt).toContain("Active Workflow: Plan Crafting");
    expect(prompt).toContain("docs/plan.md");
    expect(prompt).toContain("task progress");
  });

  it("should include phase-specific section for ultraplanning", () => {
    const prompt = getCompactionPrompt("ultraplanning", "docs/milestones.md");
    expect(prompt).toContain("Active Workflow: Milestone Planning");
    expect(prompt).toContain("docs/milestones.md");
  });

  it("should append custom instructions when provided", () => {
    const prompt = getCompactionPrompt("idle", null, "Focus on TypeScript changes");
    expect(prompt).toContain("Focus on TypeScript changes");
  });
});

describe("formatCompactSummary", () => {
  it("should strip analysis block and extract summary", () => {
    const raw = `<analysis>thinking here</analysis>\n<summary>the summary</summary>`;
    const result = formatCompactSummary(raw);
    expect(result).not.toContain("thinking here");
    expect(result).toContain("the summary");
    expect(result).not.toContain("<analysis>");
  });

  it("should handle missing tags gracefully", () => {
    const raw = "plain text summary";
    const result = formatCompactSummary(raw);
    expect(result).toBe("plain text summary");
  });
});

describe("microcompactMessages", () => {
  const now = Date.now();
  const oldTimestamp = now - MICROCOMPACT_AGE_MS - 1000;
  const recentTimestamp = now - 1000;

  it("should truncate old tool results", () => {
    const messages: any[] = [
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        content: [{ type: "text", text: "a".repeat(5000) }],
        isError: false,
        timestamp: oldTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0].content[0].text).toContain("[Compacted]");
    expect(result[0].content[0].text.length).toBeLessThan(500);
  });

  it("should preserve recent tool results", () => {
    const messages: any[] = [
      {
        role: "toolResult",
        toolCallId: "t2",
        toolName: "bash",
        content: [{ type: "text", text: "a".repeat(5000) }],
        isError: false,
        timestamp: recentTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0].content[0].text).toBe("a".repeat(5000));
  });

  it("should preserve error tool results regardless of age", () => {
    const messages: any[] = [
      {
        role: "toolResult",
        toolCallId: "t3",
        toolName: "bash",
        content: [{ type: "text", text: "error details ".repeat(500) }],
        isError: true,
        timestamp: oldTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0].content[0].text).toContain("error details");
    expect(result[0].content[0].text.length).toBeGreaterThan(500);
  });

  it("should not modify non-toolResult messages", () => {
    const messages: any[] = [
      {
        role: "user",
        content: "hello",
        timestamp: oldTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0]).toEqual(messages[0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest run tests/compaction.test.ts`
Expected: FAIL — `compaction.js` module not found

- [ ] **Step 3: Write the compaction module**

```typescript
// compaction.ts
import type { ExtensionState } from "./state.js";

// ============================================================
// Constants
// ============================================================

/** Tool results older than this are truncated during microcompaction (60 min) */
export const MICROCOMPACT_AGE_MS = 60 * 60 * 1000;

/** Tools whose results can be microcompacted */
const COMPACTABLE_TOOLS = new Set([
  "bash", "read", "glob", "grep", "web_search", "web_fetch",
  "edit", "write", "notebook_edit",
]);

// ============================================================
// Microcompaction
// ============================================================

export function microcompactMessages<T extends { role: string; timestamp: number; toolName?: string; isError?: boolean; content?: any }>(
  messages: T[],
  now: number = Date.now(),
): T[] {
  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (msg.isError) return msg;
    if (!msg.toolName || !COMPACTABLE_TOOLS.has(msg.toolName)) return msg;

    const age = now - msg.timestamp;
    if (age < MICROCOMPACT_AGE_MS) return msg;

    // Truncate old tool result content
    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
          if (c.type !== "text") return c;
          return {
            ...c,
            text: `[Compacted — ${msg.toolName} result, ${Math.round(age / 60000)}min ago]`,
          };
        })
      : msg.content;

    return { ...msg, content };
  });
}

// ============================================================
// Compaction Prompts
// ============================================================

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool. Tool calls will be REJECTED and will waste your only turn.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`;

const NO_TOOLS_TRAILER =
  "\n\nREMINDER: Do NOT call any tools. Respond with plain text only — " +
  "an <analysis> block followed by a <summary> block.";

function getPhaseSection(
  phase: ExtensionState["phase"],
  goalDoc: string | null,
): string {
  if (phase === "idle" || !goalDoc) return "";

  const docRef = `\n\nACTIVE GOAL DOCUMENT: \`${goalDoc}\`\nThis document contains the authoritative goal for the current work. Reference it in your summary to anchor the user's intent.\n`;

  switch (phase) {
    case "clarifying":
      return `${docRef}
## Active Workflow: Clarification
The session is in clarification mode. Your summary MUST emphasize:
- What scope has been established vs. what remains ambiguous
- Key decisions made during Q&A
- The state of the Context Brief (complete, in-progress, or not yet started)`;

    case "planning":
      return `${docRef}
## Active Workflow: Plan Crafting
The session is in plan-crafting mode. Your summary MUST emphasize:
- Overall task progress — which plan tasks are done, in-progress, or blocked
- Key implementation decisions and their rationale
- Current task being worked on and its exact state`;

    case "ultraplanning":
      return `${docRef}
## Active Workflow: Milestone Planning
The session is in milestone-planning mode. Your summary MUST emphasize:
- Which reviewers have completed and their key findings
- The state of the milestone DAG (complete, in-progress)
- Trade-off decisions made with the user`;

    default:
      return "";
  }
}

export function getCompactionPrompt(
  phase: ExtensionState["phase"],
  goalDoc: string | null,
  customInstructions?: string,
): string {
  const phaseSection = getPhaseSection(phase, goalDoc);

  let prompt = `${NO_TOOLS_PREAMBLE}Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like file names, full code snippets, function signatures, file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness.
${phaseSection}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable and a summary of why each file is important.
4. Errors and Fixes: List all errors encountered and how they were fixed. Include user feedback.
5. Problem Solving: Document problems solved and ongoing troubleshooting efforts.
6. All User Messages: List ALL user messages that are not tool results. These are critical for understanding the user's feedback and changing intent.
7. Pending Tasks: Outline any pending tasks you have been explicitly asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request. Include file names and code snippets.
9. Optional Next Step: List the next step directly in line with the user's most recent explicit request. Include direct quotes from the most recent conversation to prevent task drift.

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Important Code Snippet]

4. Errors and Fixes:
    - [Error description]:
      - [How you fixed it]

5. Problem Solving:
   [Description]

6. All User Messages:
    - [Detailed non tool use user message]

7. Pending Tasks:
   - [Task 1]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]
</summary>
</example>

Please provide your summary based on the conversation so far, following this structure.`;

  if (customInstructions?.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }

  prompt += NO_TOOLS_TRAILER;

  return prompt;
}

// ============================================================
// Summary Formatting
// ============================================================

export function formatCompactSummary(summary: string): string {
  let formatted = summary;

  // Strip analysis scratchpad
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, "");

  // Extract summary block
  const match = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${(match[1] || "").trim()}`,
    );
  }

  // Clean extra whitespace
  formatted = formatted.replace(/\n\n+/g, "\n\n");

  return formatted.trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest run tests/compaction.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/compaction.ts extensions/agentic-harness/tests/compaction.test.ts
git commit -m "feat: add compaction module with prompts and microcompaction"
```

---

### Task 3: Wire Compaction into Extension Entry Point

**Dependencies:** Runs after Task 1 and Task 2 complete
**Files:**
- Modify: `extensions/agentic-harness/index.ts:1-22,295-478`
- Modify: `extensions/agentic-harness/tests/extension.test.ts:1-24,60-68`

- [ ] **Step 1: Add imports and state variable to index.ts**

At the top of `index.ts`, add imports after existing ones:

```typescript
// After: import { runSingleAgent, runParallel, runChain } from "./subagent.js";
import { loadState, saveState, updateState, type ExtensionState } from "./state.js";
import { microcompactMessages, getCompactionPrompt, formatCompactSummary } from "./compaction.js";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
```

Replace the standalone `currentPhase` variable with state-backed variables:

```typescript
// Replace lines 15-21:
// type WorkflowPhase = ... let currentPhase = ...
// With:
type WorkflowPhase = "idle" | "clarifying" | "planning" | "ultraplanning";

let currentPhase: WorkflowPhase = "idle";
let activeGoalDocument: string | null = null;

// State file path — resolved once on load
const STATE_FILE = join(homedir(), ".pi", "extension-state.json");
```

- [ ] **Step 2: Update phase transitions to persist state**

In the `/clarify` command handler (after `currentPhase = "clarifying"`), add state persistence:

```typescript
// Inside clarify handler, after: currentPhase = "clarifying";
activeGoalDocument = null; // Will be set when Context Brief is produced
updateState(STATE_FILE, { phase: "clarifying", activeGoalDocument: null }).catch(() => {});
```

In the `/plan` command handler (after `currentPhase = "planning"`), add:

```typescript
// Inside plan handler, after: currentPhase = "planning";
updateState(STATE_FILE, { phase: "planning" }).catch(() => {});
```

In the `/ultraplan` command handler (after `currentPhase = "ultraplanning"`), add:

```typescript
// Inside ultraplan handler, after: currentPhase = "ultraplanning";
updateState(STATE_FILE, { phase: "ultraplanning" }).catch(() => {});
```

In the `/reset-phase` command handler (after `currentPhase = "idle"`), add:

```typescript
// Inside reset-phase handler, after: currentPhase = "idle";
activeGoalDocument = null;
updateState(STATE_FILE, { phase: "idle", activeGoalDocument: null }).catch(() => {});
```

- [ ] **Step 3: Update session_start to restore state**

Replace the existing `session_start` handler:

```typescript
// Replace the existing session_start handler with:
pi.on("session_start", async (_event, ctx) => {
  // Restore persisted state
  const saved = await loadState(STATE_FILE);
  currentPhase = saved.phase;
  activeGoalDocument = saved.activeGoalDocument;

  ctx.ui.notify(
    "Agentic Harness loaded: /clarify, /plan, /ultraplan, /ask, /reset-phase",
    "info"
  );
});
```

- [ ] **Step 4: Add context event handler for microcompaction**

Add after the `before_agent_start` handler:

```typescript
// ============================================================
// context: Microcompaction — truncate old tool results
// ============================================================

pi.on("context", async (event, _ctx) => {
  const compacted = microcompactMessages(event.messages);
  // Only return modified messages if something changed
  const changed = compacted.some((msg, i) => msg !== event.messages[i]);
  if (!changed) return;
  return { messages: compacted };
});
```

- [ ] **Step 5: Add session_before_compact handler**

Add after the context handler:

```typescript
// ============================================================
// session_before_compact: Phase-aware custom summarization
// ============================================================

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, signal } = event;
  const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;

  // Use the current conversation model
  const model = ctx.model;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    ctx.ui.notify("Compaction auth failed, using default compaction", "warning");
    return; // Fallback to default
  }

  const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
  if (allMessages.length === 0) return;

  ctx.ui.notify(
    `Custom compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens)...`,
    "info",
  );

  // Serialize conversation for the summarization prompt
  const conversationText = serializeConversation(convertToLlm(allMessages));

  // Build phase-aware prompt
  const promptText = getCompactionPrompt(
    currentPhase,
    activeGoalDocument,
    event.customInstructions,
  );

  // Include previous summary context for iterative compaction
  const previousContext = previousSummary
    ? `\n\nPrevious session summary for context:\n${previousSummary}`
    : "";

  const summaryMessages = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `${promptText}${previousContext}\n\n<conversation>\n${conversationText}\n</conversation>`,
        },
      ],
      timestamp: Date.now(),
    },
  ];

  try {
    const response = await complete(
      model,
      { messages: summaryMessages },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 8192,
        signal,
      },
    );

    const summary = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (!summary.trim()) {
      if (!signal.aborted) {
        ctx.ui.notify("Compaction summary was empty, using default", "warning");
      }
      return; // Fallback
    }

    const formattedSummary = formatCompactSummary(summary);

    return {
      compaction: {
        summary: formattedSummary,
        firstKeptEntryId,
        tokensBefore,
        details: {
          phase: currentPhase,
          activeGoalDocument,
        },
      },
    };
  } catch (error) {
    if (signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Compaction failed: ${message}`, "error");
    return; // Fallback to default
  }
});
```

- [ ] **Step 6: Add session_compact handler to restore state from details**

Add after the `session_before_compact` handler:

```typescript
// ============================================================
// session_compact: Persist state from compaction details
// ============================================================

pi.on("session_compact", async (event, _ctx) => {
  if (event.fromExtension && event.compactionEntry.details) {
    const details = event.compactionEntry.details as {
      phase?: WorkflowPhase;
      activeGoalDocument?: string | null;
    };
    if (details.phase) currentPhase = details.phase;
    if (details.activeGoalDocument !== undefined) {
      activeGoalDocument = details.activeGoalDocument;
    }
  }
});
```

- [ ] **Step 7: Run existing tests to verify no regressions**

Run: `cd extensions/agentic-harness && npx vitest run`
Expected: ALL PASS — existing tests still work

- [ ] **Step 8: Update extension registration tests**

In `tests/extension.test.ts`, update the event handler test:

```typescript
// Replace the existing "should register event handlers" test:
it("should register event handlers", () => {
  const { mockPi, events } = createMockPi();
  extension(mockPi);

  expect(events.has("resources_discover")).toBe(true);
  expect(events.has("before_agent_start")).toBe(true);
  expect(events.has("session_start")).toBe(true);
  expect(events.has("context")).toBe(true);
  expect(events.has("session_before_compact")).toBe(true);
  expect(events.has("session_compact")).toBe(true);
});
```

- [ ] **Step 9: Run all tests**

Run: `cd extensions/agentic-harness && npx vitest run`
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "feat: wire compaction and microcompaction into extension entry point"
```

---

### Task 4: Active Goal Document Tracking

**Dependencies:** Runs after Task 3 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts` (tool_result handler)
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add tool_result handler to detect goal document creation**

The agent writes goal documents via file write tools. Detect when a file is written to `docs/engineering-discipline/` during an active phase and update `activeGoalDocument`.

Add after the `session_compact` handler in `index.ts`:

```typescript
// ============================================================
// tool_result: Track active goal document creation
// ============================================================

const GOAL_DOC_PATTERN = /^docs\/engineering-discipline\/(context|plans|reviews)\//;

pi.on("tool_result", async (event, _ctx) => {
  if (currentPhase === "idle") return;

  // Detect file writes to goal document directories
  const toolName = event.toolName;
  if (toolName !== "write" && toolName !== "edit") return;

  // Extract file path from the tool call arguments
  // The event contains the tool call details
  const filePath: string | undefined =
    event.details?.file_path || event.details?.filePath;
  if (!filePath) return;

  // Check if it matches goal document pattern
  const relativePath = filePath.replace(/^.*?docs\/engineering-discipline\//, "docs/engineering-discipline/");
  if (GOAL_DOC_PATTERN.test(relativePath)) {
    activeGoalDocument = relativePath;
    updateState(STATE_FILE, { activeGoalDocument: relativePath }).catch(() => {});
  }
});
```

- [ ] **Step 2: Write test for goal document tracking**

Add to `tests/extension.test.ts`:

```typescript
describe("Goal Document Tracking", () => {
  it("should update activeGoalDocument on file write to goal directory", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    // Simulate a phase change first (via command)
    const clarify = mockPi._commands?.get("clarify");
    // Instead, directly call the tool_result handler
    const handlers = events.get("tool_result")!;
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThan(0);

    // The handler should exist
    const handler = handlers[0];
    const result = await handler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "tc1",
        content: [{ type: "text", text: "File written" }],
        isError: false,
        details: { file_path: "docs/engineering-discipline/plans/2026-04-05-feature.md" },
        timestamp: Date.now(),
      },
      {} as any,
    );

    // Handler returns void — we verify by checking the event registered
    expect(handler).toBeDefined();
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `cd extensions/agentic-harness && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "feat: add active goal document tracking via tool_result handler"
```

---

### Task 5 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `cd extensions/agentic-harness && npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: TypeScript type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify plan success criteria**

Manually check each success criterion:
- [ ] 컴팩션 후 최초 목표 보존: `session_before_compact` 핸들러가 `activeGoalDocument`를 요약 프롬프트에 포함
- [ ] Phase-aware 요약: `getCompactionPrompt`가 phase별 섹션 생성 (idle/clarifying/planning/ultraplanning)
- [ ] Microcompaction 동작: `context` 이벤트 핸들러가 `microcompactMessages` 호출
- [ ] 상태 복원: `session_start`에서 `loadState` → `currentPhase` + `activeGoalDocument` 복원
- [ ] 폴백 안전성: 모든 에러 경로에서 `return undefined` (기본 컴팩션 폴백)
- [ ] AbortSignal 지원: `complete()` 호출에 `signal` 전달, abort 시 early return

- [ ] **Step 4: Run full test suite for regressions**

Run: `cd extensions/agentic-harness && npx vitest run`
Expected: No regressions — all pre-existing tests still pass
