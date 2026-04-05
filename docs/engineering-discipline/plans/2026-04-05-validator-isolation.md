# Validator Information Barrier Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Enforce the validator information barrier in code — when `plan-validator` is called via the subagent tool, the validator's task prompt is built directly from the plan file by code, not composed by the main LLM agent.

**Architecture:** Add a plan parser (`plan-parser.ts`) that extracts structured task data from plan markdown files. Add a validator template builder (`validator-template.ts`) that constructs the fixed validator prompt. Extend `SubagentParams` with optional `planFile` and `planTaskId` fields. In the subagent tool's execute function, intercept `plan-validator` calls and replace the LLM-composed `task` with the code-generated prompt. Non-validator calls are unaffected.

**Tech Stack:** TypeScript, `@sinclair/typebox`, vitest

**Work Scope:**
- **In scope:**
  - `plan-parser.ts` — parse plan.md into structured `PlanTask[]`
  - `validator-template.ts` — build fixed validator prompt from `PlanTask`
  - Extend `SubagentParams` with `planFile` + `planTaskId` optional fields
  - Intercept `plan-validator` calls in execute function
  - Tests for parser, template, and integration
  - Update `promptGuidelines` to instruct LLM to pass `planFile`/`planTaskId`
- **Out of scope:**
  - Changing the plan-crafting skill's output format
  - Code-based orchestration of the full worker-validator loop
  - Modifying the `plan-validator` agent definition

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npx vitest --run`
- **What it validates:** All unit tests pass including new modules, no regressions

---

## File Structure Mapping

| File | Action | Responsibility |
|------|--------|---------------|
| `extensions/agentic-harness/plan-parser.ts` | Create | Parse plan markdown into structured PlanTask[] |
| `extensions/agentic-harness/validator-template.ts` | Create | Build fixed validator prompt from PlanTask |
| `extensions/agentic-harness/index.ts` | Modify | Add planFile/planTaskId params, intercept plan-validator |
| `extensions/agentic-harness/tests/plan-parser.test.ts` | Create | Plan parser tests |
| `extensions/agentic-harness/tests/validator-template.test.ts` | Create | Validator template tests |
| `extensions/agentic-harness/tests/extension.test.ts` | Modify | Add validator interception tests |

---

### Task 1: Create plan-parser.ts — Plan Markdown Parser

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/agentic-harness/plan-parser.ts`
- Create: `extensions/agentic-harness/tests/plan-parser.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest --run tests/plan-parser.test.ts`
Expected: FAIL — module `../plan-parser.js` not found

- [ ] **Step 3: Write the plan parser implementation**

```typescript
// plan-parser.ts
/**
 * Parses plan markdown files into structured task data.
 * Used to enforce the validator information barrier —
 * validator prompts are built from parsed plan data, not LLM-composed text.
 */

export interface PlanTask {
  /** Task number extracted from "### Task N:" header */
  id: number;
  /** Task name (text after "Task N:") */
  name: string;
  /** Raw dependencies line */
  dependencies: string;
  /** All file paths (Create, Modify, Test) */
  files: string[];
  /** Commands extracted from "Run: `...`" lines */
  testCommands: string[];
  /** Criteria extracted from "Expected: ..." lines, paired with their Run commands */
  acceptanceCriteria: string[];
  /** Whether this is the final verification task */
  isFinal: boolean;
  /** Full text of all steps (for reference, not sent to validator) */
  fullStepsText: string;
}

export interface ParsedPlan {
  /** Plan goal from "**Goal:**" line */
  goal: string;
  /** Verification command from Verification Strategy */
  verificationCommand: string;
  /** All parsed tasks */
  tasks: PlanTask[];
}

export function parsePlan(markdown: string): ParsedPlan {
  const goal = extractField(markdown, "Goal");
  const verificationCommand = extractVerificationCommand(markdown);
  const tasks = extractTasks(markdown);
  return { goal, verificationCommand, tasks };
}

function extractField(md: string, field: string): string {
  const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, "m");
  const match = md.match(re);
  return match ? match[1].trim() : "";
}

function extractVerificationCommand(md: string): string {
  const match = md.match(/\*\*Command:\*\*\s*`([^`]+)`/m);
  return match ? match[1].trim() : "";
}

