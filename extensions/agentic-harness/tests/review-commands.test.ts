import { describe, it, expect, vi } from "vitest";
import extension from "../index.js";

function setupMockPi() {
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
  return { mockPi, commands };
}

function makeCtx(confirmResult = true) {
  return {
    ui: {
      confirm: vi.fn().mockResolvedValue(confirmResult),
      setStatus: vi.fn(),
      notify: vi.fn(),
    },
  } as any;
}

describe("Review Command (/review)", () => {
  it("should register the review command with a descriptive label", () => {
    const { commands } = setupMockPi();
    const review = commands.get("review");
    expect(review).toBeDefined();
    expect(review.description).toMatch(/code review/i);
  });

  it("should dispatch a single-pass prompt without confirmation", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");
    const ctx = makeCtx();

    await review.handler("", ctx);

    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("expert code reviewer");
    expect(prompt).toContain("single-pass");
    expect(prompt).toContain("Bugs");
    expect(prompt).toContain("Security");
    expect(prompt).toContain("Performance");
    expect(prompt).toContain("Test coverage");
    expect(prompt).toContain("Consistency");
    // /review is single-pass: it must NOT instruct the agent to use parallel mode or fleet
    expect(prompt).not.toContain("parallel mode");
    expect(prompt).not.toContain("10 subagents");
    expect(prompt).not.toContain("Stage 1");
  });

  it("should auto-detect the target when no argument is provided", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");
    await review.handler("", makeCtx());
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("auto-detect");
    expect(prompt).toContain("gh pr list");
  });

  it("should embed the explicit target when an argument is provided", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");
    await review.handler("123", makeCtx());
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain('"123"');
    expect(prompt).toContain("gh pr diff 123");
  });

  it("should accept branch names with slash, dot, dash, underscore", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");
    await review.handler("feature/foo-bar_1.2", makeCtx());
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain('"feature/foo-bar_1.2"');
  });

  it("should accept a full GitHub PR URL and pass it to gh pr diff", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");
    const url = "https://github.com/tmdgusya/roach-pi/pull/27";
    await review.handler(url, makeCtx());
    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain(`"${url}"`);
    expect(prompt).toContain(`gh pr diff ${url}`);
    // The prompt should tell the LLM that a URL is a valid PR reference form
    expect(prompt).toContain("PR URL");
  });

  it("should reject shell metacharacters and notify error", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");
    const ctx = makeCtx();

    await review.handler("123; rm -rf /", ctx);

    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(message).toContain("Invalid review target");
    expect(level).toBe("error");
  });

  it("should reject backticks, dollar signs, and pipes", async () => {
    const { mockPi, commands } = setupMockPi();
    const review = commands.get("review");

    for (const bad of ["`whoami`", "$(whoami)", "a|b", "a&b", "a>b"]) {
      const ctx = makeCtx();
      await review.handler(bad, ctx);
      expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalled();
    }
  });
});

describe("Ultrareview Command (/ultrareview)", () => {
  it("should register the ultrareview command", () => {
    const { commands } = setupMockPi();
    const ultra = commands.get("ultrareview");
    expect(ultra).toBeDefined();
    expect(ultra.description).toMatch(/multi-agent/i);
  });

  it("should not proceed when user cancels confirmation", async () => {
    const { mockPi, commands } = setupMockPi();
    const ultra = commands.get("ultrareview");
    const ctx = makeCtx(false);

    await ultra.handler("", ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("should dispatch a 3-stage pipeline prompt on confirmation", async () => {
    const { mockPi, commands } = setupMockPi();
    const ultra = commands.get("ultrareview");
    const ctx = makeCtx(true);

    await ultra.handler("", ctx);

    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];

    // Stage headers
    expect(prompt).toContain("Stage 1: Finding");
    expect(prompt).toContain("Stage 2: Verification");
    expect(prompt).toContain("Stage 3: Synthesis");

    // All 5 reviewer roles referenced
    expect(prompt).toContain("reviewer-bug");
    expect(prompt).toContain("reviewer-security");
    expect(prompt).toContain("reviewer-performance");
    expect(prompt).toContain("reviewer-test-coverage");
    expect(prompt).toContain("reviewer-consistency");

    // Verifier and synthesis
    expect(prompt).toContain("reviewer-verifier");
    expect(prompt).toContain("review-synthesis");

    // Fleet sizing
    expect(prompt).toContain("10 subagents");
    expect(prompt).toContain("seed 1");
    expect(prompt).toContain("seed 2");

    // Shared diff artifact + file output convention
    expect(prompt).toContain("shared artifact");
    expect(prompt).toContain(".tmp/<date>-<topic>.diff");
    expect(prompt).not.toContain("The full diff text (inline)");
    expect(prompt).toContain("docs/engineering-discipline/reviews/");

    // ai-slop-cleaner isolation guard
    expect(prompt).toContain("worker");
    expect(prompt).toMatch(/NEVER dispatch any agent whose name contains "worker"/);
  });

  it("should include a PR-mode target clause when argument is numeric", async () => {
    const { mockPi, commands } = setupMockPi();
    const ultra = commands.get("ultrareview");
    await ultra.handler("456", makeCtx(true));
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain('"456"');
    expect(prompt).toContain("gh pr diff 456");
  });

  it("should reject shell metacharacters before showing confirmation", async () => {
    const { mockPi, commands } = setupMockPi();
    const ultra = commands.get("ultrareview");
    const ctx = makeCtx(true);

    await ultra.handler("123; rm -rf /", ctx);

    // Must reject BEFORE confirm is shown (fail-fast, don't even prompt user)
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const [message, level] = ctx.ui.notify.mock.calls[0];
    expect(message).toContain("Invalid review target");
    expect(level).toBe("error");
  });
});
