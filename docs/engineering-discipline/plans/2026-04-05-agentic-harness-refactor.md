# Agentic Harness Refactor: Dynamic Agent-Driven Architecture

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. All tasks modify `index.ts` and must run sequentially (Tasks 1-7). Task 8 (tests) runs after Task 7.

**Goal:** Remove all hardcoded templates/categories from `extensions/agentic-harness/index.ts` and replace with an architecture where the LLM agent dynamically generates questions, selects reviewers, and drives workflow — using `ask_user_question` tool, `before_agent_start` event, `resources_discover` event, and `sendUserMessage` delegation.

**Architecture:** The extension registers a single `ask_user_question` tool (TypeBox schema) that the agent calls autonomously when it detects ambiguity. Commands (`/clarify`, `/plan`, `/ultraplan`) delegate to the agent via `sendUserMessage` with structured prompts. Workflow state is tracked in-memory and injected into the system prompt via `before_agent_start`. Engineering discipline skills are registered via `resources_discover`.

**Tech Stack:** TypeScript, `@sinclair/typebox` (schema), `@mariozechner/pi-coding-agent` (extension API), `@mariozechner/pi-tui` (TUI components), Vitest (testing)

**Work Scope:**
- **In scope:** Rewrite `index.ts` — remove hardcoded templates, TypeBox schema for tool, `resources_discover`, `before_agent_start`, rewrite all 4 commands, update tests
- **Out of scope:** HUD Dashboard, SKILL.md files, pi-coding-agent core, `@mariozechner/pi-ai` dependency (not needed — no enums in tool params)

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test`
- **What it validates:** Extension registers tools/commands correctly, event handlers respond properly, workflow state transitions work

**Assumptions:**
- `resources_discover` event handler accepts `skillPaths` pointing to directories containing `SKILL.md` files (needs runtime verification)
- `before_agent_start` result's `systemPrompt` field replaces the system prompt for that turn when returned
- `~/engineering-discipline/skills/` is the canonical skill location (per README prerequisites)

---

## File Structure Mapping

| File | Action | Responsibility |
|------|--------|---------------|
| `extensions/agentic-harness/index.ts` | Modify (full rewrite) | Extension entry point — tool, commands, event handlers |
| `extensions/agentic-harness/tests/ultraplan.test.ts` | Modify | Update to match new dynamic ultraplan structure |
| `extensions/agentic-harness/tests/extension.test.ts` | Create | Test tool registration, event handlers, workflow state |

---

## Task 1: Strip Hardcoded Code + Add Imports and Workflow State

**Dependencies:** None (first task)
**Files:**
- Modify: `extensions/agentic-harness/index.ts:1-540`

- [ ] **Step 1: Replace the entire file with the new skeleton**

Replace the full contents of `extensions/agentic-harness/index.ts` with:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { homedir } from "os";
import { join } from "path";

// ============================================================
// Workflow State
// ============================================================
// Tracks which phase the agent is in so before_agent_start
// can inject appropriate guidance into the system prompt.
// ============================================================

type WorkflowPhase =
  | "idle"
  | "clarifying"
  | "planning"
  | "ultraplanning";

let currentPhase: WorkflowPhase = "idle";

export default function (pi: ExtensionAPI) {
  // Tools, commands, and event handlers will be added in subsequent tasks.
}
```

