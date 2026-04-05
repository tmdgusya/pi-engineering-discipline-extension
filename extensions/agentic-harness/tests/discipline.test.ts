import { describe, it, expect } from "vitest";
import { isDisciplineAgent, augmentAgentWithKarpathy, KARPATHY_RULES, getSlopCleanerTask } from "../discipline.js";
import type { AgentConfig } from "../agents.js";

describe("isDisciplineAgent", () => {
  it("returns true for plan-worker", () => {
    expect(isDisciplineAgent("plan-worker")).toBe(true);
  });

  it("returns true for worker", () => {
    expect(isDisciplineAgent("worker")).toBe(true);
  });

  it("returns false for explorer", () => {
    expect(isDisciplineAgent("explorer")).toBe(false);
  });

  it("returns false for plan-validator", () => {
    expect(isDisciplineAgent("plan-validator")).toBe(false);
  });

  it("returns false for slop-cleaner", () => {
    expect(isDisciplineAgent("slop-cleaner")).toBe(false);
  });
});

describe("augmentAgentWithKarpathy", () => {
  const baseAgent: AgentConfig = {
    name: "worker",
    description: "Test worker",
    systemPrompt: "You are a worker.",
    source: "bundled",
    filePath: "/test/worker.md",
  };

  it("appends karpathy rules to system prompt", () => {
    const augmented = augmentAgentWithKarpathy(baseAgent);
    expect(augmented).not.toBeUndefined();
    expect(augmented!.systemPrompt).toContain("You are a worker.");
    expect(augmented!.systemPrompt).toContain("Karpathy Rules");
    expect(augmented!.systemPrompt).toContain("Read before you write");
    expect(augmented!.systemPrompt).toContain("Surgical Changes");
  });

  it("does not mutate the original agent", () => {
    const augmented = augmentAgentWithKarpathy(baseAgent);
    expect(baseAgent.systemPrompt).toBe("You are a worker.");
    expect(augmented).not.toBe(baseAgent);
  });

  it("preserves all other agent fields", () => {
    const augmented = augmentAgentWithKarpathy(baseAgent)!;
    expect(augmented.name).toBe(baseAgent.name);
    expect(augmented.description).toBe(baseAgent.description);
    expect(augmented.source).toBe(baseAgent.source);
    expect(augmented.filePath).toBe(baseAgent.filePath);
  });

  it("returns undefined for undefined input", () => {
    expect(augmentAgentWithKarpathy(undefined)).toBeUndefined();
  });
});

describe("KARPATHY_RULES", () => {
  it("contains all hard gates", () => {
    expect(KARPATHY_RULES).toContain("Read before you write");
    expect(KARPATHY_RULES).toContain("Scope to the request");
    expect(KARPATHY_RULES).toContain("Verify, don't assume");
    expect(KARPATHY_RULES).toContain("Define success before starting");
  });

  it("contains all five rules", () => {
    expect(KARPATHY_RULES).toContain("Surgical Changes");
    expect(KARPATHY_RULES).toContain("Match Existing Patterns");
    expect(KARPATHY_RULES).toContain("No Premature Abstraction");
    expect(KARPATHY_RULES).toContain("No Defensive Paranoia");
    expect(KARPATHY_RULES).toContain("No Future-Proofing");
  });
});

describe("getSlopCleanerTask", () => {
  it("returns a non-empty task string", () => {
    const task = getSlopCleanerTask();
    expect(task.length).toBeGreaterThan(0);
  });

  it("references git commands for file discovery", () => {
    const task = getSlopCleanerTask();
    expect(task).toContain("git status");
    expect(task).toContain("git diff");
  });

  it("mentions the 6-pass cleanup process", () => {
    const task = getSlopCleanerTask();
    expect(task).toContain("6-pass");
  });
});
