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
    expect(prompt).toContain("subagent");
    expect(prompt).toContain("Feasibility");
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
