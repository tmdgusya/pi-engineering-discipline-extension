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
