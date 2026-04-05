# Subagent Rich UI & Safety Guards Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Replace the current text-only subagent output with TUI component-based rendering (renderCall/renderResult), add CLI argument inheritance, and implement safety guards (cycle detection + depth limiting).

**Architecture:** Refactor the subagent system into a layered architecture: types → event processing → CLI inheritance → runner → TUI rendering → tool registration. The `onUpdate` callback passes `SubagentDetails` in the `details` field, which `renderResult` uses to show real-time progress with expandable views (Ctrl+E). Safety guards use environment variables to propagate delegation depth and agent stack across spawned processes.

**Tech Stack:** TypeScript, `@mariozechner/pi-tui` (Text, Container, Markdown, Spacer), `@mariozechner/pi-coding-agent` (getMarkdownTheme, Theme, Component), `@sinclair/typebox`

**Work Scope:**
- **In scope:**
  - New `types.ts` with `SingleResult`, `SubagentDetails`, `UsageStats`, `DisplayItem`
  - New `runner-events.ts` with JSON event processing and message deduplication
  - New `runner-cli.ts` with CLI argument inheritance from parent process
  - New `render.ts` with `renderCall`/`renderResult` using pi-tui components
  - Refactored `subagent.ts` to use new types and event processing
  - Updated `index.ts` to wire renderCall/renderResult and safety guards
  - Updated tests for all new modules
- **Out of scope:**
  - Fork mode (session snapshot passing) — spawn-only for now
  - Chain mode rendering (chain mode remains text-based for now)
  - Custom widget/overlay UI beyond tool rendering

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npx vitest --run`
- **What it validates:** All unit tests pass including new modules, no regressions in existing tests

---

## File Structure Mapping

| File | Action | Responsibility |
|------|--------|---------------|
| `extensions/agentic-harness/types.ts` | Create | Shared types: SingleResult, SubagentDetails, UsageStats, DisplayItem |
| `extensions/agentic-harness/runner-events.ts` | Create | Pi JSON event parsing, message deduplication, usage tracking |
| `extensions/agentic-harness/runner-cli.ts` | Create | CLI argument inheritance for child processes |
| `extensions/agentic-harness/render.ts` | Create | TUI rendering with renderCall/renderResult |
| `extensions/agentic-harness/subagent.ts` | Modify | Refactor to use new types, events, CLI args |
| `extensions/agentic-harness/index.ts` | Modify | Wire renderCall/renderResult, add safety guards |
| `extensions/agentic-harness/tests/types.test.ts` | Create | Tests for types utilities |
| `extensions/agentic-harness/tests/runner-events.test.ts` | Create | Tests for event processing |
| `extensions/agentic-harness/tests/runner-cli.test.ts` | Create | Tests for CLI arg parsing |
| `extensions/agentic-harness/tests/render.test.ts` | Create | Tests for render functions |
| `extensions/agentic-harness/tests/subagent.test.ts` | Modify | Update imports for refactored exports |
| `extensions/agentic-harness/tests/extension.test.ts` | Modify | Update for new tool shape (renderCall/renderResult) |

---

### Task 1: Create types.ts — Shared Type Definitions

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/agentic-harness/types.ts`
- Create: `extensions/agentic-harness/tests/types.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/types.test.ts
import { describe, it, expect } from "vitest";
import {
  emptyUsage,
  aggregateUsage,
  isResultSuccess,
  isResultError,
  getDisplayItems,
  getFinalOutput,
  type SingleResult,
  type UsageStats,
} from "../types.js";

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent: "test-agent",
    agentSource: "bundled",
    task: "do something",
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    ...overrides,
  };
}

describe("emptyUsage", () => {
  it("should return zeroed usage stats", () => {
    const u = emptyUsage();
    expect(u.input).toBe(0);
    expect(u.output).toBe(0);
    expect(u.cacheRead).toBe(0);
    expect(u.cacheWrite).toBe(0);
    expect(u.cost).toBe(0);
    expect(u.turns).toBe(0);
  });
});

describe("aggregateUsage", () => {
  it("should sum usage across results", () => {
    const r1 = makeResult({ usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: 0.01, contextTokens: 0, turns: 1 } });
    const r2 = makeResult({ usage: { input: 200, output: 100, cacheRead: 20, cacheWrite: 10, cost: 0.02, contextTokens: 0, turns: 2 } });
    const total = aggregateUsage([r1, r2]);
    expect(total.input).toBe(300);
    expect(total.output).toBe(150);
    expect(total.turns).toBe(3);
    expect(total.cost).toBeCloseTo(0.03);
  });

  it("should return empty usage for empty array", () => {
    const total = aggregateUsage([]);
    expect(total.input).toBe(0);
    expect(total.turns).toBe(0);
  });
});

describe("isResultSuccess / isResultError", () => {
  it("should treat exitCode 0 as success", () => {
    const r = makeResult({ exitCode: 0 });
    expect(isResultSuccess(r)).toBe(true);
    expect(isResultError(r)).toBe(false);
  });

  it("should treat exitCode > 0 as error", () => {
    const r = makeResult({ exitCode: 1 });
    expect(isResultSuccess(r)).toBe(false);
    expect(isResultError(r)).toBe(true);
  });

  it("should treat exitCode -1 (running) as neither", () => {
    const r = makeResult({ exitCode: -1 });
    expect(isResultSuccess(r)).toBe(false);
    expect(isResultError(r)).toBe(false);
  });

  it("should treat stopReason error as error even with exitCode 0", () => {
    const r = makeResult({ exitCode: 0, stopReason: "error" });
    expect(isResultSuccess(r)).toBe(false);
    expect(isResultError(r)).toBe(true);
  });
});

describe("getDisplayItems", () => {
  it("should extract text and tool call items from messages", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Looking at the code..." },
          { type: "toolCall" as const, name: "read", arguments: { path: "/foo.ts" } },
        ],
      },
    ];
    const items = getDisplayItems(messages);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ type: "text", text: "Looking at the code..." });
    expect(items[1]).toEqual({ type: "toolCall", name: "read", args: { path: "/foo.ts" } });
  });

  it("should return empty array for no messages", () => {
    expect(getDisplayItems([])).toEqual([]);
  });
});

describe("getFinalOutput", () => {
  it("should return last assistant text", () => {
    const messages = [
      { role: "assistant" as const, content: [{ type: "text" as const, text: "first" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "last" }] },
    ];
    expect(getFinalOutput(messages)).toBe("last");
  });

  it("should return empty string for no messages", () => {
    expect(getFinalOutput([])).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest --run tests/types.test.ts`
Expected: FAIL — module `../types.js` exports not found

- [ ] **Step 3: Write the types module**