function extractTasks(md: string): PlanTask[] {
  // Split on task headers: ### Task N: ... or ### Task N (Final): ...
  const taskHeaderRe = /^### Task (\d+)(?:\s*\(Final\))?:\s*(.+)$/gm;
  const headers: { index: number; id: number; name: string; isFinal: boolean }[] = [];

  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = taskHeaderRe.exec(md)) !== null) {
    headers.push({
      index: headerMatch.index,
      id: parseInt(headerMatch[1], 10),
      name: headerMatch[2].trim(),
      isFinal: headerMatch[0].includes("(Final)"),
    });
  }

  const tasks: PlanTask[] = [];

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : md.length;
    const section = md.slice(start, end);

    const dependencies = extractField(section, "Dependencies");
    const files = extractFiles(section);
    const { testCommands, acceptanceCriteria } = extractRunExpected(section);
    const fullStepsText = extractStepsText(section);

    tasks.push({
      id: headers[i].id,
      name: headers[i].name,
      dependencies,
      files,
      testCommands,
      acceptanceCriteria,
      isFinal: headers[i].isFinal,
      fullStepsText,
    });
  }

  return tasks;
}

function extractFiles(section: string): string[] {
  const files: string[] = [];
  const fileRe = /(?:Create|Modify|Test):\s*`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(section)) !== null) {
    // Strip line range suffixes like ":123-145"
    const path = m[1].replace(/:\d+-\d+$/, "");
    if (!files.includes(path)) files.push(path);
  }
  return files;
}

function extractRunExpected(section: string): {
  testCommands: string[];
  acceptanceCriteria: string[];
} {
  const testCommands: string[] = [];
  const acceptanceCriteria: string[] = [];
  const lines = section.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const runMatch = lines[i].match(/^Run:\s*`([^`]+)`/);
    if (runMatch) {
      const cmd = runMatch[1].trim();
      if (!testCommands.includes(cmd)) testCommands.push(cmd);

      // Look for Expected: on the next line
      if (i + 1 < lines.length) {
        const expMatch = lines[i + 1].match(/^Expected:\s*(.+)/);
        if (expMatch) {
          acceptanceCriteria.push(`${cmd} → ${expMatch[1].trim()}`);
        }
      }
    }
  }

  return { testCommands, acceptanceCriteria };
}

function extractStepsText(section: string): string {
  const match = section.match(/^- \[ \] \*\*Step 1:/m);
  if (!match || match.index === undefined) return "";
  return section.slice(match.index).trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/plan-parser.test.ts`
Expected: PASS — all 10 tests pass

- [ ] **Step 5: Run full test suite for regressions**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: No regressions

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/plan-parser.ts extensions/agentic-harness/tests/plan-parser.test.ts
git commit -m "feat(harness): add plan markdown parser for validator isolation"
```

---

### Task 2: Create validator-template.ts — Fixed Validator Prompt Builder

**Dependencies:** Runs after Task 1 completes
**Files:**
- Create: `extensions/agentic-harness/validator-template.ts`
- Create: `extensions/agentic-harness/tests/validator-template.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/agentic-harness && npx vitest --run tests/validator-template.test.ts`
Expected: FAIL — module `../validator-template.js` not found

- [ ] **Step 3: Write the validator template implementation**

```typescript
// validator-template.ts
/**
 * Builds the fixed validator prompt from parsed plan task data.
 *
 * This template is the code-enforced information barrier:
 * the validator receives ONLY plan-derived data, never worker output.
 */

import type { PlanTask } from "./plan-parser.js";

export function buildValidatorPrompt(
  task: PlanTask,
  verificationCommand?: string,
): string {
  const filesSection = task.files.length > 0
    ? task.files.map((f) => `- \`${f}\``).join("\n")
    : "- (No specific files listed)";

  const criteriaSection = task.acceptanceCriteria.length > 0
    ? task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")
    : "- All files listed above exist and contain correct implementation";

  const testSection = buildTestSection(task.testCommands, verificationCommand);

  return `You are an independent validator. You have no knowledge of how this task
was implemented. Your job is to judge whether the codebase currently meets
the goal described below, by reading files and running tests yourself.

## Task Goal

${task.name}

## Acceptance Criteria

${criteriaSection}

## Files To Inspect

${filesSection}

## Test Commands

${testSection}

## Your Review Process

1. Read each file in the file list directly from disk.
2. For each acceptance criterion, determine whether it is met
   based on what you see in the code. Record PASS or FAIL per criterion.
3. Run every test command listed above. Record results.
4. Run the full test suite to check for regressions.
5. Check for residual issues: placeholder code (TODO, FIXME, stubs),
   debug code (console.log, print statements), commented-out blocks.

## Your Output

Report your verdict as PASS or FAIL.

- If PASS: confirm which criteria were verified and which tests passed.
- If FAIL: list exactly which criteria failed and why, with file paths
  and line numbers. Do not suggest fixes — only describe what is wrong.`;
}

