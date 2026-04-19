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

  it("should NOT register ask_user_question tool in subagent context", () => {
    const prevDepth = process.env.PI_SUBAGENT_DEPTH;
    process.env.PI_SUBAGENT_DEPTH = "1";
    try {
      const { mockPi, tools } = createMockPi();
      extension(mockPi);

      expect(tools.get("ask_user_question")).toBeUndefined();
    } finally {
      if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
      else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    }
  });

  it("should register subagent tool", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("subagent");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("subagent");
    expect(tool.promptSnippet).toBeDefined();
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines.length).toBe(8);
    expect(tool.renderCall).toBeTypeOf("function");
    expect(tool.renderResult).toBeTypeOf("function");
  });

  it("should register all root-session commands", () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);

    expect(commands.has("clarify")).toBe(true);
    expect(commands.has("plan")).toBe(true);
    expect(commands.has("ultraplan")).toBe(true);
    expect(commands.has("ask")).toBe(true);
    expect(commands.has("reset-phase")).toBe(true);
  });

  it("should NOT register ask command in subagent context", () => {
    const prevDepth = process.env.PI_SUBAGENT_DEPTH;
    process.env.PI_SUBAGENT_DEPTH = "1";
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);

      expect(commands.has("ask")).toBe(false);
      expect(commands.has("clarify")).toBe(true);
      expect(commands.has("plan")).toBe(true);
      expect(commands.has("ultraplan")).toBe(true);
    } finally {
      if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
      else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    }
  });

  it("should register event handlers", () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    expect(events.has("resources_discover")).toBe(true);
    expect(events.has("before_agent_start")).toBe(true);
    expect(events.has("session_start")).toBe(true);
    expect(events.has("context")).toBe(true);
    expect(events.has("session_before_compact")).toBe(true);
    expect(events.has("session_compact")).toBe(true);
    expect(events.has("tool_result")).toBe(true);
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
  it("should inject delegation guards even when phase is idle", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const handlers = events.get("before_agent_start")!;
    const result = await handlers[0](
      { type: "before_agent_start", prompt: "test", systemPrompt: "base" },
      { cwd: "." } as any
    );

    // idle phase has no guidance text, but delegation guards are still injected
    expect(result?.systemPrompt).toContain("base");
    expect(result?.systemPrompt).toContain("## Delegation Guards");
    expect(result?.systemPrompt).toContain("## Available Subagents");
  });

  it("should avoid ask_user_question guidance in subagent planning context", async () => {
    const prevDepth = process.env.PI_SUBAGENT_DEPTH;
    process.env.PI_SUBAGENT_DEPTH = "1";
    try {
      const { mockPi, events, commands } = createMockPi();
      extension(mockPi);

      const plan = commands.get("plan");
      await plan.handler("", {
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
          setStatus: vi.fn(),
        },
      } as any);

      const handlers = events.get("before_agent_start")!;
      const result = await handlers[0](
        { type: "before_agent_start", prompt: "test", systemPrompt: "base" },
        { cwd: "." } as any
      );

      // Subagents never receive phase guidance (subagent guard). So the planning
      // workflow text is suppressed entirely, and in particular ask_user_question
      // guidance does not leak into subagent turns.
      expect(result?.systemPrompt).not.toContain("Active Workflow: Plan Crafting");
      expect(result?.systemPrompt).not.toContain("ask_user_question");
    } finally {
      if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
      else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    }
  });

  it("should inject review workflow guidance after /review", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    const review = commands.get("review");
    await review.handler("123", {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    } as any);

    const handlers = events.get("before_agent_start")!;
    const result = await handlers[0](
      { type: "before_agent_start", prompt: "test", systemPrompt: "base" },
      { cwd: "." } as any
    );

    expect(result?.systemPrompt).toContain("Active Workflow: Code Review (/review)");
    expect(result?.systemPrompt).toContain("Do NOT dispatch subagents");
  });

  it("should NOT inject phase guidance in subagent context, but should still inject delegation guards", async () => {
    const prevDepth = process.env.PI_SUBAGENT_DEPTH;
    process.env.PI_SUBAGENT_DEPTH = "1";
    try {
      const { mockPi, events, commands } = createMockPi();
      extension(mockPi);

      // Root would normally set phase via /plan; inside a subagent the /plan command is not registered,
      // but we simulate the scenario where a subagent process inherits a phase from a (now-removed) global store.
      // Because phase state is now in-memory-only and subagents start idle, this test also verifies the default
      // behaviour: idle subagents never get phase guidance text.
      const handlers = events.get("before_agent_start")!;
      const result = await handlers[0](
        { type: "before_agent_start", prompt: "do the task", systemPrompt: "base" },
        { cwd: "." } as any
      );

      expect(result?.systemPrompt).toContain("base");
      expect(result?.systemPrompt).not.toContain("Active Workflow:");
      // Delegation guards depend on depthConfig.canDelegate. At depth=1 (< default max 3) delegation is still allowed,
      // so the guards section still appears.
      expect(result?.systemPrompt).toContain("## Delegation Guards");
    } finally {
      if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
      else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    }
  });

  it("should suppress phase guidance when user prompt is a skill/command invocation", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    // Put the root session in ultraplanning phase via the /ultraplan command.
    const ultraplan = commands.get("ultraplan");
    await ultraplan.handler("test topic", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const handlers = events.get("before_agent_start")!;

    // Case A: a normal user turn — phase guidance is injected as before.
    const normal = await handlers[0](
      { type: "before_agent_start", prompt: "keep working on the milestones", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(normal?.systemPrompt).toContain("Active Workflow: Milestone Planning (Ultraplan)");

    // Case B: the user invokes a skill via the claude-code-style <command-name> tag.
    // Phase guidance must NOT be injected for this turn.
    const skillPrompt = [
      "<command-message>systematic-debugging</command-message>",
      "<command-name>/systematic-debugging</command-name>",
      "<command-args>fix this bug</command-args>",
    ].join("\n");
    const skillTurn = await handlers[0](
      { type: "before_agent_start", prompt: skillPrompt, systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(skillTurn?.systemPrompt).not.toContain("Active Workflow: Milestone Planning (Ultraplan)");

    // Case C: a raw "[skill] foo" marker also suppresses guidance.
    const bracketTurn = await handlers[0](
      { type: "before_agent_start", prompt: "[skill] some-skill\n\nfix this", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(bracketTurn?.systemPrompt).not.toContain("Active Workflow: Milestone Planning (Ultraplan)");
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
    expect(prompt).toContain("agentic-clarification");
    expect(prompt).toContain("ask_user_question");
    expect(prompt).toContain("subagent");
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
    expect(prompt).toContain("agentic-plan-crafting");
  });
});

describe("/ask Command", () => {
  it("should register /ask and delegate a manual ask_user_question prompt", async () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);

    const ask = commands.get("ask");
    expect(ask).toBeDefined();

    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    };

    await ask.handler("What should I work on next?", mockCtx);

    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("ask_user_question");
    expect(prompt).toContain("What should I work on next?");
  });
});

describe("Goal Document Tracking", () => {
  it("should register tool_result event handler", () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    expect(events.has("tool_result")).toBe(true);
    expect(events.get("tool_result")!.length).toBeGreaterThan(0);
  });
});