```typescript
// types.ts
/**
 * Shared type definitions for the subagent system.
 */

/** Aggregated token usage from a subagent run. */
export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

/** Result of a single subagent invocation. */
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
}

/** Metadata attached to every tool result for rendering. */
export interface SubagentDetails {
  mode: "single" | "parallel";
  results: SingleResult[];
}

/** A display-friendly representation of a message part. */
export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

/** Create an empty UsageStats object. */
export function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** Sum usage across multiple results. */
export function aggregateUsage(results: SingleResult[]): UsageStats {
  const total = emptyUsage();
  for (const r of results) {
    total.input += r.usage.input;
    total.output += r.usage.output;
    total.cacheRead += r.usage.cacheRead;
    total.cacheWrite += r.usage.cacheWrite;
    total.cost += r.usage.cost;
    total.turns += r.usage.turns;
  }
  return total;
}

/** Whether a result represents a successful completion. */
export function isResultSuccess(r: SingleResult): boolean {
  if (r.exitCode === -1) return false;
  return r.exitCode === 0 && r.stopReason !== "error" && r.stopReason !== "aborted";
}

/** Whether a result represents an error. */
export function isResultError(r: SingleResult): boolean {
  if (r.exitCode === -1) return false;
  return !isResultSuccess(r);
}

/** Extract the last assistant text from a message history. */
export function getFinalOutput(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "text" && typeof part.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }
  return "";
}

/** Extract all display-worthy items from a message history. */
export function getDisplayItems(messages: any[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          items.push({ type: "text", text: part.text });
        } else if (part.type === "toolCall") {
          items.push({ type: "toolCall", name: part.name, args: part.arguments });
        }
      }
    }
  }
  return items;
}

/** Get a human-readable summary text from a result. */
export function getResultSummaryText(r: SingleResult): string {
  const finalText = getFinalOutput(r.messages);
  if (finalText) return finalText;
  if (r.errorMessage) return r.errorMessage;
  if (r.exitCode > 0 && r.stderr.trim()) return r.stderr.trim();
  return "(no output)";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/types.ts extensions/agentic-harness/tests/types.test.ts
git commit -m "feat(subagent): add shared type definitions — SingleResult, SubagentDetails, UsageStats"
```

---

### Task 2: Create runner-events.ts — JSON Event Processing

**Dependencies:** Runs after Task 1 completes (imports from types.ts)
**Files:**
- Create: `extensions/agentic-harness/runner-events.ts`
- Create: `extensions/agentic-harness/tests/runner-events.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/runner-events.test.ts
import { describe, it, expect } from "vitest";
import { processPiJsonLine, getMessageSignature } from "../runner-events.js";
import { emptyUsage, type SingleResult } from "../types.js";

function makeEmptyResult(): SingleResult {
  return {
    agent: "test",
    agentSource: "bundled",
    task: "test task",
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
  };
}

describe("processPiJsonLine", () => {
  it("should process message_end events", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: { input: 100, output: 50 },
      },
    });
    const changed = processPiJsonLine(line, result);
    expect(changed).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.usage.turns).toBe(1);
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
  });

  it("should deduplicate identical messages", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    });
    processPiJsonLine(line, result);
    const changed = processPiJsonLine(line, result);
    expect(changed).toBe(false);
    expect(result.messages).toHaveLength(1);
  });

  it("should skip non-assistant messages", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "user", content: [{ type: "text", text: "question" }] },
    });
    const changed = processPiJsonLine(line, result);
    expect(changed).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  it("should handle agent_end events", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "agent_end",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Done" }] },
      ],
    });
    const changed = processPiJsonLine(line, result);
    expect(changed).toBe(true);
    expect(result.sawAgentEnd).toBe(true);
  });

  it("should handle turn_end events", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "turn_end",
      message: { role: "assistant", content: [{ type: "text", text: "turn" }] },
    });
    const changed = processPiJsonLine(line, result);
    expect(changed).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it("should skip non-JSON lines", () => {
    const result = makeEmptyResult();
    expect(processPiJsonLine("not json", result)).toBe(false);
    expect(processPiJsonLine("", result)).toBe(false);
  });

  it("should extract model and stopReason from messages", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "claude-sonnet",
        stopReason: "end_turn",
      },
    });
    processPiJsonLine(line, result);
    expect(result.model).toBe("claude-sonnet");
    expect(result.stopReason).toBe("end_turn");
  });

  it("should accumulate cost from usage", () => {
    const result = makeEmptyResult();
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "a" }],
        usage: { input: 10, output: 5, cost: { total: 0.001 } },
      },
    });
    processPiJsonLine(line, result);
    expect(result.usage.cost).toBeCloseTo(0.001);
  });
});

describe("getMessageSignature", () => {
  it("should produce stable signatures for identical messages", () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "hi" }] };
    expect(getMessageSignature(msg)).toBe(getMessageSignature(msg));
  });

  it("should produce different signatures for different messages", () => {
    const m1 = { role: "assistant", content: [{ type: "text", text: "a" }] };
    const m2 = { role: "assistant", content: [{ type: "text", text: "b" }] };
    expect(getMessageSignature(m1)).not.toBe(getMessageSignature(m2));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest --run tests/runner-events.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the runner-events module**

```typescript
// runner-events.ts
/**
 * Helpers for parsing Pi JSON mode events and summarizing subagent results.
 */

import type { SingleResult } from "./types.js";

// ---------------------------------------------------------------------------
// Message deduplication
// ---------------------------------------------------------------------------

const seenSignaturesKey = Symbol("seenMessageSignatures");

