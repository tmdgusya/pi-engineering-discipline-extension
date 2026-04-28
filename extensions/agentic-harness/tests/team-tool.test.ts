import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamRunSummary } from "../team.js";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createBashTool: vi.fn(() => ({
    name: "bash",
    label: "bash",
    description: "mock bash",
    parameters: {},
    execute: vi.fn(),
  })),
  isToolCallEventType: (toolName: string, event: any) => event?.toolName === toolName,
  keyHint: (k: string, d?: string) => `${k}${d ? ` ${d}` : ""}`,
  keyText: (t: string) => t,
  rawKeyHint: (k: string, d?: string) => `${k}${d ? ` ${d}` : ""}`,
  convertToLlm: vi.fn((x: unknown) => x),
}));

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class MockText {},
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: vi.fn(),
}));

const teamMock = vi.hoisted(() => ({
  runTeam: vi.fn(),
  formatTeamRunSummary: vi.fn((s: TeamRunSummary) => `synthesis:${s.success ? "ok" : "fail"}`),
  PI_TEAM_WORKER_ENV: "PI_TEAM_WORKER",
}));

vi.mock("../team.js", () => teamMock);

import extension from "../index.js";

const originalEnv = {
  PI_SUBAGENT_DEPTH: process.env.PI_SUBAGENT_DEPTH,
  PI_TEAM_WORKER: process.env.PI_TEAM_WORKER,
};

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_TEAM_WORKER;
  teamMock.runTeam.mockReset();
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function createMockPi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const events = new Map<string, any[]>();
  const mockPi: any = {
    registerTool: (def: any) => tools.set(def.name, def),
    registerCommand: (name: string, def: any) => commands.set(name, def),
    on: (event: string, handler: any) => {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
    },
    sendUserMessage: vi.fn(),
  };
  return { mockPi, tools, commands };
}

function makeSummary(overrides: Partial<TeamRunSummary> = {}): TeamRunSummary {
  return {
    goal: "g",
    taskCount: 1,
    completedCount: 1,
    failedCount: 0,
    blockedCount: 0,
    success: true,
    ok: true,
    backendRequested: "auto",
    backendUsed: "native",
    tasks: [],
    finalSynthesis: "done",
    verificationEvidence: { checksRun: [], passed: [], failed: [], artifactRefs: [], worktreeRefs: [], notes: [] },
    ...overrides,
  } as TeamRunSummary;
}

function makeCtx() {
  const setWorkingIndicator = vi.fn();
  return {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      select: vi.fn(),
      confirm: vi.fn(async () => true),
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWorkingIndicator,
    },
    setWorkingIndicator,
  };
}

describe("team tool wrapper", () => {
  it("returns terminate:true when runTeam succeeds", async () => {
    teamMock.runTeam.mockResolvedValueOnce(makeSummary({ success: true }));
    const { mockPi, tools } = createMockPi();
    extension(mockPi);
    const tool = tools.get("team");
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { goal: "x" }, undefined, undefined, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.terminate).toBe(true);
  });

  it("does NOT terminate when runTeam fails (LLM should react)", async () => {
    teamMock.runTeam.mockResolvedValueOnce(makeSummary({ success: false, failedCount: 1, ok: false }));
    const { mockPi, tools } = createMockPi();
    extension(mockPi);
    const tool = tools.get("team");
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { goal: "x" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.terminate).toBe(false);
  });

  it("hides the working indicator before runTeam and restores on finally", async () => {
    teamMock.runTeam.mockResolvedValueOnce(makeSummary({ success: true }));
    const { mockPi, tools } = createMockPi();
    extension(mockPi);
    const tool = tools.get("team");
    const ctx = makeCtx();
    await tool.execute("call-3", { goal: "x" }, undefined, undefined, ctx);
    const calls = ctx.ui.setWorkingIndicator.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]![0]).toEqual({ frames: [] });
    expect(calls[1]![0]).toBeUndefined();
  });

  it("restores the working indicator even when runTeam throws", async () => {
    teamMock.runTeam.mockRejectedValueOnce(new Error("boom"));
    const { mockPi, tools } = createMockPi();
    extension(mockPi);
    const tool = tools.get("team");
    const ctx = makeCtx();
    await expect(tool.execute("call-4", { goal: "x" }, undefined, undefined, ctx)).rejects.toThrow("boom");
    const calls = ctx.ui.setWorkingIndicator.mock.calls;
    expect(calls[0]![0]).toEqual({ frames: [] });
    expect(calls[1]![0]).toBeUndefined();
  });
});

describe("/team command registration", () => {
  it("registers the team slash command with getArgumentCompletions", () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);
    const cmd = commands.get("team");
    expect(cmd).toBeDefined();
    expect(typeof cmd.getArgumentCompletions).toBe("function");
    expect(typeof cmd.handler).toBe("function");
    expect(cmd.description).toMatch(/team run/);
  });

  it("rejects an empty goal via notify and does not send a message", async () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);
    const cmd = commands.get("team");
    const ctx = makeCtx();
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("requires a goal"), "error");
    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("forwards a structured prompt to pi.sendUserMessage on confirmed run", async () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);
    const cmd = commands.get("team");
    const ctx = makeCtx();
    await cmd.handler('goal="ship the API client" agent=worker backend=native', ctx);
    expect(ctx.ui.confirm).toHaveBeenCalled();
    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const sent = mockPi.sendUserMessage.mock.calls[0]![0];
    expect(sent).toContain('goal="ship the API client"');
    expect(sent).toContain('agent="worker"');
    expect(sent).toContain('backend="native"');
  });
});
