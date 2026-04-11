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
    expect(prompt).toContain("All User Messages");
    expect(prompt).toContain("<analysis>");
    expect(prompt).toContain("<summary>");
    expect(prompt).not.toContain("Active Workflow");
  });

  it("should include phase-specific section for clarifying", () => {
    const prompt = getCompactionPrompt("clarifying", "docs/brief.md");
    expect(prompt).toContain("Active Workflow: Agentic Clarification");
    expect(prompt).toContain("docs/brief.md");
    expect(prompt).toContain("scope");
  });

  it("should include phase-specific section for planning", () => {
    const prompt = getCompactionPrompt("planning", "docs/plan.md");
    expect(prompt).toContain("Active Workflow: Agentic Plan Crafting");
    expect(prompt).toContain("docs/plan.md");
    expect(prompt).toContain("task progress");
  });

  it("should include phase-specific section for ultraplanning", () => {
    const prompt = getCompactionPrompt("ultraplanning", "docs/milestones.md");
    expect(prompt).toContain("Active Workflow: Agentic Milestone Planning");
    expect(prompt).toContain("docs/milestones.md");
  });

  it("should include phase-specific section for reviewing without a goal document", () => {
    const prompt = getCompactionPrompt("reviewing", null);
    expect(prompt).toContain("Active Workflow: Code Review");
    expect(prompt).toContain("resolved review target");
    expect(prompt).toContain("No changes to review");
  });

  it("should include phase-specific section for ultrareviewing without a goal document", () => {
    const prompt = getCompactionPrompt("ultrareviewing", null);
    expect(prompt).toContain("Active Workflow: Deep Code Review");
    expect(prompt).toContain("shared diff artifact");
    expect(prompt).toContain("Stage 2 verification status");
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