describe("Validator Information Barrier", () => {
  it("should register planFile and planTaskId in subagent params", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const subagentTool = tools.get("subagent");
    expect(subagentTool).toBeDefined();
    const schema = subagentTool!.parameters;
    // Verify schema has planFile and planTaskId properties
    expect(schema.properties.planFile).toBeDefined();
    expect(schema.properties.planTaskId).toBeDefined();
  });

  it("should include plan-validator guideline in promptGuidelines", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const subagentTool = tools.get("subagent");
    expect(subagentTool).toBeDefined();
    const guidelines = subagentTool!.promptGuidelines || [];
    expect(guidelines.some((g: string) => g.includes("planFile") && g.includes("planTaskId"))).toBe(true);
  });
});

describe("webfetch Tool", () => {
  it("should register webfetch tool", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("webfetch");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("webfetch");
    expect(tool.promptSnippet).toBeDefined();
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines.length).toBeGreaterThan(0);
    expect(tool.renderCall).toBeTypeOf("function");
    expect(tool.renderResult).toBeTypeOf("function");
  });

  it("should have url as required parameter in schema", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("webfetch");
    const schema = tool.parameters;
    expect(schema.properties.url).toBeDefined();
    expect(schema.properties.raw).toBeDefined();
    expect(schema.properties.maxLength).toBeDefined();
    expect(schema.required).toContain("url");
  });
});;