function getSeenSignatures(result: SingleResult): Set<string> {
  const r = result as any;
  if (!r[seenSignaturesKey]) {
    r[seenSignaturesKey] = new Set<string>();
  }
  return r[seenSignaturesKey];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function getMessageSignature(message: unknown): string {
  return stableStringify(message);
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

function updateMetadata(result: SingleResult, message: any): void {
  if (!message || message.role !== "assistant") return;
  if (!result.model && message.model) result.model = message.model;
  if (message.stopReason) result.stopReason = message.stopReason;
  if (message.errorMessage) result.errorMessage = message.errorMessage;
}

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

  return true;
}

function addAssistantMessages(result: SingleResult, messages: any[]): boolean {
  if (!Array.isArray(messages)) return false;
  let changed = false;
  for (const msg of messages) {
    if (addAssistantMessage(result, msg)) changed = true;
  }
  return changed;
}

function processPiEvent(event: any, result: SingleResult): boolean {
  if (!event || typeof event !== "object") return false;
  switch (event.type) {
    case "message_end":
      return addAssistantMessage(result, event.message);
    case "turn_end":
      return addAssistantMessage(result, event.message);
    case "agent_end":
      result.sawAgentEnd = true;
      return addAssistantMessages(result, event.messages);
    default:
      return false;
  }
}

/**
 * Parse a single JSON line from pi's stdout and update the result.
 * Returns true if the result changed (for triggering UI updates).
 */
export function processPiJsonLine(line: string, result: SingleResult): boolean {
  if (!line.trim()) return false;
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }
  return processPiEvent(event, result);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/runner-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/runner-events.ts extensions/agentic-harness/tests/runner-events.test.ts
git commit -m "feat(subagent): add event processing with message deduplication"
```

---

### Task 3: Create runner-cli.ts — CLI Argument Inheritance

**Dependencies:** None (can run in parallel with Task 1)
**Files:**
- Create: `extensions/agentic-harness/runner-cli.ts`
- Create: `extensions/agentic-harness/tests/runner-cli.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/runner-cli.test.ts
import { describe, it, expect } from "vitest";
import { parseInheritedCliArgs } from "../runner-cli.js";

describe("parseInheritedCliArgs", () => {
  it("should skip session-specific flags", () => {
    const argv = ["node", "pi", "--mode", "json", "-p", "--no-session", "--session", "foo"];
    const result = parseInheritedCliArgs(argv);
    expect(result.alwaysProxy).not.toContain("--mode");
    expect(result.alwaysProxy).not.toContain("json");
    expect(result.alwaysProxy).not.toContain("-p");
    expect(result.alwaysProxy).not.toContain("--no-session");
  });

  it("should capture --model as fallback", () => {
    const argv = ["node", "pi", "--model", "claude-sonnet"];
    const result = parseInheritedCliArgs(argv);
    expect(result.fallbackModel).toBe("claude-sonnet");
    expect(result.alwaysProxy).not.toContain("--model");
  });

  it("should capture --tools as fallback", () => {
    const argv = ["node", "pi", "--tools", "read,edit,bash"];
    const result = parseInheritedCliArgs(argv);
    expect(result.fallbackTools).toBe("read,edit,bash");
  });

  it("should proxy --extension with path", () => {
    const argv = ["node", "pi", "--extension", "/abs/path/ext"];
    const result = parseInheritedCliArgs(argv);
    expect(result.extensionArgs).toContain("--extension");
    expect(result.extensionArgs).toContain("/abs/path/ext");
  });

  it("should proxy --provider verbatim", () => {
    const argv = ["node", "pi", "--provider", "anthropic"];
    const result = parseInheritedCliArgs(argv);
    expect(result.alwaysProxy).toContain("--provider");
    expect(result.alwaysProxy).toContain("anthropic");
  });

  it("should proxy --api-key verbatim", () => {
    const argv = ["node", "pi", "--api-key", "sk-123"];
    const result = parseInheritedCliArgs(argv);
    expect(result.alwaysProxy).toContain("--api-key");
    expect(result.alwaysProxy).toContain("sk-123");
  });

  it("should handle --no-tools flag", () => {
    const argv = ["node", "pi", "--no-tools"];
    const result = parseInheritedCliArgs(argv);
    expect(result.fallbackNoTools).toBe(true);
  });

  it("should handle empty argv", () => {
    const argv = ["node", "pi"];
    const result = parseInheritedCliArgs(argv);
    expect(result.extensionArgs).toEqual([]);
    expect(result.alwaysProxy).toEqual([]);
    expect(result.fallbackModel).toBeUndefined();
  });

  it("should proxy --skill with path", () => {
    const argv = ["node", "pi", "--skill", "/path/to/skill"];
    const result = parseInheritedCliArgs(argv);
    expect(result.alwaysProxy).toContain("--skill");
  });

  it("should capture --thinking as fallback", () => {
    const argv = ["node", "pi", "--thinking", "enabled"];
    const result = parseInheritedCliArgs(argv);
    expect(result.fallbackThinking).toBe("enabled");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest --run tests/runner-cli.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the runner-cli module**

```typescript
// runner-cli.ts
/**
 * Helpers for inheriting selected parent CLI flags in child subagent processes.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function looksLikeRelativePath(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.startsWith(".\\") || value.startsWith("..\\");
}

function resolvePathArg(value: string, opts: { allowPackageSource?: boolean; alwaysResolveRelative?: boolean } = {}): string {
  if (!value) return value;
  if (opts.allowPackageSource && (value.startsWith("npm:") || value.startsWith("git:"))) return value;
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;

  const resolved = path.resolve(process.cwd(), value);
  if (opts.alwaysResolveRelative || looksLikeRelativePath(value) || path.extname(value) !== "" || fs.existsSync(resolved)) {
    return resolved;
  }
  return value;
}

export interface InheritedCliArgs {
  extensionArgs: string[];
  alwaysProxy: string[];
  fallbackModel?: string;
  fallbackThinking?: string;
  fallbackTools?: string;
  fallbackNoTools: boolean;
}

/**
 * Parse process.argv into groups for child pi invocations.
 *
 * - extensionArgs: forwarded with path resolution
 * - alwaysProxy: forwarded verbatim to every child
 * - fallbackModel/thinking/tools: used only when the agent file doesn't set them
 */
export function parseInheritedCliArgs(argv: string[]): InheritedCliArgs {
  const extensionArgs: string[] = [];
  const alwaysProxy: string[] = [];
  let fallbackModel: string | undefined;
  let fallbackThinking: string | undefined;
  let fallbackTools: string | undefined;
  let fallbackNoTools = false;

  let i = 2; // skip executable + script
  while (i < argv.length) {
    const raw = argv[i];
    if (!raw.startsWith("-")) { i++; continue; }

    const eqIdx = raw.indexOf("=");
    const flagName = eqIdx !== -1 ? raw.slice(0, eqIdx) : raw;
    const inlineValue = eqIdx !== -1 ? raw.slice(eqIdx + 1) : undefined;
    const nextToken = argv[i + 1];
    const nextIsValue = nextToken !== undefined && !nextToken.startsWith("-");

    const getValue = (): [string | undefined, number] => {
      if (inlineValue !== undefined) return [inlineValue, 1];
      if (nextIsValue) return [nextToken, 2];
      return [undefined, 1];
    };

    // Skip session-specific flags
    if (["--mode", "--session", "--append-system-prompt", "--export", "--subagent-max-depth"].includes(flagName)) {
      const [, skip] = getValue();
      i += skip; continue;
    }
    if (["--subagent-prevent-cycles", "--list-models"].includes(flagName)) {
      const [, skip] = getValue();
      i += skip; continue;
    }
    if (["--print", "-p", "--no-session", "--continue", "-c", "--resume", "-r", "--offline", "--help", "-h", "--version", "-v", "--no-subagent-prevent-cycles"].includes(flagName)) {
      i++; continue;
    }

    // Extension args
    if (flagName === "--no-extensions" || flagName === "-ne") {
      extensionArgs.push(flagName); i++; continue;
    }
    if (flagName === "--extension" || flagName === "-e") {
      const [value, skip] = getValue();
      if (value !== undefined) extensionArgs.push(flagName, resolvePathArg(value, { allowPackageSource: true }));
      i += skip; continue;
    }

    // Always proxy (with path resolution)
    if (["--skill", "--prompt-template", "--theme"].includes(flagName)) {
      const [value, skip] = getValue();
      if (value !== undefined) alwaysProxy.push(flagName, resolvePathArg(value));
      i += skip; continue;
    }
    if (flagName === "--session-dir") {
      const [value, skip] = getValue();
      if (value !== undefined) alwaysProxy.push(flagName, resolvePathArg(value, { alwaysResolveRelative: true }));
      i += skip; continue;
    }
    if (["--provider", "--api-key", "--system-prompt", "--models"].includes(flagName)) {
      const [value, skip] = getValue();
      if (value !== undefined) alwaysProxy.push(flagName, value);
      i += skip; continue;
    }
    if (["--no-skills", "-ns", "--no-prompt-templates", "-np", "--no-themes", "--verbose"].includes(flagName)) {
      alwaysProxy.push(flagName); i++; continue;
    }

    // Fallback values
    if (flagName === "--model") {
      const [value, skip] = getValue();
      if (value !== undefined) fallbackModel = value;
      i += skip; continue;
    }
    if (flagName === "--thinking") {
      const [value, skip] = getValue();
      if (value !== undefined) fallbackThinking = value;
      i += skip; continue;
    }
    if (flagName === "--tools") {
      const [value, skip] = getValue();
      if (value !== undefined) fallbackTools = value;
      i += skip; continue;
    }
    if (flagName === "--no-tools") {
      fallbackNoTools = true; i++; continue;
    }

    // Unknown flags: proxy as-is
    if (inlineValue !== undefined) { alwaysProxy.push(flagName, inlineValue); i++; continue; }
    if (nextIsValue) { alwaysProxy.push(flagName, nextToken); i += 2; continue; }
    alwaysProxy.push(flagName); i++;
  }

  return { extensionArgs, alwaysProxy, fallbackModel, fallbackThinking, fallbackTools, fallbackNoTools };
}

/** Cached result of parsing the current process's argv. */
let cachedArgs: InheritedCliArgs | null = null;

/** Get the inherited CLI args (cached). */
export function getInheritedCliArgs(): InheritedCliArgs {
  if (!cachedArgs) cachedArgs = parseInheritedCliArgs(process.argv);
  return cachedArgs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/runner-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/runner-cli.ts extensions/agentic-harness/tests/runner-cli.test.ts
git commit -m "feat(subagent): add CLI argument inheritance for child processes"
```

---

### Task 4: Refactor subagent.ts — Use New Types and Events

**Dependencies:** Runs after Task 1, Task 2, and Task 3 complete
**Files:**
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/tests/subagent.test.ts`

- [ ] **Step 1: Rewrite subagent.ts**

Replace the entire content of `extensions/agentic-harness/subagent.ts` with:

```typescript
// subagent.ts
/**
 * Subagent process runner.
 * Spawns isolated `pi` processes and streams results back via callbacks.
 */

import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename } from "path";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import type { AgentConfig } from "./agents.js";
import type { SingleResult, SubagentDetails } from "./types.js";
import { emptyUsage, getFinalOutput } from "./types.js";
import { processPiJsonLine } from "./runner-events.js";
import { getInheritedCliArgs } from "./runner-cli.js";

// ============================================================
// Constants
// ============================================================

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
const KILL_TIMEOUT_MS = 5000;
const AGENT_END_GRACE_MS = 250;

// ============================================================
// Environment-based safety guards
// ============================================================

const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_MAX_DEPTH_ENV = "PI_SUBAGENT_MAX_DEPTH";
const SUBAGENT_STACK_ENV = "PI_SUBAGENT_STACK";
const SUBAGENT_PREVENT_CYCLES_ENV = "PI_SUBAGENT_PREVENT_CYCLES";

export const DEFAULT_MAX_DEPTH = 3;

export interface DepthConfig {
  currentDepth: number;
  maxDepth: number;
  canDelegate: boolean;
  ancestorStack: string[];
  preventCycles: boolean;
}

export function resolveDepthConfig(): DepthConfig {
  const raw = process.env[SUBAGENT_DEPTH_ENV];
  const currentDepth = raw ? parseInt(raw, 10) || 0 : 0;
  const maxRaw = process.env[SUBAGENT_MAX_DEPTH_ENV];
  const maxDepth = maxRaw ? parseInt(maxRaw, 10) || DEFAULT_MAX_DEPTH : DEFAULT_MAX_DEPTH;
  const stackRaw = process.env[SUBAGENT_STACK_ENV];
  let ancestorStack: string[] = [];
  if (stackRaw) {
    try { ancestorStack = JSON.parse(stackRaw); } catch { /* ignore */ }
  }
  const cycleRaw = process.env[SUBAGENT_PREVENT_CYCLES_ENV];
  const preventCycles = cycleRaw ? cycleRaw !== "0" : true;
  return {
    currentDepth,
    maxDepth,
    canDelegate: currentDepth < maxDepth,
    ancestorStack,
    preventCycles,
  };
}

export function getCycleViolations(requested: string[], stack: string[]): string[] {
  if (requested.length === 0 || stack.length === 0) return [];
  const stackSet = new Set(stack);
  return requested.filter((name) => stackSet.has(name));
}

// ============================================================
// Helpers
// ============================================================

export function getPiInvocation(): { command: string; args: string[] } {
  const mainScript = process.argv[1];
  if (mainScript && existsSync(mainScript)) {
    const execName = basename(process.execPath).toLowerCase();
    if (execName === "node" || execName === "bun" || execName.startsWith("node.") || execName.startsWith("bun.")) {
      return { command: process.execPath, args: [mainScript] };
    }
    return { command: process.execPath, args: [] };
  }
  return { command: "pi", args: [] };
}

export function extractFinalOutput(stdout: string): string {
  const lines = stdout.split("\n");
  const messages: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "message_end" && event.message) messages.push(event.message);
    } catch { /* skip */ }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        if (msg.content[j].type === "text" && msg.content[j].text?.trim()) return msg.content[j].text;
      }
    }
  }
  return "";
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

// ============================================================
// Temp file
// ============================================================

async function writeTempSystemPrompt(content: string): Promise<string> {
  const filename = `pi-subagent-${randomBytes(8).toString("hex")}.md`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

// ============================================================
// Build CLI args
// ============================================================

function buildPiArgs(agent: AgentConfig | undefined, systemPromptPath: string | null, task: string): string[] {
  const inherited = getInheritedCliArgs();
  const args = [
    "--mode", "json",
    ...inherited.extensionArgs,
    ...inherited.alwaysProxy,
    "-p",
    "--no-session",
  ];

  const model = agent?.model ?? inherited.fallbackModel;
  if (model) args.push("--model", model);

  const thinking = inherited.fallbackThinking;
  if (thinking) args.push("--thinking", thinking);

  if (agent?.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  } else if (agent?.tools === undefined) {
    if (inherited.fallbackTools) args.push("--tools", inherited.fallbackTools);
    else if (inherited.fallbackNoTools) args.push("--no-tools");
  }

  if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
  args.push(`Task: ${task}`);
  return args;
}

// ============================================================
// Core Execution — returns SingleResult
// ============================================================

type OnUpdateCallback = (partial: { content: Array<{ type: "text"; text: string }>; details?: SubagentDetails }) => void;

export interface RunAgentOptions {
  agent: AgentConfig | undefined;
  agentName: string;
  task: string;
  cwd: string;
  depthConfig: DepthConfig;
  signal?: AbortSignal;
  onUpdate?: OnUpdateCallback;
  makeDetails: (results: SingleResult[]) => SubagentDetails;
}

export async function runAgent(opts: RunAgentOptions): Promise<SingleResult> {
  const { agent, agentName, task, cwd, depthConfig, signal, onUpdate, makeDetails } = opts;

  if (!agent) {
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}".`,
      usage: emptyUsage(),
      stopReason: "error",
      errorMessage: `Unknown agent: "${agentName}".`,
    };
  }

  const result: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    model: agent.model,
  };

  const emitUpdate = () => {
    onUpdate?.({
      content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
      details: makeDetails([result]),
    });
  };

  const invocation = getPiInvocation();
  let tmpPromptPath: string | undefined;

  try {
    if (agent.systemPrompt?.trim()) {
      tmpPromptPath = await writeTempSystemPrompt(agent.systemPrompt);
    }

    const piArgs = buildPiArgs(agent, tmpPromptPath || null, task);
    const allArgs = [...invocation.args, ...piArgs];

    const nextDepth = depthConfig.currentDepth + 1;
    const propagatedStack = [...depthConfig.ancestorStack, agentName];

    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(invocation.command, allArgs, {
        cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          [SUBAGENT_DEPTH_ENV]: String(nextDepth),
          [SUBAGENT_MAX_DEPTH_ENV]: String(depthConfig.maxDepth),
          [SUBAGENT_STACK_ENV]: JSON.stringify(propagatedStack),
          [SUBAGENT_PREVENT_CYCLES_ENV]: depthConfig.preventCycles ? "1" : "0",
        },
      });

      proc.stdin.on("error", () => { /* ignore broken pipe */ });
      proc.stdin.end();

      let buffer = "";
      let didClose = false;
      let settled = false;
      let abortHandler: (() => void) | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        resolve(code);
      };

      const terminateChild = () => {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, KILL_TIMEOUT_MS);
      };

      const flushLine = (line: string) => {
        if (processPiJsonLine(line, result)) emitUpdate();
        // If agent_end seen, give a grace period then finish
        if (result.sawAgentEnd && !didClose && !settled) {
          if (graceTimer) clearTimeout(graceTimer);
          graceTimer = setTimeout(() => {
            if (!didClose && !settled && result.sawAgentEnd) {
              finish(0);
              terminateChild();
            }
          }, AGENT_END_GRACE_MS);
        }
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) flushLine(line);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        result.stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        didClose = true;
        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            if (line.trim()) flushLine(line);
          }
        }
        finish(code ?? 0);
      });

      proc.on("error", (err) => {
        if (!result.stderr.trim()) result.stderr = err.message;
        finish(1);
      });

      if (signal) {
        abortHandler = () => {
          if (didClose || settled) return;
          wasAborted = true;
          terminateChild();
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    result.exitCode = exitCode;

    // Normalize: if agent completed semantically but process exited non-zero
    if (wasAborted) {
      if (result.sawAgentEnd && getFinalOutput(result.messages).trim()) {
        result.exitCode = 0;
      } else {
        result.exitCode = 130;
        result.stopReason = "aborted";
        result.errorMessage = "Subagent was aborted.";
      }
    } else if (result.exitCode > 0 && result.sawAgentEnd && getFinalOutput(result.messages).trim()) {
      result.exitCode = 0;
      if (result.stopReason === "error") result.stopReason = undefined;
    } else if (result.exitCode > 0) {
      if (!result.stopReason) result.stopReason = "error";
      if (!result.errorMessage && result.stderr.trim()) result.errorMessage = result.stderr.trim();
    }

    return result;
  } finally {
    if (tmpPromptPath) await unlink(tmpPromptPath).catch(() => {});
  }
}
```

- [ ] **Step 2: Update the test file**

Replace `tests/subagent.test.ts` with:

```typescript
// tests/subagent.test.ts
import { describe, it, expect } from "vitest";
import {
  extractFinalOutput,
  mapWithConcurrencyLimit,
  getPiInvocation,
  MAX_PARALLEL_TASKS,
  MAX_CONCURRENCY,
  resolveDepthConfig,
  getCycleViolations,
  DEFAULT_MAX_DEPTH,
} from "../subagent.js";

