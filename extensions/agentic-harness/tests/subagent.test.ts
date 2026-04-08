// tests/subagent.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  const originalArgv = [...process.argv];

  afterEach(() => {
    process.argv = [...originalArgv];
  });

  it("should return a valid invocation object", () => {
    const invocation = getPiInvocation();
    expect(invocation).toHaveProperty("command");
    expect(invocation).toHaveProperty("args");
    expect(typeof invocation.command).toBe("string");
    expect(Array.isArray(invocation.args)).toBe(true);
  });

  it("should fall back to pi when running under vite-node", () => {
    process.argv = [
      "/usr/bin/node",
      "/tmp/project/node_modules/vite-node/dist/cli.mjs",
      "/tmp/script.ts",
    ];

    const invocation = getPiInvocation();
    expect(invocation).toEqual({ command: "pi", args: [] });
  });

  it("should fall back to pi when running under vitest", () => {
    process.argv = [
      "/usr/bin/node",
      "/tmp/project/node_modules/vitest/vitest.mjs",
      "run",
    ];

    const invocation = getPiInvocation();
    expect(invocation).toEqual({ command: "pi", args: [] });
  });

  it("should fall back to pi when running under vite cli", () => {
    process.argv = [
      "/usr/bin/node",
      "/tmp/project/node_modules/vite/bin/vite.js",
      "dev",
    ];

    const invocation = getPiInvocation();
    expect(invocation).toEqual({ command: "pi", args: [] });
  });
});

describe("Constants", () => {
  it("should have correct limits", () => {
    expect(MAX_PARALLEL_TASKS).toBe(8);
    expect(MAX_CONCURRENCY).toBe(4);
  });
});

describe("resolveDepthConfig", () => {
  const originalDepth = process.env.PI_SUBAGENT_DEPTH;
  const originalMaxDepth = process.env.PI_SUBAGENT_MAX_DEPTH;
  const originalStack = process.env.PI_SUBAGENT_STACK;
  const originalPreventCycles = process.env.PI_SUBAGENT_PREVENT_CYCLES;

  beforeEach(() => {
    delete process.env.PI_SUBAGENT_DEPTH;
    delete process.env.PI_SUBAGENT_MAX_DEPTH;
    delete process.env.PI_SUBAGENT_STACK;
    delete process.env.PI_SUBAGENT_PREVENT_CYCLES;
  });

  afterEach(() => {
    if (originalDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = originalDepth;

    if (originalMaxDepth === undefined) delete process.env.PI_SUBAGENT_MAX_DEPTH;
    else process.env.PI_SUBAGENT_MAX_DEPTH = originalMaxDepth;

    if (originalStack === undefined) delete process.env.PI_SUBAGENT_STACK;
    else process.env.PI_SUBAGENT_STACK = originalStack;

    if (originalPreventCycles === undefined) delete process.env.PI_SUBAGENT_PREVENT_CYCLES;
    else process.env.PI_SUBAGENT_PREVENT_CYCLES = originalPreventCycles;
  });

  it("should return defaults when no env vars set", () => {
    const config = resolveDepthConfig();
    expect(config.currentDepth).toBe(0);
    expect(config.maxDepth).toBe(DEFAULT_MAX_DEPTH);
    expect(config.canDelegate).toBe(true);
    expect(config.ancestorStack).toEqual([]);
    expect(config.preventCycles).toBe(true);
  });

  it("should read explicit env overrides", () => {
    process.env.PI_SUBAGENT_DEPTH = "1";
    process.env.PI_SUBAGENT_MAX_DEPTH = "5";
    process.env.PI_SUBAGENT_STACK = JSON.stringify(["root", "worker"]);
    process.env.PI_SUBAGENT_PREVENT_CYCLES = "0";

    const config = resolveDepthConfig();
    expect(config.currentDepth).toBe(1);
    expect(config.maxDepth).toBe(5);
    expect(config.canDelegate).toBe(true);
    expect(config.ancestorStack).toEqual(["root", "worker"]);
    expect(config.preventCycles).toBe(false);
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
