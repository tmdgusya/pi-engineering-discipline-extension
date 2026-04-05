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