describe("extractFinalOutput", () => {
  it("should extract last assistant text from JSON output", () => {
    const stdout = [
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "First response" }] } }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Final response" }] } }),
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("Final response");
  });

  it("should return empty string when no assistant messages", () => {
    const stdout = JSON.stringify({ type: "tool_result_end", message: {} });
    expect(extractFinalOutput(stdout)).toBe("");
  });

  it("should skip non-JSON lines gracefully", () => {
    const stdout = [
      "some debug output",
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Result" }] } }),
      "another non-json line",
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("Result");
  });

  it("should return empty string for empty input", () => {
    expect(extractFinalOutput("")).toBe("");
    expect(extractFinalOutput("\n\n")).toBe("");
  });

  it("should skip assistant messages with only whitespace text", () => {
    const stdout = [
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Real content" }] } }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "   " }] } }),
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("Real content");
  });
});

describe("mapWithConcurrencyLimit", () => {
  it("should process all items and return results in order", async () => {
    const results = await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 3, async (item) => item * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("should respect concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;
    await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6], 2, async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return item;
    });
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("should handle empty array", async () => {
    const results = await mapWithConcurrencyLimit([], 4, async (item) => item);
    expect(results).toEqual([]);
  });

  it("should handle concurrency greater than items", async () => {
    const results = await mapWithConcurrencyLimit([1, 2], 10, async (item) => item * 3);
    expect(results).toEqual([3, 6]);
  });
});

describe("getPiInvocation", () => {
  it("should return a valid invocation object", () => {
    const invocation = getPiInvocation();
    expect(invocation).toHaveProperty("command");
    expect(invocation).toHaveProperty("args");
    expect(typeof invocation.command).toBe("string");
    expect(Array.isArray(invocation.args)).toBe(true);
  });
});

describe("Constants", () => {
  it("should have correct limits", () => {
    expect(MAX_PARALLEL_TASKS).toBe(8);
    expect(MAX_CONCURRENCY).toBe(4);
  });
});

describe("resolveDepthConfig", () => {
  it("should return defaults when no env vars set", () => {
    const config = resolveDepthConfig();
    expect(config.currentDepth).toBe(0);
    expect(config.maxDepth).toBe(DEFAULT_MAX_DEPTH);
    expect(config.canDelegate).toBe(true);
    expect(config.ancestorStack).toEqual([]);
    expect(config.preventCycles).toBe(true);
  });
});

describe("getCycleViolations", () => {
  it("should detect agents already in stack", () => {
    expect(getCycleViolations(["a", "b"], ["a", "c"])).toEqual(["a"]);
  });

  it("should return empty for no conflicts", () => {
    expect(getCycleViolations(["d"], ["a", "b"])).toEqual([]);
  });

  it("should return empty for empty stack", () => {
    expect(getCycleViolations(["a"], [])).toEqual([]);
  });

  it("should return empty for empty requested", () => {
    expect(getCycleViolations([], ["a"])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/subagent.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add extensions/agentic-harness/subagent.ts extensions/agentic-harness/tests/subagent.test.ts
git commit -m "refactor(subagent): use new types, event processing, CLI arg inheritance, and safety guards"
```

---

### Task 5: Create render.ts — TUI Component Rendering

**Dependencies:** Runs after Task 1 and Task 2 complete
**Files:**
- Create: `extensions/agentic-harness/render.ts`
- Create: `extensions/agentic-harness/tests/render.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/render.test.ts
import { describe, it, expect } from "vitest";
import { formatTokens, formatUsage, statusIcon, formatToolCall } from "../render.js";
import { emptyUsage, type SingleResult } from "../types.js";

describe("formatTokens", () => {
  it("should format small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });
  it("should format thousands with k suffix", () => {
    expect(formatTokens(1500)).toBe("1.5k");
  });
  it("should format large thousands as rounded k", () => {
    expect(formatTokens(15000)).toBe("15k");
  });
  it("should format millions with M suffix", () => {
    expect(formatTokens(1500000)).toBe("1.5M");
  });
});

describe("formatUsage", () => {
  it("should format usage stats", () => {
    const result = formatUsage({ input: 1000, output: 500, turns: 2 });
    expect(result).toContain("2 turns");
    expect(result).toContain("↑1.0k");
    expect(result).toContain("↓500");
  });

  it("should handle empty usage", () => {
    expect(formatUsage({})).toBe("");
  });

  it("should include model when provided", () => {
    const result = formatUsage({ turns: 1 }, "claude-sonnet");
    expect(result).toContain("claude-sonnet");
  });
});

describe("statusIcon", () => {
  it("should return hourglass for running", () => {
    const r: SingleResult = { agent: "a", agentSource: "bundled", task: "t", exitCode: -1, messages: [], stderr: "", usage: emptyUsage() };
    // statusIcon returns a themed string, but since we pass identity theme, check raw
    const identity = (color: string, text: string) => text;
    expect(statusIcon(r, identity)).toBe("⏳");
  });

  it("should return check for success", () => {
    const r: SingleResult = { agent: "a", agentSource: "bundled", task: "t", exitCode: 0, messages: [], stderr: "", usage: emptyUsage() };
    const identity = (color: string, text: string) => text;
    expect(statusIcon(r, identity)).toBe("✓");
  });

  it("should return cross for error", () => {
    const r: SingleResult = { agent: "a", agentSource: "bundled", task: "t", exitCode: 1, messages: [], stderr: "", usage: emptyUsage() };
    const identity = (color: string, text: string) => text;
    expect(statusIcon(r, identity)).toBe("✗");
  });
});

describe("formatToolCall", () => {
  const identity = (color: string, text: string) => text;

  it("should format bash commands", () => {
    const result = formatToolCall("bash", { command: "ls -la" }, identity);
    expect(result).toContain("ls -la");
  });

  it("should format read with path", () => {
    const result = formatToolCall("read", { file_path: "/foo/bar.ts" }, identity);
    expect(result).toContain("bar.ts");
  });

  it("should format grep with pattern", () => {
    const result = formatToolCall("grep", { pattern: "TODO", path: "/src" }, identity);
    expect(result).toContain("TODO");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest --run tests/render.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the render module**

```typescript
// render.ts
/**
 * TUI rendering for subagent tool calls and results.
 */

import * as os from "os";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import {
  type DisplayItem,
  type SingleResult,
  type SubagentDetails,
  type UsageStats,
  aggregateUsage,
  getDisplayItems,
  getFinalOutput,
  getResultSummaryText,
  isResultError,
  isResultSuccess,
} from "./types.js";

const COLLAPSED_LINE_COUNT = 10;
const COLLAPSED_PARALLEL_LINE_COUNT = 5;

// ---------------------------------------------------------------------------
// Formatting helpers (exported for testing)
// ---------------------------------------------------------------------------

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsage(usage: Partial<UsageStats>, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

type ThemeFg = (color: string, text: string) => string;

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function statusIcon(r: SingleResult, fg: ThemeFg): string {
  if (r.exitCode === -1) return fg("warning", "⏳");
  return isResultError(r) ? fg("error", "✗") : fg("success", "✓");
}

export function formatToolCall(toolName: string, args: Record<string, unknown>, fg: ThemeFg): string {
  const pathArg = (args.file_path || args.path || "...") as string;
  switch (toolName) {
    case "bash": {
      const cmd = (args.command as string) || "...";
      return fg("muted", "$ ") + fg("toolOutput", truncate(cmd, 60));
    }
    case "read": {
      let text = fg("accent", shortenPath(pathArg));
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : "";
        text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
      }
      return fg("muted", "read ") + text;
    }
    case "write": {
      const lines = ((args.content || "") as string).split("\n").length;
      let text = fg("muted", "write ") + fg("accent", shortenPath(pathArg));
      if (lines > 1) text += fg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit":
      return fg("muted", "edit ") + fg("accent", shortenPath(pathArg));
    case "ls":
      return fg("muted", "ls ") + fg("accent", shortenPath((args.path || ".") as string));
    case "find":
      return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
    case "grep":
      return fg("muted", "grep ") + fg("accent", `/${(args.pattern || "") as string}/`) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
    default:
      return fg("accent", toolName) + fg("dim", ` ${truncate(JSON.stringify(args), 50)}`);
  }
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

function splitOutputLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function countDisplayLines(items: DisplayItem[]): number {
  let count = 0;
  for (const item of items) {
    count += item.type === "text" ? splitOutputLines(item.text).length : 1;
  }
  return count;
}

function renderDisplayItems(items: DisplayItem[], expanded: boolean, fg: ThemeFg, limit?: number): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.type === "text") {
      for (const line of splitOutputLines(item.text)) lines.push(fg("toolOutput", line));
    } else {
      lines.push(fg("muted", "→ ") + formatToolCall(item.name, item.args, fg));
    }
  }
  const shouldTail = !expanded && typeof limit === "number";
  const toShow = shouldTail ? lines.slice(-limit) : lines;
  const skipped = shouldTail && lines.length > limit ? lines.length - limit : 0;
  let text = "";
  if (skipped > 0) text += fg("muted", `... ${skipped} earlier lines\n`);
  text += toShow.join("\n");
  return text.trimEnd();
}

// ---------------------------------------------------------------------------
// renderCall — shown while the tool is being invoked
// ---------------------------------------------------------------------------

export function renderCall(
  args: Record<string, any>,
  theme: { fg: ThemeFg; bold: (s: string) => string },
): Component {
  if (args.tasks && args.tasks.length > 0) {
    let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
    for (const t of args.tasks.slice(0, 3)) {
      text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${truncate(t.task, 40)}`)}`;
    }
    if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }

  if (args.chain && args.chain.length > 0) {
    let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `chain (${args.chain.length} steps)`);
    for (const s of args.chain.slice(0, 3)) {
      text += `\n  ${theme.fg("accent", s.agent)}${theme.fg("dim", ` ${truncate(s.task, 40)}`)}`;
    }
    if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }

  // Single mode
  const agentName = args.agent || "...";
  const preview = args.task ? truncate(args.task, 60) : "...";
  let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName);
  text += `\n  ${theme.fg("dim", preview)}`;
  return new Text(text, 0, 0);
}

// ---------------------------------------------------------------------------
// renderResult — shown after the tool completes (or during streaming)
// ---------------------------------------------------------------------------

export function renderResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  expanded: boolean,
  theme: { fg: ThemeFg; bold: (s: string) => string },
): Component {
  const details = result.details as SubagentDetails | undefined;
  if (!details || details.results.length === 0) {
    const first = result.content[0];
    return new Text(first?.type === "text" && first.text ? first.text : "(no output)", 0, 0);
  }

  if (details.mode === "single") {
    return renderSingleResult(details.results[0], expanded, theme);
  }
  return renderParallelResult(details, expanded, theme);
}

// ---------------------------------------------------------------------------
// Single-mode result
// ---------------------------------------------------------------------------

function renderSingleResult(
  r: SingleResult,
  expanded: boolean,
  theme: { fg: ThemeFg; bold: (s: string) => string },
): Component {
  const error = isResultError(r);
  const icon = statusIcon(r, theme.fg.bind(theme));
  const displayItems = getDisplayItems(r.messages);
  const finalOutput = getFinalOutput(r.messages);

  if (expanded) {
    const mdTheme = getMarkdownTheme();
    const container = new Container();

    // Header
    let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
    if (error && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
    container.addChild(new Text(header, 0, 0));
    if (error && r.errorMessage) container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));

    // Task
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
    container.addChild(new Text(theme.fg("dim", r.task), 0, 0));

    // Output
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
    if (displayItems.length === 0 && !finalOutput) {
      container.addChild(new Text(theme.fg("muted", getResultSummaryText(r)), 0, 0));
    } else {
      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
        }
      }
      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
    }

    // Usage
    const usageStr = formatUsage(r.usage, r.model);
    if (usageStr) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
    }

    return container;
  }

  // Collapsed
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
  if (error && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;

  if (error && r.errorMessage) {
    text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
  } else if (displayItems.length === 0) {
    text += `\n${theme.fg(error ? "error" : "muted", getResultSummaryText(r))}`;
  } else {
    text += `\n${renderDisplayItems(displayItems, false, theme.fg.bind(theme), COLLAPSED_LINE_COUNT)}`;
    if (countDisplayLines(displayItems) > COLLAPSED_LINE_COUNT) {
      text += `\n${theme.fg("muted", "(Ctrl+E to expand)")}`;
    }
  }

  const usageStr = formatUsage(r.usage, r.model);
  if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
  return new Text(text, 0, 0);
}

// ---------------------------------------------------------------------------
// Parallel-mode result
// ---------------------------------------------------------------------------

function renderParallelResult(
  details: SubagentDetails,
  expanded: boolean,
  theme: { fg: ThemeFg; bold: (s: string) => string },
): Component {
  const running = details.results.filter((r) => r.exitCode === -1).length;
  const successCount = details.results.filter((r) => isResultSuccess(r)).length;
  const failCount = details.results.filter((r) => isResultError(r)).length;
  const isRunning = running > 0;

  const icon = isRunning
    ? theme.fg("warning", "⏳")
    : failCount > 0
      ? theme.fg("warning", "◐")
      : theme.fg("success", "✓");

  const status = isRunning
    ? `${successCount + failCount}/${details.results.length} done, ${running} running`
    : `${successCount}/${details.results.length} tasks`;

  if (expanded && !isRunning) {
    const mdTheme = getMarkdownTheme();
    const container = new Container();
    container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`, 0, 0));

    for (const r of details.results) {
      const rIcon = statusIcon(r, theme.fg.bind(theme));
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);

      container.addChild(new Spacer(1));
      container.addChild(new Text(`${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`, 0, 0));
      container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
        }
      }

      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      } else if (isResultError(r)) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("error", getResultSummaryText(r)), 0, 0));
      }

      const taskUsage = formatUsage(r.usage, r.model);
      if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
    }

    const totalUsage = formatUsage(aggregateUsage(details.results));
    if (totalUsage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", `Total: ${totalUsage}`), 0, 0));
    }

    return container;
  }

  // Collapsed
  let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;

  for (const r of details.results) {
    const rIcon = statusIcon(r, theme.fg.bind(theme));
    const displayItems = getDisplayItems(r.messages);
    text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
    if (displayItems.length === 0) {
      text += `\n${theme.fg(r.exitCode === -1 ? "muted" : isResultError(r) ? "error" : "muted", r.exitCode === -1 ? "(running...)" : getResultSummaryText(r))}`;
    } else {
      text += `\n${renderDisplayItems(displayItems, false, theme.fg.bind(theme), COLLAPSED_PARALLEL_LINE_COUNT)}`;
    }
  }

  if (!isRunning) {
    const totalUsage = formatUsage(aggregateUsage(details.results));
    if (totalUsage) text += `\n\n${theme.fg("dim", `Total: ${totalUsage}`)}`;
  }
  if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+E to expand)")}`;

  return new Text(text, 0, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/render.ts extensions/agentic-harness/tests/render.test.ts
git commit -m "feat(subagent): add TUI component rendering with renderCall/renderResult"
```

---

### Task 6: Update index.ts — Wire Rendering and Safety Guards

**Dependencies:** Runs after Task 4 and Task 5 complete
**Files:**
- Modify: `extensions/agentic-harness/index.ts:119-385`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Update index.ts imports**

Replace the subagent-related imports at the top of `index.ts`:

Old:
```typescript
import { discoverAgents } from "./agents.js";
import { runSingleAgent, runParallel, runChain, mapWithConcurrencyLimit, MAX_CONCURRENCY } from "./subagent.js";
```

New:
```typescript
import { discoverAgents } from "./agents.js";
import { runAgent, mapWithConcurrencyLimit, MAX_CONCURRENCY, MAX_PARALLEL_TASKS, resolveDepthConfig, getCycleViolations } from "./subagent.js";
import { emptyUsage, isResultError, isResultSuccess, getResultSummaryText, getFinalOutput, type SingleResult, type SubagentDetails } from "./types.js";
import { renderCall, renderResult } from "./render.js";
```

- [ ] **Step 2: Replace the subagent tool registration block**

Replace the entire subagent tool section (from `// subagent Tool` comment through the `execute` function close) with:

```typescript
  // ============================================================
  // subagent Tool
  // ============================================================

  const HEARTBEAT_MS = 1000;
  const depthConfig = resolveDepthConfig();

  const TaskItem = Type.Object({
    agent: Type.String({ description: "Name of the agent to invoke" }),
    task: Type.String({ description: "Task to delegate to the agent" }),
    cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  });

  const ChainItem = Type.Object({
    agent: Type.String({ description: "Name of the agent to invoke" }),
    task: Type.String({ description: "Task with optional {previous} placeholder for prior step output" }),
    cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  });

  const SubagentParams = Type.Object({
    agent: Type.Optional(Type.String({ description: "Agent name for single mode execution" })),
    task: Type.Optional(Type.String({ description: "Task description for single mode execution" })),
    tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} objects for parallel execution (max 8)" })),
    chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} objects for sequential chaining. Use {previous} in task to reference prior output." })),
    agentScope: Type.Optional(Type.Unsafe<"user" | "project" | "both">({
      type: "string", enum: ["user", "project", "both"],
      description: 'Which agent directories to search. Default: "user".',
      default: "user",
    })),
    cwd: Type.Optional(Type.String({ description: "Working directory for single mode" })),
  });

  const makeDetails = (mode: "single" | "parallel") => (results: SingleResult[]): SubagentDetails => ({ mode, results });

  if (depthConfig.canDelegate) {
    pi.registerTool({
      name: "subagent",
      label: "Subagent",
      description:
        "Delegate tasks to specialized agents running as separate pi processes. Supports single, parallel, and chain execution modes.",
      promptSnippet:
        "Delegate tasks to specialized agents (single, parallel, or chain mode)",
      promptGuidelines: [
        "Use single mode (agent + task) for one-off tasks. Use parallel mode (tasks array) for concurrent dispatch. Use chain mode (chain array) for sequential pipelines with {previous} placeholder.",
        "ONLY use these exact agent names — do NOT invent or guess agent names: explorer, worker, planner, plan-worker, plan-validator, plan-compliance, reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value.",
        "All agents use the default model. Do NOT specify or mention specific models (no Haiku, Sonnet, etc.).",
        "For codebase exploration: use 'explorer'. For general execution: use 'worker'. For plan execution: use 'plan-compliance' → 'plan-worker' → 'plan-validator'.",
        "For ultraplan milestone reviews: dispatch all 5 reviewers in parallel: reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value.",
        "Max 8 parallel tasks with 4 concurrent. Chain mode stops on first error.",
      ],
      parameters: SubagentParams,

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded }, theme) => renderResult(result, expanded, theme),

      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        const { agent, task, tasks, chain, agentScope, cwd } = params;
        const defaultCwd = ctx.cwd;
        const agents = await discoverAgents(defaultCwd, agentScope || "user", BUNDLED_AGENTS_DIR);
        const findAgent = (name: string) => agents.find((a) => a.name === name);

        // Safety: cycle detection
        if (depthConfig.preventCycles) {
          const requested: string[] = [];
          if (agent) requested.push(agent);
          if (tasks) for (const t of tasks) requested.push(t.agent);
          if (chain) for (const s of chain) requested.push(s.agent);
          const violations = getCycleViolations(requested, depthConfig.ancestorStack);
          if (violations.length > 0) {
            return {
              content: [{ type: "text" as const, text: `Blocked: delegation cycle detected. Agents already in stack: ${violations.join(", ")}. Stack: ${depthConfig.ancestorStack.join(" -> ") || "(root)"}` }],
              details: makeDetails("single")([]),
              isError: true,
            };
          }
        }

        // Chain mode
        if (chain && chain.length > 0) {
          let previousOutput = "";
          const allResults: SingleResult[] = [];

          for (let i = 0; i < chain.length; i++) {
            const step = chain[i];
            const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
            const result = await runAgent({
              agent: findAgent(step.agent),
              agentName: step.agent,
              task: taskWithContext,
              cwd: step.cwd || defaultCwd,
              depthConfig,
              signal,
              onUpdate,
              makeDetails: makeDetails("single"),
            });
            allResults.push(result);

            if (isResultError(result)) {
              const summary = allResults.map((r, j) => `[${chain[j].agent}] ${isResultError(r) ? "failed" : "completed"}: ${getResultSummaryText(r)}`).join("\n\n");
              return {
                content: [{ type: "text" as const, text: `Chain failed at step ${i + 1}: ${result.errorMessage || "error"}\n\n${summary}` }],
                details: makeDetails("single")(allResults),
              };
            }
            previousOutput = getFinalOutput(result.messages) || result.stderr;
          }

          const summary = allResults.map((r, i) => `[${chain[i].agent}] completed: ${getResultSummaryText(r)}`).join("\n\n");
          return {
            content: [{ type: "text" as const, text: summary }],
            details: makeDetails("single")(allResults),
          };
        }

        // Parallel mode
        if (tasks && tasks.length > 0) {
          if (tasks.length > MAX_PARALLEL_TASKS) {
            return {
              content: [{ type: "text" as const, text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
              details: makeDetails("parallel")([]),
            };
          }

          const allResults: SingleResult[] = tasks.map((t) => ({
            agent: t.agent, agentSource: "unknown" as const, task: t.task,
            exitCode: -1, messages: [], stderr: "", usage: emptyUsage(),
          }));

          const emitProgress = () => {
            if (!onUpdate) return;
            const done = allResults.filter((r) => r.exitCode !== -1).length;
            const running = allResults.filter((r) => r.exitCode === -1).length;
            onUpdate({
              content: [{ type: "text" as const, text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
              details: makeDetails("parallel")([...allResults]),
            });
          };

          let heartbeat: ReturnType<typeof setInterval> | undefined;
          if (onUpdate) {
            emitProgress();
            heartbeat = setInterval(() => {
              if (allResults.some((r) => r.exitCode === -1)) emitProgress();
            }, HEARTBEAT_MS);
          }

          let results: SingleResult[];
          try {
            results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (t, index) => {
              const result = await runAgent({
                agent: findAgent(t.agent),
                agentName: t.agent,
                task: t.task,
                cwd: t.cwd || defaultCwd,
                depthConfig,
                signal,
                onUpdate: (partial) => {
                  if (partial.details?.results[0]) {
                    allResults[index] = partial.details.results[0];
                    emitProgress();
                  }
                },
                makeDetails: makeDetails("parallel"),
              });
              allResults[index] = result;
              emitProgress();
              return result;
            });
          } finally {
            if (heartbeat) clearInterval(heartbeat);
          }

          const successCount = results.filter((r) => isResultSuccess(r)).length;
          const summaries = results.map((r) =>
            `[${r.agent}] ${isResultError(r) ? "failed" : "completed"}: ${getResultSummaryText(r)}`,
          );
          return {
            content: [{ type: "text" as const, text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}` }],
            details: makeDetails("parallel")(results),
          };
        }

        // Single mode
        if (agent && task) {
          const result = await runAgent({
            agent: findAgent(agent),
            agentName: agent,
            task,
            cwd: cwd || defaultCwd,
            depthConfig,
            signal,
            onUpdate,
            makeDetails: makeDetails("single"),
          });

          if (isResultError(result)) {
            return {
              content: [{ type: "text" as const, text: `Agent ${result.stopReason || "failed"}: ${getResultSummaryText(result)}` }],
              details: makeDetails("single")([result]),
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: getResultSummaryText(result) }],
            details: makeDetails("single")([result]),
          };
        }

        return {
          content: [{ type: "text" as const, text: "Error: Specify either (agent + task) for single mode, tasks for parallel mode, or chain for chain mode." }],
          details: makeDetails("single")([]),
        };
      },
    });
  }
