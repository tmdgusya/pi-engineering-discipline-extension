import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  keyHint: (key: string, description?: string) => `${key}${description ? ` ${description}` : ""}`,
  keyText: (key: string) => key,
  rawKeyHint: (key: string, description?: string) => `${key}${description ? ` ${description}` : ""}`,
}));

import {
  createWelcomeHeader,
  dismissWelcomeHeader,
  isWelcomeVisible,
  registerWelcomeCommand,
  showWelcomeHeader,
  toggleWelcomeHeader,
} from "../welcome-ui.js";
import { SHIMMER_SWEEP_MS } from "../shimmer.js";

function ui() {
  return {
    setHeader: vi.fn(),
    notify: vi.fn(),
  };
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

const shimmerTheme = {
  ...theme,
  getFgAnsi: (color: string) => color === "warning" ? "\x1b[33m" : "\x1b[36m",
} as any;

const SHIMMER_HIGHLIGHT_ANSI = "\x1b[38;2;241;248;242m";

function render(component: { render(width: number): string[] }): string {
  return component.render(120).join("\n");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("welcome header controller", () => {
  it("creates a non-blocking header component", () => {
    const component = createWelcomeHeader()({} as any, theme);
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("Engineering Discipline Extension");
    expect(rendered).toContain("/clarify");
  });

  it("keeps the banner shimmer running while the header is shown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const component = createWelcomeHeader()({ requestRender: vi.fn() } as any, shimmerTheme);

    const initialRender = render(component);
    expect(initialRender).toContain("\x1b[");
    expect(initialRender).toContain(SHIMMER_HIGHLIGHT_ANSI);
    expect(initialRender).not.toContain("\x1b[33m");

    vi.setSystemTime(350);
    expect(render(component)).not.toBe(initialRender);

    vi.setSystemTime(SHIMMER_SWEEP_MS * 3);
    const laterRender = render(component);

    expect(laterRender).toContain("\x1b[");
    expect(laterRender).toContain("Engineering Discipline Extension");
  });

  it("clears the shimmer and heartbeat timers on dispose", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const requestRender = vi.fn();

    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);
    component.dispose?.();
    // Advance past both tick intervals (500ms frame + 1200ms heartbeat).
    // If either timer survived dispose, requestRender would fire here.
    vi.advanceTimersByTime(1500);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("fires requestRender on the 500ms frame interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestRender = vi.fn();

    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);
    expect(requestRender).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(requestRender).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1); // total 500ms — first frame tick
    expect(requestRender).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500); // total 1000ms — second frame tick
    expect(requestRender).toHaveBeenCalledTimes(2);

    component.dispose?.();
  });

  it("fires requestRender on the 1200ms heartbeat interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestRender = vi.fn();

    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);

    vi.advanceTimersByTime(1199); // just before the heartbeat fires
    // Frame timer fires at 500 and 1000 (2x); heartbeat has not fired yet.
    expect(requestRender).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1); // total 1200ms — heartbeat fires once
    expect(requestRender).toHaveBeenCalledTimes(3);

    // Advance from 1200ms to 2399ms — heartbeat has not fired again yet,
    // but the frame timer ticks at 1500, 2000 (2 more calls).
    vi.advanceTimersByTime(1199);
    expect(requestRender).toHaveBeenCalledTimes(5);

    vi.advanceTimersByTime(1); // total 2400ms — second heartbeat fires
    expect(requestRender).toHaveBeenCalledTimes(6);

    component.dispose?.();
  });

  it("does not start any timers when the theme cannot render shimmer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const requestRender = vi.fn();

    const component = createWelcomeHeader()({ requestRender } as any, theme);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(requestRender).not.toHaveBeenCalled();

    component.dispose?.();
  });

  it("shows, dismisses, and toggles the header", () => {
    const mockUi = ui();

    showWelcomeHeader(mockUi as any);
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));

    dismissWelcomeHeader(mockUi as any);
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);

    expect(toggleWelcomeHeader(mockUi as any)).toBe(true);
    expect(isWelcomeVisible()).toBe(true);
  });

  it("registers /welcome command for show, hide, and toggle", async () => {
    const commands = new Map<string, any>();
    registerWelcomeCommand({ registerCommand: (name: string, def: any) => commands.set(name, def) } as any);

    const command = commands.get("welcome");
    expect(command).toBeDefined();
    expect(command.description).toContain("welcome header");

    const mockUi = ui();
    await command.handler("off", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");

    await command.handler("on", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header shown", "info");

    await command.handler("toggle", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");
  });
});
