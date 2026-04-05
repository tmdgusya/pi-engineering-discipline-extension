// tests/plan-parser.test.ts
import { describe, it, expect } from "vitest";
import { parsePlan, type PlanTask } from "../plan-parser.js";

const SAMPLE_PLAN = `# Test Plan

**Goal:** Build a feature

**Verification Strategy:**
- **Level:** test-suite
- **Command:** \`npx vitest --run\`
- **What it validates:** All tests pass

---

### Task 1: Create types — Shared Types

**Dependencies:** None (can run in parallel)
**Files:**
- Create: \`src/types.ts\`
- Test: \`tests/types.test.ts\`

- [ ] **Step 1: Write the test**

\`\`\`typescript
import { expect } from "vitest";
expect(true).toBe(true);
\`\`\`

- [ ] **Step 2: Run test to verify it fails**

Run: \`npx vitest --run tests/types.test.ts\`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

\`\`\`typescript
export interface MyType { name: string; }
\`\`\`

- [ ] **Step 4: Run test to verify it passes**

Run: \`npx vitest --run tests/types.test.ts\`
Expected: PASS

### Task 2: Create utils — Utility Functions

**Dependencies:** Runs after Task 1 completes
**Files:**
- Create: \`src/utils.ts\`
- Modify: \`src/types.ts\`
- Test: \`tests/utils.test.ts\`

- [ ] **Step 1: Write the test**

\`\`\`typescript
import { format } from "../src/utils.js";
expect(format("hello")).toBe("HELLO");
\`\`\`

- [ ] **Step 2: Run test**

Run: \`npx vitest --run tests/utils.test.ts\`
Expected: PASS

- [ ] **Step 3: Commit**

\`\`\`bash
git add src/utils.ts tests/utils.test.ts
git commit -m "feat: add utils"
\`\`\`

### Task 3 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: \`npx vitest --run\`
Expected: ALL PASS
`;

describe("parsePlan", () => {
  it("should extract plan metadata", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.goal).toBe("Build a feature");
    expect(plan.verificationCommand).toBe("npx vitest --run");
  });

  it("should extract all tasks", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.tasks).toHaveLength(3);
  });

  it("should parse task 1 correctly", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t = plan.tasks[0];
    expect(t.id).toBe(1);
    expect(t.name).toBe("Create types — Shared Types");
    expect(t.dependencies).toBe("None (can run in parallel)");
    expect(t.files).toContain("src/types.ts");
    expect(t.files).toContain("tests/types.test.ts");
  });

  it("should extract test commands from Run: lines", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t = plan.tasks[0];
    expect(t.testCommands).toContain("npx vitest --run tests/types.test.ts");
  });

  it("should extract acceptance criteria from Expected: lines", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t = plan.tasks[0];
    expect(t.acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
    expect(t.acceptanceCriteria.some((c) => c.includes("PASS"))).toBe(true);
  });

  it("should parse task 2 with dependencies", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t = plan.tasks[1];
    expect(t.id).toBe(2);
    expect(t.dependencies).toBe("Runs after Task 1 completes");
    expect(t.files).toContain("src/utils.ts");
    expect(t.files).toContain("src/types.ts");
    expect(t.files).toContain("tests/utils.test.ts");
  });

  it("should parse final verification task", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t = plan.tasks[2];
    expect(t.id).toBe(3);
    expect(t.name).toContain("End-to-End Verification");
    expect(t.isFinal).toBe(true);
  });

  it("should build full step text for each task", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t = plan.tasks[0];
    expect(t.fullStepsText).toContain("Step 1:");
    expect(t.fullStepsText).toContain("Step 4:");
  });

  it("should find task by id", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const t2 = plan.tasks.find((t) => t.id === 2);
    expect(t2).toBeDefined();
    expect(t2!.name).toContain("utils");
  });

  it("should return empty tasks for non-plan content", () => {
    const plan = parsePlan("# Just a README\n\nSome text.");
    expect(plan.tasks).toHaveLength(0);
    expect(plan.goal).toBe("");
  });
});