function buildTestSection(
  testCommands: string[],
  verificationCommand?: string,
): string {
  const parts: string[] = [];

  if (testCommands.length > 0) {
    parts.push("### Task-Specific Tests");
    for (const cmd of testCommands) {
      parts.push(`- \`${cmd}\``);
    }
  } else {
    parts.push("No specific test commands for this task.");
  }

  if (verificationCommand) {
    parts.push("");
    parts.push("### Full Test Suite");
    parts.push(`- \`${verificationCommand}\``);
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/agentic-harness && npx vitest --run tests/validator-template.test.ts`
Expected: PASS — all 9 tests pass

- [ ] **Step 5: Run full test suite for regressions**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: No regressions

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/validator-template.ts extensions/agentic-harness/tests/validator-template.test.ts
git commit -m "feat(harness): add fixed validator prompt template for information barrier"
```

---

### Task 3: Wire Validator Interception into Subagent Tool

**Dependencies:** Runs after Task 1 and Task 2 complete
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add imports to index.ts**

At the top of `index.ts`, add after the existing imports:

```typescript
import { parsePlan } from "./plan-parser.js";
import { buildValidatorPrompt } from "./validator-template.js";
import { readFile } from "fs/promises";
```

Note: `readFile` from `fs/promises` — check if already imported. If not, add it.

- [ ] **Step 2: Extend SubagentParams with planFile and planTaskId**

In `index.ts`, modify the `SubagentParams` definition to add two optional fields:

```typescript
const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent name for single mode execution" })),
  task: Type.Optional(Type.String({ description: "Task description for single mode execution" })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} objects for parallel execution (max 8)" })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} objects for sequential chaining. Use {previous} in task to reference prior output." })),
  agentScope: Type.Optional(Type.Unsafe<"user" | "project" | "both">({
    type: "string", enum: ["user", "project", "both"],
    description: 'Which agent directories to search. Default: "user".',
    default: "user",
  })),
  cwd: Type.Optional(Type.String({ description: "Working directory for single mode" })),
  planFile: Type.Optional(Type.String({ description: "Path to plan file. Required when agent is plan-validator — the validator prompt is built from this file, not from the task field." })),
  planTaskId: Type.Optional(Type.Number({ description: "Task number in the plan file to validate (e.g. 1 for Task 1). Required when agent is plan-validator." })),
});
```

- [ ] **Step 3: Add validator interception in the single mode branch**

In the execute function, modify the single mode branch (`if (agent && task)`) to intercept `plan-validator` calls. Replace the existing single mode block:

```typescript
// Single mode
if (agent && task) {
  let effectiveTask = task;

  // Validator information barrier: replace LLM-composed task with
  // code-generated prompt built directly from the plan file.
  if (agent === "plan-validator" && params.planFile && params.planTaskId != null) {
    try {
      const planContent = await readFile(params.planFile, "utf-8");
      const parsed = parsePlan(planContent);
      const planTask = parsed.tasks.find((t) => t.id === params.planTaskId);
      if (planTask) {
        effectiveTask = buildValidatorPrompt(planTask, parsed.verificationCommand);
      }
    } catch {
      // If plan file can't be read/parsed, fall through to LLM-composed task
    }
  }

  const result = await runAgent({
    agent: findAgent(agent),
    agentName: agent,
    task: effectiveTask,
    cwd: cwd || defaultCwd,
    depthConfig,
    signal,
    onUpdate,
    makeDetails: makeDetails("single"),
  });

  if (isResultError(result)) {
    return {
      content: [{ type: "text" as const, text: `Agent ${result.stopReason || "failed"}: ${getResultSummaryText(result)}` }],
      details: makeDetails("single")([result]),
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: getResultSummaryText(result) }],
    details: makeDetails("single")([result]),
  };
}
```

- [ ] **Step 4: Update promptGuidelines to instruct LLM about planFile/planTaskId**

In the `promptGuidelines` array of the subagent tool registration, add a guideline:

```typescript
"When calling plan-validator, ALWAYS provide planFile (path to the plan .md file) and planTaskId (the task number to validate). The validator prompt will be built from the plan file automatically — you do not need to compose it. Example: { agent: 'plan-validator', task: 'validate', planFile: 'docs/.../plan.md', planTaskId: 3 }",
```

- [ ] **Step 5: Add tests for validator interception**

Add the following tests to `tests/extension.test.ts`:

```typescript
describe("Validator Information Barrier", () => {
  it("should register planFile and planTaskId in subagent params", () => {
    const subagentTool = registeredTools.find((t: any) => t.name === "subagent");
    expect(subagentTool).toBeDefined();
    const schema = subagentTool!.parameters;
    // Verify schema has planFile and planTaskId properties
    expect(schema.properties.planFile).toBeDefined();
    expect(schema.properties.planTaskId).toBeDefined();
  });

  it("should include plan-validator guideline in promptGuidelines", () => {
    const subagentTool = registeredTools.find((t: any) => t.name === "subagent");
    expect(subagentTool).toBeDefined();
    const guidelines = subagentTool!.promptGuidelines || [];
    expect(guidelines.some((g: string) => g.includes("planFile") && g.includes("planTaskId"))).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd extensions/agentic-harness && npx vitest --run tests/extension.test.ts`
Expected: PASS — including new validator barrier tests

- [ ] **Step 7: TypeScript type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Run full test suite for regressions**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: No regressions — all tests pass

- [ ] **Step 9: Commit**

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "feat(harness): enforce validator information barrier via plan-derived prompts"
```

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: ALL PASS

- [ ] **Step 2: Verify plan success criteria**

Manually check each success criterion:
- [ ] `plan-parser.ts` correctly extracts tasks, files, test commands, and acceptance criteria from plan markdown
- [ ] `validator-template.ts` builds a fixed prompt that contains NO worker output, only plan-derived data
- [ ] `SubagentParams` has `planFile` and `planTaskId` optional fields
- [ ] When `agent === "plan-validator"` and `planFile`/`planTaskId` are provided, the LLM-composed `task` is replaced with the code-generated prompt
- [ ] When `planFile`/`planTaskId` are missing or invalid, the tool falls back to the LLM-composed task
- [ ] `promptGuidelines` instruct the LLM to always pass `planFile` and `planTaskId` for plan-validator
- [ ] Non-validator subagent calls are completely unaffected

- [ ] **Step 3: Run full test suite for regressions**

Run: `cd extensions/agentic-harness && npx vitest --run`
Expected: No regressions — all pre-existing tests still pass

- [ ] **Step 4: TypeScript type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors
