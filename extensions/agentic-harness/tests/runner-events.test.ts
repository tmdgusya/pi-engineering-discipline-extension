// tests/runner-events.test.ts
import { describe, it, expect } from "vitest";
import { processPiJsonLine, getMessageSignature } from "../runner-events.js";
import { emptyUsage, type SingleResult } from "../types.js";
import assert from "node:assert/strict";

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
