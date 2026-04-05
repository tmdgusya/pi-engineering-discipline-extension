// tests/validator-template.test.ts
import { describe, it, expect } from "vitest";
import { buildValidatorPrompt } from "../validator-template.js";
import type { PlanTask } from "../plan-parser.js";

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 1,
    name: "Create types — Shared Types",
    dependencies: "None",
    files: ["src/types.ts", "tests/types.test.ts"],
    testCommands: ["npx vitest --run tests/types.test.ts"],
    acceptanceCriteria: [
      "npx vitest --run tests/types.test.ts → PASS",
    ],
    isFinal: false,
    fullStepsText: "- [ ] Step 1: Write test\n- [ ] Step 2: Run test",
    ...overrides,
  };
}

describe("buildValidatorPrompt", () => {
  it("should include task goal", () => {
    const prompt = buildValidatorPrompt(makeTask());
    expect(prompt).toContain("Create types — Shared Types");
  });

  it("should include all files to inspect", () => {
    const prompt = buildValidatorPrompt(makeTask());
    expect(prompt).toContain("src/types.ts");
    expect(prompt).toContain("tests/types.test.ts");
  });

  it("should include test commands", () => {
    const prompt = buildValidatorPrompt(makeTask());
    expect(prompt).toContain("npx vitest --run tests/types.test.ts");
  });

  it("should include acceptance criteria", () => {
    const prompt = buildValidatorPrompt(makeTask());
    expect(prompt).toContain("PASS");
  });

  it("should include the fixed review process instructions", () => {
    const prompt = buildValidatorPrompt(makeTask());
    expect(prompt).toContain("You are an independent validator");
    expect(prompt).toContain("PASS or FAIL");
    expect(prompt).toContain("placeholder code");
  });

  it("should include verification command when provided", () => {
    const prompt = buildValidatorPrompt(makeTask(), "npx vitest --run");
    expect(prompt).toContain("npx vitest --run");
    expect(prompt).toContain("Full Test Suite");
  });

  it("should not include worker-specific information", () => {
    const prompt = buildValidatorPrompt(makeTask());
    expect(prompt).not.toContain("fullStepsText");
    expect(prompt).not.toContain("Step 1: Write test");
  });

  it("should handle task with no test commands", () => {
    const prompt = buildValidatorPrompt(makeTask({ testCommands: [] }));
    expect(prompt).toContain("No specific test commands");
  });

  it("should handle task with no acceptance criteria", () => {
    const prompt = buildValidatorPrompt(makeTask({ acceptanceCriteria: [] }));
    expect(prompt).toContain("Files To Inspect");
  });
});
