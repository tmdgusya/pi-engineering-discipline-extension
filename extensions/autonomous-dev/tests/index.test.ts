import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function createPiMock() {
  const events = new Map<string, Function>();
  return {
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      events.set(event, handler);
    }),
    __events: events,
  } as unknown as ExtensionAPI & { __events: Map<string, Function> };
}

function createCommandContext() {
  return {
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      theme: {
        fg: vi.fn((_color: string, text: string) => text),
      },
    },
  } as any;
}

describe("autonomous-dev extension command registration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    delete process.env.PI_AUTONOMOUS_DEV;
  });

  afterEach(() => {
    delete process.env.PI_AUTONOMOUS_DEV;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("formats activity paths, commands, labels, and recent timestamps compactly", async () => {
    process.env.PI_AUTONOMOUS_DEV = "1";
    vi.setSystemTime(new Date("2026-04-08T12:00:10Z"));
    const { formatActivityPath, formatActivityCommand, formatActivityLabel, formatRecentActivity } = await import("../index.js");

    expect(formatActivityPath(`${process.cwd()}/src/components/Button.tsx`)).toBe("src/components/Button.tsx");
    expect(formatActivityPath("/very/long/absolute/path/to/project/src/lib/util.ts")).toBe(".../src/lib/util.ts");
    expect(formatActivityCommand("npm   test   -- --runInBand --reporter=verbose", 28)).toBe("npm test -- --runInBand -...");
    expect(formatActivityLabel("read src/app.ts")).toBe("📖 reading src/app.ts");
    expect(formatActivityLabel("bash npm test")).toBe("🧪 running npm test");
    expect(formatRecentActivity({ text: "read src/app.ts", timestamp: "2026-04-08T12:00:05Z" })).toBe("📖 reading src/app.ts (5s ago)");
  });

  it("does not register the command when the feature flag is disabled", async () => {
    const { default: registerExtension } = await import("../index.js");
    const pi = createPiMock();

    registerExtension(pi);

    expect(pi.registerCommand).not.toHaveBeenCalled();
  });

  it("registers autonomous-dev with a string name and handler when enabled", async () => {
    process.env.PI_AUTONOMOUS_DEV = "1";
    const { default: registerExtension } = await import("../index.js");
    const pi = createPiMock();

    registerExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.__events.has("session_start")).toBe(true);
    expect(pi.__events.has("session_shutdown")).toBe(true);
    const [name, options] = (pi.registerCommand as any).mock.calls[0];
    expect(name).toBe("autonomous-dev");
    expect(options).toMatchObject({
      description: "Manage autonomous issue processing",
      handler: expect.any(Function),
    });
  });

  it("installs persistent footer status and below-editor widget on session start", async () => {
    process.env.PI_AUTONOMOUS_DEV = "1";
    const { default: registerExtension } = await import("../index.js");
    const pi = createPiMock();
    const ctx = createCommandContext();

    registerExtension(pi);

    const sessionStart = pi.__events.get("session_start");
    expect(sessionStart).toBeDefined();
    sessionStart?.({ type: "session_start" }, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalled();
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "autonomous-dev-widget",
      expect.arrayContaining([
        expect.stringContaining("Autonomous Dev Engine"),
        expect.stringContaining("Current:"),
        expect.stringContaining("Recent:"),
      ]),
      { placement: "belowEditor" }
    );
  });

  it("prints observable status details for the status command", async () => {
    process.env.PI_AUTONOMOUS_DEV = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { default: registerExtension } = await import("../index.js");
    const pi = createPiMock();
    const ctx = createCommandContext();

    registerExtension(pi);

    const [, options] = (pi.registerCommand as any).mock.calls[0];
    await options.handler("status", ctx);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Autonomous Dev Status"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Tracked issues:"));
    expect(ctx.ui.notify).toHaveBeenCalledWith("Printed autonomous dev status", "info");
    expect(ctx.ui.setStatus).toHaveBeenCalled();
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "autonomous-dev-widget",
      expect.arrayContaining([
        expect.stringContaining("Autonomous Dev Engine"),
        expect.stringContaining("Current:"),
        expect.stringContaining("Recent:"),
      ]),
      { placement: "belowEditor" }
    );
  });
});
