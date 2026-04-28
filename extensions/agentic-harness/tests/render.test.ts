// tests/render.test.ts
import { describe, it, expect } from "vitest";
import assert from "node:assert";
import { formatTokens, formatUsage, statusIcon, formatToolCall, renderResult } from "../render.js";
import { emptyUsage, type SingleResult, type SubagentDetails } from "../types.js";
import type { Theme } from "@mariozechner/pi-coding-agent";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

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

  it("should keep read summaries as path plus optional range", () => {
    expect(formatToolCall("read", { path: "/tmp/file.ts" }, identity)).toBe("read /tmp/file.ts");
    expect(formatToolCall("read", { path: "/tmp/file.ts", offset: 3, limit: 2 }, identity)).toBe("read /tmp/file.ts:3-4");
  });

  it("should keep write summaries as path plus line count", () => {
    const result = formatToolCall("write", { path: "/tmp/file.ts", content: "one\ntwo\nthree" }, identity);
    expect(result).toBe("write /tmp/file.ts (3 lines)");
  });

  it("should keep edit summaries as path only", () => {
    expect(formatToolCall("edit", { path: "/tmp/file.ts" }, identity)).toBe("edit /tmp/file.ts");
  });

  it("should format grep with pattern", () => {
    const result = formatToolCall("grep", { pattern: "TODO", path: "/src" }, identity);
    expect(result).toContain("TODO");
  });
});

describe("metadata rendering via renderResult", () => {
  it("should show truncation, artifacts, context, and worktree metadata", () => {
    const result: SingleResult = {
      agent: "worker",
      agentSource: "bundled",
      task: "t",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
      outputTruncation: { truncated: true, originalLength: 1000, returnedLength: 100, maxOutput: 100 },
      artifacts: { artifactDir: "/tmp/artifacts", outputFile: "/tmp/artifacts/output.md", progressFile: "/tmp/artifacts/progress.md" },
      contextMode: "fork",
      contextError: "missing session",
      worktree: { worktreePath: "/tmp/worktree", worktreeDiffFile: "/tmp/artifacts/worktree.diff.md", worktreeCleanupStatus: "removed" },
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "" }], details }, false, theme);
    const text = rendered.render(120).join("\n");
    expect(text).toContain("truncated 1000 → 100 chars");
    expect(text).toContain("artifacts /tmp/artifacts");
    expect(text).toContain("context fork");
    expect(text).toContain("worktree /tmp/worktree");
    expect(text).toMatch(/diff\s+\/tmp\/artifacts\/worktree\.diff\.md/);
  });
});

describe("nested subagent rendering via renderResult", () => {
  it("should show nested subagent calls with ⏳ when parent is running", () => {
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
    const text = rendered.render(80).join("\n");
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
    const text = rendered.render(80).join("\n");
    assert.ok(text.includes("worker"), `Expected "worker" in rendered output: ${text}`);
    assert.ok(text.includes("✓"), `Expected ✓ icon in rendered output: ${text}`);
  });
});