- [ ] **Step 2: Run type check to verify the skeleton compiles**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors (clean compile)

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "refactor: strip hardcoded templates, add workflow state skeleton"
```

---

## Task 2: Register `ask_user_question` Tool with TypeBox Schema

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add the tool registration inside the default export function**

Insert the following inside the `export default function (pi: ExtensionAPI) {` body, after the opening brace:

```typescript
  // ============================================================
  // ask_user_question Tool
  // ============================================================
  // The agent calls this autonomously when it encounters ambiguity.
  // The agent generates the question text and choices dynamically.
  // ============================================================

  const DIRECT_INPUT_OPTION = "직접 입력하기";

  const AskUserQuestionParams = Type.Object({
    question: Type.String({
      description: "The question to ask the user. The agent generates this dynamically based on context.",
    }),
    choices: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Multiple choice options generated by the agent. '직접 입력하기' is auto-appended. Omit for free-text input.",
      })
    ),
    placeholder: Type.Optional(
      Type.String({
        description: "Placeholder hint for free-text input mode.",
      })
    ),
    defaultValue: Type.Optional(
      Type.String({
        description: "Default value if user presses Enter without typing.",
      })
    ),
  });

  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description:
      "Ask the user a question when the agent needs clarification. The agent composes the question and optional choices dynamically. Returns the user's answer as text.",
    promptSnippet:
      "Ask the user a clarifying question with optional multiple-choice answers",
    promptGuidelines: [
      "Use ask_user_question whenever you encounter ambiguity, unclear scope, or need user preference.",
      "Generate the question and choices yourself based on the current context — do not rely on predefined templates.",
      "Offer concrete choices (A/B/C style) when the options are enumerable. Omit choices for open-ended questions.",
      "Ask one focused question at a time. Do not bundle multiple questions.",
      "After receiving an answer, decide whether further clarification is needed or proceed with the task.",
    ],
    parameters: AskUserQuestionParams,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const { question, choices, placeholder, defaultValue } = params;

      let answer: string | undefined;

      if (choices && choices.length > 0) {
        const withDirect = choices.includes(DIRECT_INPUT_OPTION)
          ? choices
          : [...choices, DIRECT_INPUT_OPTION];

        answer = await ctx.ui.select(question, withDirect, { signal });

        if (answer === DIRECT_INPUT_OPTION) {
          answer = await ctx.ui.input(question, placeholder || defaultValue, {
            signal,
          });
        }
      } else {
        answer = await ctx.ui.input(question, placeholder || defaultValue, {
          signal,
        });
      }

      if (answer === undefined) {
        return {
          content: [{ type: "text", text: "User cancelled the question." }],
        };
      }

      return {
        content: [{ type: "text", text: answer }],
      };
    },
  });
```

- [ ] **Step 2: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "feat: register ask_user_question tool with TypeBox schema and promptGuidelines"
```

---

## Task 3: Add `resources_discover` and `before_agent_start` Event Handlers

**Dependencies:** Runs after Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add `resources_discover` handler after the tool registration block**

Insert the following after the `pi.registerTool({ ... });` block:

```typescript
  // ============================================================
  // resources_discover: Register engineering-discipline skills
  // ============================================================

  const SKILLS_DIR = join(homedir(), "engineering-discipline", "skills");

  pi.on("resources_discover", async (_event, _ctx) => {
    return {
      skillPaths: [SKILLS_DIR],
    };
  });
```

- [ ] **Step 2: Add `before_agent_start` handler for workflow state injection**

Insert immediately after the `resources_discover` handler:

```typescript
  // ============================================================
  // before_agent_start: Inject workflow phase guidance
  // ============================================================

  const PHASE_GUIDANCE: Record<WorkflowPhase, string> = {
    idle: "",
    clarifying: [
      "\n\n## Active Workflow: Clarification",
      "You are in clarification mode. Follow the clarification skill rules strictly:",
      "- Ask ONE question per message using the ask_user_question tool.",
      "- Generate questions and choices dynamically based on context — no predefined templates.",
      "- Dispatch Explore subagents in parallel to investigate the codebase.",
      "- After each answer, update 'what we've established so far' and assess remaining ambiguity.",
      "- When ambiguity is resolved, present a Context Brief with Complexity Assessment.",
      "- Do NOT start implementation. This phase ends with a Context Brief, not code.",
    ].join("\n"),
    planning: [
      "\n\n## Active Workflow: Plan Crafting",
      "You are in plan-crafting mode. Follow the plan-crafting skill rules strictly:",
      "- Write an executable implementation plan from the current context.",
      "- Every step must be executable — no placeholders.",
      "- Use ask_user_question if you need to resolve any remaining ambiguity.",
      "- End with a Self-Review before presenting the plan.",
    ].join("\n"),
    ultraplanning: [
      "\n\n## Active Workflow: Milestone Planning (Ultraplan)",
      "You are in milestone-planning mode. Follow the milestone-planning skill rules strictly:",
      "- Compose a Problem Brief from the current context.",
      "- Decide which reviewer perspectives are needed based on the problem (not a fixed set).",
      "- Dispatch all reviewers in parallel.",
      "- Synthesize findings into a milestone DAG.",
      "- Use ask_user_question if you need user input on trade-offs.",
    ].join("\n"),
  };

  pi.on("before_agent_start", async (event, _ctx) => {
    const guidance = PHASE_GUIDANCE[currentPhase];
    if (!guidance) return;
    return {
      systemPrompt: event.systemPrompt + guidance,
    };
  });
```