```

- [ ] **Step 3: Remove the old tool_call event handler for subagent logging**

Delete the `tool_call` event handler block that starts with `pi.on("tool_call", ...)` — the custom rendering now replaces the logging need.

- [ ] **Step 4: Inject delegation guards into before_agent_start**

Add delegation depth info to the `before_agent_start` handler. In the section where `PHASE_GUIDANCE` is defined, add to the idle phase guidance:

After the `PHASE_GUIDANCE` object, add this to the `before_agent_start` handler, right before the `return`:

Replace the existing `before_agent_start` handler:
```typescript
  pi.on("before_agent_start", async (event, _ctx) => {
    const guidance = PHASE_GUIDANCE[currentPhase];

    // Inject delegation depth info
    let delegationInfo = "";
    if (depthConfig.canDelegate) {
      const agentList = (await discoverAgents(event.cwd || ".", "user", BUNDLED_AGENTS_DIR))
        .map((a) => `- **${a.name}**: ${a.description}`)
        .join("\n");
      delegationInfo = `\n\n## Delegation Guards\n- Current depth: ${depthConfig.currentDepth}, max: ${depthConfig.maxDepth}\n- Cycle prevention: ${depthConfig.preventCycles ? "enabled" : "disabled"}\n- Ancestor stack: ${depthConfig.ancestorStack.length > 0 ? depthConfig.ancestorStack.join(" -> ") : "(root)"}\n\n## Available Subagents\n${agentList}`;
    }

    if (!guidance && !delegationInfo) return;
    return {
      systemPrompt: event.systemPrompt + (guidance || "") + delegationInfo,
    };
  });
