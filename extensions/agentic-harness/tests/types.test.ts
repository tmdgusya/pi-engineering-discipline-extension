// tests/types.test.ts
import { describe, it, expect } from "vitest";
import {
  emptyUsage,
  aggregateUsage,
  isResultSuccess,
  isResultError,
  getDisplayItems,
  getFinalOutput,
  getResultSummaryText,
  truncateForModel,
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

describe("truncateForModel / getResultSummaryText", () => {
  it("should leave short output unchanged", () => {
    expect(truncateForModel("short", 10)).toEqual({ text: "short" });
  });

  it("should truncate long model-facing output with metadata", () => {
    const result = truncateForModel("a".repeat(100), 50);
    expect(result.text.length).toBeLessThanOrEqual(50);
    expect(result.text).toContain("[truncated: 100 -> 50 chars]");
    expect(result.metadata).toMatchObject({ truncated: true, originalLength: 100, maxOutput: 50 });
  });

  it("should attach truncation metadata to result summaries", () => {
    const r = makeResult({ messages: [{ role: "assistant", content: [{ type: "text", text: "x".repeat(120) }] }] });
    const text = getResultSummaryText(r, 60);
    expect(text).toContain("[truncated: 120 -> 60 chars]");
    expect(r.outputTruncation?.originalLength).toBe(120);
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