- [ ] **Step 3: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "feat: add resources_discover and before_agent_start event handlers"
```

---

## Task 4: Rewrite `/clarify` Command

**Dependencies:** Runs after Task 3 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add the `/clarify` command after the event handlers**

Insert the following after the `before_agent_start` handler:

```typescript
  // ============================================================
  // Commands
  // ============================================================

  pi.registerCommand("clarify", {
    description:
      "Start clarification — the agent asks dynamic questions to resolve ambiguity",
    handler: async (args, ctx) => {
      const topic = args?.trim() || "";
      const start = await ctx.ui.confirm(
        "Start Clarification",
        "The agent will ask you questions one at a time to clarify your request.\nIt will also explore the codebase in parallel.\n\nProceed?"
      );
      if (!start) return;

      currentPhase = "clarifying";
      ctx.ui.setStatus("harness", "Clarification in progress...");

      const prompt = topic
        ? `The user wants to clarify the following request: "${topic}"\n\nBegin the clarification process. Follow the clarification skill rules. Ask ONE question using the ask_user_question tool. Dispatch an Explore subagent in parallel to investigate relevant parts of the codebase.`
        : `The user wants to start a clarification session for their current task.\n\nBegin the clarification process. Follow the clarification skill rules. Ask ONE question using the ask_user_question tool to understand what the user wants to accomplish. Dispatch an Explore subagent in parallel to investigate the codebase.`;

      pi.sendUserMessage(prompt);

      // Phase will be reset to "idle" when the agent presents a Context Brief
      // or the user starts a different command. For now, it stays "clarifying"
      // so before_agent_start keeps injecting clarification guidance.
    },
  });
```

- [ ] **Step 2: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "feat: rewrite /clarify command to delegate to agent"
```

---

## Task 5: Rewrite `/plan` Command

**Dependencies:** Runs after Task 4 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add the `/plan` command after `/clarify`**

Insert immediately after the `/clarify` `registerCommand` block:

```typescript
  pi.registerCommand("plan", {
    description:
      "Generate an implementation plan — the agent follows plan-crafting skill rules",
    handler: async (args, ctx) => {
      const ok = await ctx.ui.confirm(
        "Start Plan Crafting",
        "The agent will create an executable implementation plan based on current context.\n\nProceed?"
      );
      if (!ok) return;

      currentPhase = "planning";
      ctx.ui.setStatus("harness", "Plan crafting in progress...");

      const topic = args?.trim() || "";
      const prompt = topic
        ? `Create an executable implementation plan for: "${topic}"\n\nFollow the plan-crafting skill rules. If a Context Brief exists from a previous clarification, use it as input. If not, use the ask_user_question tool to confirm goal, scope, and tech stack before writing the plan.`
        : `Create an executable implementation plan for the current task.\n\nFollow the plan-crafting skill rules. If a Context Brief exists from a previous clarification, use it as input. If not, use the ask_user_question tool to confirm goal, scope, and tech stack before writing the plan.`;

      pi.sendUserMessage(prompt);
    },
  });
```

- [ ] **Step 2: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "feat: rewrite /plan command to delegate to agent"
```

---

## Task 6: Rewrite `/ultraplan` Command

**Dependencies:** Runs after Task 5 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add the `/ultraplan` command after `/plan`**

Insert immediately after the `/plan` `registerCommand` block:

```typescript
  pi.registerCommand("ultraplan", {
    description:
      "Decompose a complex task into milestones — the agent dynamically selects reviewers",
    handler: async (args, ctx) => {
      const confirmed = await ctx.ui.confirm(
        "Start Milestone Planning (Ultraplan)",
        "The agent will:\n1. Compose a Problem Brief\n2. Decide which reviewer perspectives are needed\n3. Dispatch reviewers in parallel\n4. Synthesize a milestone DAG\n\nProceed?"
      );
      if (!confirmed) return;

      currentPhase = "ultraplanning";
      ctx.ui.setStatus("harness", "Milestone planning in progress...");

      const topic = args?.trim() || "";
      const prompt = topic
        ? `Decompose the following complex task into milestones: "${topic}"\n\nFollow the milestone-planning skill rules. First compose a Problem Brief. Then decide which reviewer perspectives are needed for this specific problem (e.g., feasibility, architecture, risk, dependencies, user value — but adapt to the problem). Dispatch all chosen reviewers in parallel using the Agent tool. After all reviewers complete, synthesize their findings into a milestone DAG.`
        : `Decompose the current complex task into milestones.\n\nFollow the milestone-planning skill rules. First compose a Problem Brief from the current context. Then decide which reviewer perspectives are needed for this specific problem. Dispatch all chosen reviewers in parallel using the Agent tool. After all reviewers complete, synthesize their findings into a milestone DAG.`;

      pi.sendUserMessage(prompt);
    },
  });
```

- [ ] **Step 2: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "feat: rewrite /ultraplan command for dynamic reviewer selection"
```

---

## Task 7: Add `/ask` Command, `session_start`, and Phase Reset Logic

**Dependencies:** Runs after Task 6 completes
**Files:**
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add `/ask` command, session_start handler, and phase reset**

Insert after the `/ultraplan` `registerCommand` block:

```typescript
  // ============================================================
  // /ask — manual test command for ask_user_question
  // ============================================================

  pi.registerCommand("ask", {
    description: "Ask the user a question (for testing the ask_user_question tool)",
    handler: async (args, ctx) => {
      const question = await ctx.ui.input(
        "Enter a question",
        args || "What would you like to know?"
      );
      if (!question) return;

      const choicesStr = await ctx.ui.input(
        "Enter comma-separated choices (leave empty for free text)",
        ""
      );
      const choices = choicesStr
        ? choicesStr.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      let answer: string | undefined;
      if (choices && choices.length > 0) {
        answer = await ctx.ui.select(question, choices);
      } else {
        answer = await ctx.ui.input(question);
      }

      if (answer !== undefined) {
        ctx.ui.notify(`Answer: ${answer}`, "info");
      }
    },
  });

  // ============================================================
  // /reset-phase — reset workflow phase to idle
  // ============================================================

  pi.registerCommand("reset-phase", {
    description: "Reset the workflow phase to idle (clears clarify/plan/ultraplan mode)",
    handler: async (_args, ctx) => {
      currentPhase = "idle";
      ctx.ui.setStatus("harness", undefined);
      ctx.ui.notify("Workflow phase reset to idle.", "info");
    },
  });

  // ============================================================
  // Session start notification
  // ============================================================

  pi.on("session_start", async (_event, ctx) => {
    currentPhase = "idle";
    ctx.ui.notify(
      "Agentic Harness loaded: /clarify, /plan, /ultraplan, /ask, /reset-phase",
      "info"
    );
  });

} // end of default export
```

- [ ] **Step 2: Remove the duplicate closing brace if present**

The file should end with a single `}` closing the `export default function`. Verify the file structure is correct.

- [ ] **Step 3: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts
git commit -m "feat: add /ask, /reset-phase commands and session_start handler"
```

---

## Task 8: Update Tests

**Dependencies:** Runs after Task 7 completes
**Files:**
- Modify: `extensions/agentic-harness/tests/ultraplan.test.ts`
- Create: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Rewrite `ultraplan.test.ts`**

Replace the full contents of `extensions/agentic-harness/tests/ultraplan.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import extension from "../index.js";

describe("Ultraplan Command", () => {
  it("should register ultraplan command and send delegation prompt", async () => {
    const commands = new Map<string, any>();

    const mockPi: any = {
      registerTool: vi.fn(),
      registerCommand: (name: string, def: any) => {
        commands.set(name, def);
      },
      on: vi.fn(),
      sendUserMessage: vi.fn(),
    };

    extension(mockPi);

    const ultraplan = commands.get("ultraplan");
    expect(ultraplan).toBeDefined();
    expect(ultraplan.description).toContain("milestone");

    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    };

    await ultraplan.handler("", mockCtx);

    // Should delegate to agent via sendUserMessage
    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("milestone-planning");
    expect(prompt).toContain("reviewer");
  });

  it("should not proceed if user cancels confirmation", async () => {
    const commands = new Map<string, any>();

    const mockPi: any = {
      registerTool: vi.fn(),
      registerCommand: (name: string, def: any) => {
        commands.set(name, def);
      },
      on: vi.fn(),
      sendUserMessage: vi.fn(),
    };

    extension(mockPi);

    const ultraplan = commands.get("ultraplan");
    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(false),
        setStatus: vi.fn(),
      },
    };

    await ultraplan.handler("", mockCtx);
    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Create `extension.test.ts`**

Create `extensions/agentic-harness/tests/extension.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import extension from "../index.js";

function createMockPi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const events = new Map<string, any[]>();

  const mockPi: any = {
    registerTool: (def: any) => {
      tools.set(def.name, def);
    },
    registerCommand: (name: string, def: any) => {
      commands.set(name, def);
    },
    on: (event: string, handler: any) => {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
    },
    sendUserMessage: vi.fn(),
  };

  return { mockPi, tools, commands, events };
}

describe("Extension Registration", () => {
  it("should register ask_user_question tool", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("ask_user_question");
    expect(tool).toBeDefined();
    expect(tool.promptSnippet).toBeDefined();
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines.length).toBeGreaterThan(0);
  });

  it("should register all commands", () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);

    expect(commands.has("clarify")).toBe(true);
    expect(commands.has("plan")).toBe(true);
    expect(commands.has("ultraplan")).toBe(true);
    expect(commands.has("ask")).toBe(true);
    expect(commands.has("reset-phase")).toBe(true);
  });

  it("should register event handlers", () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    expect(events.has("resources_discover")).toBe(true);
    expect(events.has("before_agent_start")).toBe(true);
    expect(events.has("session_start")).toBe(true);
  });
});

describe("ask_user_question Tool", () => {
  it("should return user answer for free-text input", async () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("ask_user_question");
    const mockCtx: any = {
      ui: {
        input: vi.fn().mockResolvedValue("user typed this"),
        select: vi.fn(),
      },
    };

    const result = await tool.execute(
      "call-1",
      { question: "What do you want?" },
      undefined,
      undefined,
      mockCtx
    );

    expect(result.content[0].text).toBe("user typed this");
    expect(mockCtx.ui.input).toHaveBeenCalledWith(
      "What do you want?",
      undefined,
      { signal: undefined }
    );
  });

  it("should use select UI when choices are provided", async () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("ask_user_question");
    const mockCtx: any = {
      ui: {
        input: vi.fn(),
        select: vi.fn().mockResolvedValue("Option A"),
      },
    };

    const result = await tool.execute(
      "call-2",
      { question: "Pick one", choices: ["Option A", "Option B"] },
      undefined,
      undefined,
      mockCtx
    );

    expect(result.content[0].text).toBe("Option A");
    // Should auto-append "직접 입력하기"
    const selectChoices = mockCtx.ui.select.mock.calls[0][1];
    expect(selectChoices).toContain("직접 입력하기");
  });

  it("should switch to input when 직접 입력하기 is selected", async () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("ask_user_question");
    const mockCtx: any = {
      ui: {
        input: vi.fn().mockResolvedValue("custom answer"),
        select: vi.fn().mockResolvedValue("직접 입력하기"),
      },
    };

    const result = await tool.execute(
      "call-3",
      { question: "Pick one", choices: ["A", "B"] },
      undefined,
      undefined,
      mockCtx
    );

    expect(result.content[0].text).toBe("custom answer");
    expect(mockCtx.ui.input).toHaveBeenCalled();
  });

  it("should handle user cancellation", async () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("ask_user_question");
    const mockCtx: any = {
      ui: {
        input: vi.fn().mockResolvedValue(undefined),
        select: vi.fn(),
      },
    };

    const result = await tool.execute(
      "call-4",
      { question: "Will you cancel?" },
      undefined,
      undefined,
      mockCtx
    );

    expect(result.content[0].text).toBe("User cancelled the question.");
  });
});

describe("before_agent_start Event", () => {
  it("should not modify system prompt when phase is idle", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const handlers = events.get("before_agent_start")!;
    const result = await handlers[0](
      { type: "before_agent_start", prompt: "test", systemPrompt: "base" },
      {} as any
    );

    // idle phase returns no guidance (undefined or empty systemPrompt addition)
    expect(result?.systemPrompt || "base").toBe("base");
  });
});

describe("/clarify Command", () => {
  it("should delegate to agent via sendUserMessage", async () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);

    const clarify = commands.get("clarify");
    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    };

    await clarify.handler("login feature", mockCtx);

    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("login feature");
    expect(prompt).toContain("clarification");
    expect(prompt).toContain("ask_user_question");
  });
});

describe("/plan Command", () => {
  it("should delegate to agent via sendUserMessage", async () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);

    const plan = commands.get("plan");
    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    };

    await plan.handler("", mockCtx);

    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("plan-crafting");
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `cd extensions/agentic-harness && npm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/tests/ultraplan.test.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "test: update ultraplan tests and add comprehensive extension tests"
```

---

## Task 9 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `cd extensions/agentic-harness && npm test`
Expected: ALL PASS

- [ ] **Step 2: Run type check**

Run: `cd extensions/agentic-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify no hardcoded templates remain**

Run: `grep -n "ChoiceTemplates\|QuestionTemplates\|clarificationQuestions\|ClarificationState\|generateContextBrief" extensions/agentic-harness/index.ts`
Expected: No matches (all hardcoded code removed)

- [ ] **Step 4: Verify plan success criteria**

Manually check each success criterion:
- [ ] `ask_user_question` tool is registered with TypeBox schema (`Type.Object`) — not `@ts-ignore` plain object
- [ ] `promptGuidelines` array has 5+ guidelines guiding autonomous agent use
- [ ] No hardcoded templates/categories exist anywhere in `index.ts`
- [ ] `/clarify` delegates to agent via `sendUserMessage` (no hardcoded Q&A loop)
- [ ] `/ultraplan` delegates to agent (no fixed 5-reviewer structure)
- [ ] `resources_discover` event handler registers `~/engineering-discipline/skills/` path
- [ ] `before_agent_start` event handler injects phase-specific guidance
- [ ] `/reset-phase` command exists to manually exit workflow phases

- [ ] **Step 5: Verify file is clean and well-structured**

Run: `wc -l extensions/agentic-harness/index.ts`
Expected: ~200-250 lines (significantly reduced from original 540 lines)

---

## Self-Review Checklist

- [x] All tasks have exact file paths
- [x] All steps contain executable code/commands
- [x] No file conflicts between parallel tasks (all tasks on index.ts are sequential)
- [x] Dependency chains accurately stated (Task 1→2→3→4→5→6→7→8→9)
- [x] Plan covers all Context Brief requirements (tool, commands, events, tests)
- [x] No placeholders — all code is complete
- [x] Verification Strategy defined (vitest, `npm test`)
- [x] Final Verification Task is Task 9