describe("tool_result Phase Auto-Reset", () => {
  it("should reset currentPhase to idle when the phase's terminal artifact is written", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    // Put root session into 'planning' phase via /plan.
    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const beforeHandlers = events.get("before_agent_start")!;
    const before = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "continue planning", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(before?.systemPrompt).toContain("Active Workflow: Plan Crafting");

    // Simulate a write to the planning terminal directory.
    const toolHandlers = events.get("tool_result")!;
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "write",
        input: { path: "docs/engineering-discipline/plans/2026-04-19-foo.md" },
      } as any,
      { cwd: "." } as any
    );

    // Next turn must no longer see phase guidance, because phase was reset to idle.
    const after = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "anything", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(after?.systemPrompt).not.toContain("Active Workflow: Plan Crafting");
  });

  it("should NOT reset phase when a write targets a different phase's directory", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const toolHandlers = events.get("tool_result")!;
    // Writing a review doc while in planning phase must NOT reset planning.
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "write",
        input: { path: "docs/engineering-discipline/reviews/2026-04-19-bar.md" },
      } as any,
      { cwd: "." } as any
    );

    const beforeHandlers = events.get("before_agent_start")!;
    const after = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "anything", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(after?.systemPrompt).toContain("Active Workflow: Plan Crafting");
  });

  it("should NOT reset phase on edit — only on write (first creation)", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const toolHandlers = events.get("tool_result")!;
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "edit",
        input: { path: "docs/engineering-discipline/plans/2026-04-19-foo.md" },
      } as any,
      { cwd: "." } as any
    );

    const beforeHandlers = events.get("before_agent_start")!;
    const after = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "anything", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(after?.systemPrompt).toContain("Active Workflow: Plan Crafting");
  });

  it("should also clear activeGoalDocument on auto-reset (symmetric with /reset-phase)", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    // Fire the terminal-artifact write. Auto-reset must clear BOTH currentPhase
    // AND activeGoalDocument; otherwise session_before_compact's early-return
    // gate (`phase === "idle" && !activeGoalDocument`) stays open because the
    // stale goal-doc pointer lingers, and custom compaction runs unnecessarily.
    const toolHandlers = events.get("tool_result")!;
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "write",
        input: { path: "docs/engineering-discipline/plans/2026-04-19-foo.md" },
      } as any,
      { cwd: "." } as any
    );

    // Observable consequence: session_before_compact must short-circuit because
    // both phase and goalDoc are cleared. If goalDoc lingered, the handler would
    // fall through and call ctx.ui.notify with the "Custom compaction..." message.
    const notify = vi.fn();
    const compactBefore = events.get("session_before_compact")!;
    const result = await compactBefore[0](
      {
        type: "session_before_compact",
        preparation: {
          messagesToSummarize: [{ role: "user", content: [], timestamp: 0 }],
          turnPrefixMessages: [],
          tokensBefore: 100,
          firstKeptEntryId: "x",
          previousSummary: null,
        },
        signal: new AbortController().signal,
        customInstructions: undefined,
      } as any,
      {
        ui: { notify },
        model: { name: "test" },
        modelRegistry: {
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false }),
        },
      } as any
    );

    expect(result).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("No Global State File", () => {
  it("extension must not import loadState/updateState from the state module", async () => {
    // Source-level contract: the extension body is not allowed to reference the
    // removed persistence helpers. This guards against accidental reintroduction.
    const { readFile } = await import("fs/promises");
    const src = await readFile(new URL("../index.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/\bloadState\s*\(/);
    expect(src).not.toMatch(/\bupdateState\s*\(/);
    expect(src).not.toMatch(/extension-state\.json/);
  });

  it("session_start must not read any state file — phase always starts idle on a fresh process", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const handlers = events.get("session_start");
    if (!handlers || handlers.length === 0) return; // no-op if not registered

    // Provide a ctx with the minimum surface the handler touches.
    const headerSetters: any[] = [];
    await handlers[0]({ type: "session_start" } as any, {
      cwd: ".",
      ui: {
        setHeader: (fn: any) => headerSetters.push(fn),
        setFooter: vi.fn(),
        notify: vi.fn(),
      },
      model: { name: "test" },
      getContextUsage: () => undefined,
    } as any);

    // Immediately after session_start, phase must be idle (no inheritance from disk).
    const beforeHandlers = events.get("before_agent_start")!;
    const result = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "hello", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(result?.systemPrompt).not.toContain("Active Workflow:");
  });
});
