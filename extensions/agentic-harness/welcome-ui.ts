import type { Component, TUI } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { keyHint, keyText, rawKeyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { SHIMMER_SWEEP_MS } from "./shimmer.js";

export type HeaderFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };

export type HeaderUi = {
  setHeader: (factory: HeaderFactory | undefined) => void;
  notify?: (message: string, level?: "info" | "warning" | "error") => void;
};

let welcomeVisible = true;

const BANNER_LINES = [
  "██████╗  ██████╗  █████╗  ██████╗██╗  ██╗    ██████╗ ██╗",
  "██╔══██╗██╔═══██╗██╔══██╗██╔════╝██║  ██║    ██╔══██╗██║",
  "██████╔╝██║   ██║███████║██║     ███████║    ██████╔╝██║",
  "██╔══██╗██║   ██║██╔══██║██║     ██╔══██║    ██╔═══╝ ██║",
  "██║  ██║╚██████╔╝██║  ██║╚██████╗██║  ██║    ██║     ██║",
  "╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝    ╚═╝     ╚═╝",
];

// Slowed down from the original 80ms to reduce per-frame redraw pressure
// (see issue #56 — severe screen flickering on default terminals).
// The frame interval drives the shimmer phase tick; the separate heartbeat
// keeps a persistent (but cheap) requestRender cadence independent of the
// animation tick so the UI still refreshes even when the shimmer phase
// would otherwise skip a frame.
const WELCOME_SHIMMER_FRAME_MS = 500;
const WELCOME_RENDER_HEARTBEAT_MS = 1200;
const WELCOME_SHIMMER_PHASE_OFFSET_MS = 350;

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const BANNER_BASE_STOPS = ["#00d7d7", "#d7af5f", "#78ebeb"] as const;
const BANNER_CREST = "#f5ffff";

type WelcomeTheme = Theme & { getFgAnsi?: Theme["getFgAnsi"] };

type Rgb = { r: number; g: number; b: number };

function parseHexColor(hex: string): Rgb {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * clamped);
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) };
}

function gradientColorAt(pos: number, stops: readonly string[]): Rgb {
  if (stops.length === 0) return parseHexColor(BANNER_CREST);
  if (stops.length === 1) return parseHexColor(stops[0]);
  const clamped = Math.max(0, Math.min(1, pos));
  const scaled = clamped * (stops.length - 1);
  const lo = Math.min(Math.floor(scaled), stops.length - 2);
  return mixRgb(parseHexColor(stops[lo]), parseHexColor(stops[lo + 1]), scaled - lo);
}

function fgAnsi(color: Rgb): string {
  return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

function renderStaticBanner(theme: Theme): string {
  return BANNER_LINES.map((line) => theme.bold(theme.fg("accent", line))).join("\n");
}

function renderShimmerBanner(phaseMs: number): string {
  const artWidth = Math.max(...BANNER_LINES.map((line) => Array.from(line).length));
  const rows = BANNER_LINES.length;
  const period = artWidth + rows + 8;
  const center = (((phaseMs / SHIMMER_SWEEP_MS) * period) % period + period) % period;
  const crest = parseHexColor(BANNER_CREST);
  const sigma = 5.0;

  return BANNER_LINES.map((line, y) => {
    const chars = Array.from(line);
    return chars.map((char, x) => {
      const fgPos = (x / Math.max(1, artWidth)) * 0.6 + (y / Math.max(1, rows)) * 0.4;
      const base = gradientColorAt(fgPos, BANNER_BASE_STOPS);
      const d = x + y - center;
      const glow = Math.exp(-(d * d) / (2 * sigma * sigma)) * 0.92;
      return `${fgAnsi(mixRgb(base, crest, glow))}${ANSI_BOLD}${char}${ANSI_RESET}`;
    }).join("");
  }).join("\n");
}

function canRenderShimmer(theme: WelcomeTheme): theme is Theme {
  return typeof theme.getFgAnsi === "function";
}

class WelcomeHeaderComponent implements Component {
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private animating: boolean;
  private readonly startedAt = Date.now();

  constructor(private readonly tui: Pick<TUI, "requestRender">, private readonly theme: WelcomeTheme) {
    this.animating = canRenderShimmer(theme);
    if (this.animating) {
      this.timer = setInterval(() => this.tick(), WELCOME_SHIMMER_FRAME_MS);
      this.timer.unref?.();
      this.heartbeatTimer = setInterval(() => this.tick(), WELCOME_RENDER_HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }
  }

  dispose(): void {
    this.stopTimer();
    this.animating = false;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return new Text(this.content(), 1, 0).render(width);
  }

  private tick(): void {
    this.tui.requestRender();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private content(): string {
    const banner = this.renderBanner();
    const tagline = this.theme.fg("dim", "Engineering Discipline Extension");
    const tipLine = this.theme.fg("muted", "Tip: Always start with /clarify. Then activate a durable /goal.");
    const clarifyLine = this.theme.fg("dim", "Never skip /clarify — it prevents wasted effort.");
    const hints = [
      keyHint("app.interrupt", "to interrupt"),
      keyHint("app.clear", "to clear"),
      rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
      keyHint("app.tools.expand", "to expand tools"),
      rawKeyHint("/", "for commands"),
      rawKeyHint("!", "to run bash"),
    ].join("\n");

    return `\n${banner}\n${tagline}\n\n${tipLine}\n${clarifyLine}\n\n${hints}`;
  }

  private renderBanner(): string {
    if (!this.animating || !canRenderShimmer(this.theme)) {
      this.animating = false;
      this.stopTimer();
      return renderStaticBanner(this.theme);
    }
    return renderShimmerBanner(Date.now() - this.startedAt + WELCOME_SHIMMER_PHASE_OFFSET_MS);
  }
}

export function createWelcomeHeader(): HeaderFactory {
  return (tui, theme) => new WelcomeHeaderComponent(tui, theme);
}

export function showWelcomeHeader(ui: HeaderUi): void {
  welcomeVisible = true;
  ui.setHeader(createWelcomeHeader());
}

export function dismissWelcomeHeader(ui: HeaderUi): void {
  welcomeVisible = false;
  ui.setHeader(undefined);
}

export function toggleWelcomeHeader(ui: HeaderUi): boolean {
  if (welcomeVisible) {
    dismissWelcomeHeader(ui);
    return false;
  }
  showWelcomeHeader(ui);
  return true;
}

export function isWelcomeVisible(): boolean {
  return welcomeVisible;
}

export function registerWelcomeCommand(pi: ExtensionAPI): void {
  pi.registerCommand("welcome", {
    description: "Show, hide, or toggle the Agentic Harness welcome header",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const ui = ctx.ui as HeaderUi;
      const action = args.trim().toLowerCase();
      if (action === "off" || action === "hide" || action === "dismiss") {
        dismissWelcomeHeader(ui);
        ui.notify?.("Welcome header hidden", "info");
        return;
      }
      if (action === "on" || action === "show" || action === "restore") {
        showWelcomeHeader(ui);
        ui.notify?.("Welcome header shown", "info");
        return;
      }
      const visible = toggleWelcomeHeader(ui);
      ui.notify?.(visible ? "Welcome header shown" : "Welcome header hidden", "info");
    },
  });
}