```

- [ ] **Step 5: Update extension.test.ts**

In the test file, update the subagent tool test to check for `renderCall` and `renderResult`:

Replace the "should register subagent tool" test:
```typescript
  it("should register subagent tool", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("subagent");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("subagent");
    expect(tool.promptSnippet).toBeDefined();
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines.length).toBe(6);
    expect(tool.renderCall).toBeTypeOf("function");
    expect(tool.renderResult).toBeTypeOf("function");
  });
```

Also update the event handlers test — remove the `tool_call` expectation since we removed that handler:

Replace the "should register event handlers" test:
```typescript
  it("should register event handlers", () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    expect(events.has("resources_discover")).toBe(true);
    expect(events.has("before_agent_start")).toBe(true);
    expect(events.has("session_start")).toBe(true);
    expect(events.has("context")).toBe(true);
    expect(events.has("session_before_compact")).toBe(true);
    expect(events.has("session_compact")).toBe(true);
    expect(events.has("tool_result")).toBe(true);
  });
```

- [ ] **Step 6: Run all tests to verify**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "feat(subagent): wire renderCall/renderResult TUI rendering and delegation safety guards"
```

---

### Task 7: Remove debug logs and cleanup

**Dependencies:** Runs after Task 6 completes
**Files:**
- Modify: `extensions/agentic-harness/subagent.ts`

- [ ] **Step 1: Remove all debug console.error lines from subagent.ts**

Search for and remove all lines containing `[subagent-debug]` in `subagent.ts`. There should be none remaining after the Task 4 rewrite, but verify with:

Run: `grep -n "subagent-debug" extensions/agentic-harness/subagent.ts`
Expected: No matches (the rewrite in Task 4 already removed them)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: ALL PASS

- [ ] **Step 4: Commit (if any changes)**

```bash
git add -A extensions/agentic-harness/
git commit -m "chore(subagent): remove debug logs and cleanup"
```

---

### Task 8 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run the full test suite**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: ALL PASS — all existing and new tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify plan success criteria**

Manually check each criterion:
- [ ] `types.ts` exists with `SingleResult`, `SubagentDetails`, `UsageStats`, `DisplayItem` types
- [ ] `runner-events.ts` exists with `processPiJsonLine` and message deduplication
- [ ] `runner-cli.ts` exists with `parseInheritedCliArgs` and `getInheritedCliArgs`
- [ ] `render.ts` exists with `renderCall` and `renderResult` using pi-tui components
- [ ] `subagent.ts` refactored to use new types, events, CLI args, and safety guards
- [ ] `index.ts` wires `renderCall`/`renderResult` in tool registration
- [ ] Safety guards: `resolveDepthConfig`, `getCycleViolations`, environment variable propagation
- [ ] All test files exist and pass

- [ ] **Step 4: Run full test suite for regressions**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: No regressions — all pre-existing tests still pass
