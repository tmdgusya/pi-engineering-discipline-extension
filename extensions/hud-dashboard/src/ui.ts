import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { hudStore, hudActions, hudSelectors, type HUDState, type WorkflowStatus } from "./state.js";
import { sanitizeForDisplay } from "./security.js";

type WidgetId = "status" | "metrics" | "tools" | "goals";

interface WidgetConfig {
  id: WidgetId;
  title: string;
  minWidth: number;
  collapsible: boolean;
  defaultVisible: boolean;
}

const WIDGET_CONFIGS: Record<WidgetId, WidgetConfig> = {
  status:  { id: "status",  title: "Status",       minWidth: 30, collapsible: true, defaultVisible: true },
  metrics: { id: "metrics", title: "Metrics",      minWidth: 25, collapsible: true, defaultVisible: false },
  tools:   { id: "tools",   title: "Tool Calls",   minWidth: 40, collapsible: true, defaultVisible: true },
  goals:   { id: "goals",   title: "Current Goal",  minWidth: 35, collapsible: true, defaultVisible: true },
};

class WidgetRegistry {
  private widgets = new Map<WidgetId, { collapsed: boolean; visible: boolean }>();
  private renderers = new Map<WidgetId, (state: HUDState, theme: Theme, width: number) => string[]>();

  constructor() {
    for (const [id, config] of Object.entries(WIDGET_CONFIGS)) {
      this.widgets.set(id as WidgetId, { collapsed: false, visible: config.defaultVisible });
    }
  }

  registerRenderer(id: WidgetId, renderer: (state: HUDState, theme: Theme, width: number) => string[]): void {
    this.renderers.set(id, renderer);
  }

  toggleVisibility(id: WidgetId): void {
    const widget = this.widgets.get(id);
    if (widget) widget.visible = !widget.visible;
  }

  toggleCollapsed(id: WidgetId): void {
    const widget = this.widgets.get(id);
    if (widget) widget.collapsed = !widget.collapsed;
  }

  isVisible(id: WidgetId): boolean { return this.widgets.get(id)?.visible ?? false; }
  isCollapsed(id: WidgetId): boolean { return this.widgets.get(id)?.collapsed ?? false; }

  getVisibleWidgets(): WidgetId[] {
    const order: WidgetId[] = ["status", "goals", "tools", "metrics"];
    return order.filter(id => this.isVisible(id));
  }

  renderWidget(id: WidgetId, state: HUDState, theme: Theme, width: number): string[] {
    const renderer = this.renderers.get(id);
    if (!renderer) return [];

    if (this.widgets.get(id)?.collapsed) {
      return [theme.fg("accent", `▶ ${WIDGET_CONFIGS[id].title}`)];
    }

    return renderer(state, theme, width);
  }
}

export const widgetRegistry = new WidgetRegistry();

const STATUS_ICONS: Record<WorkflowStatus, { icon: string; color: string }> = {
  idle:      { icon: "○", color: "muted" },
  thinking:  { icon: "◐", color: "accent" },
  planning:  { icon: "◕", color: "accent" },
  executing: { icon: "●", color: "warning" },
  error:     { icon: "✕", color: "error" },
  completed: { icon: "✓", color: "success" },
};

const TOOL_STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: "○", color: "muted" },
  running: { icon: "◐", color: "warning" },
  success: { icon: "✓", color: "success" },
  error:   { icon: "✕", color: "error" },
};

const STATUS_TEXT: Record<WorkflowStatus, string> = {
  idle: "Idle", thinking: "Thinking...", planning: "Planning...",
  executing: "Executing tools...", error: "Error occurred", completed: "Completed",
};

export class HUDDashboardRenderer {
  private theme: Theme;
  private width: number;
  private frame = 0;
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(theme: Theme, width: number) {
    this.theme = theme;
    this.width = width;
  }

  render(state: HUDState): Text {
    this.frame++;
    const lines: string[] = [];

    lines.push(this.theme.fg("accent", "╭─ HUD Dashboard ──────────────────────────────╮"));
    lines.push(...this.renderStatusBar(state));

    for (const widgetId of widgetRegistry.getVisibleWidgets()) {
      const arrow = widgetRegistry.isCollapsed(widgetId) ? "▶" : "▼";
      lines.push(this.theme.fg("muted", `├─ ${arrow} ${WIDGET_CONFIGS[widgetId].title}`));
      lines.push(...widgetRegistry.renderWidget(widgetId, state, this.theme, this.width));
    }

    const duration = hudSelectors.getSessionDuration();
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    lines.push(`╰───────────────────────────────────────── ${this.theme.fg("muted", `v1.0.0 │ ${mins}:${secs.toString().padStart(2, "0")}`)}`);

    return new Text(lines.join("\n"), 1, 1);
  }

  private renderStatusBar(state: HUDState): string[] {
    const { icon, color } = STATUS_ICONS[state.workflowStatus];
    const statusIcon = this.theme.fg(color as any, icon);
    const statusText = this.theme.fg(color as any, STATUS_TEXT[state.workflowStatus]);

    let spinner = "";
    if (state.workflowStatus === "thinking" || state.workflowStatus === "executing") {
      spinner = this.theme.fg("warning", this.spinnerFrames[this.frame % this.spinnerFrames.length]);
    }

    const connIcon = state.providerConnected
      ? this.theme.fg("success", "●")
      : this.theme.fg("error", "○");

    return [`│  ${spinner} ${statusIcon} ${statusText}    ${connIcon} Connected`];
  }

  renderStatusWidget(state: HUDState): string[] {
    const lines: string[] = [];

    if (state.currentGoal) {
      const preview = sanitizeForDisplay(state.currentGoal).slice(0, 40);
      lines.push(`│    Goal: ${this.theme.fg("muted", preview + (state.currentGoal.length > 40 ? "..." : ""))}`);
    }

    lines.push(`│    Status: ${this.theme.fg("accent", state.workflowStatus)}`);

    const connColor = state.providerConnected ? "success" : "error";
    lines.push(`│    Provider: ${this.theme.fg(connColor, state.providerConnected ? "Connected" : "Disconnected")}`);

    return lines;
  }

  renderMetricsWidget(state: HUDState): string[] {
    const { metrics } = state;
    const errorRate = hudSelectors.getErrorRate();

    return [
      `│    Turns: ${this.theme.fg("accent", metrics.turnsCount.toString())}`,
      `│    Tools: ${this.theme.fg("accent", metrics.toolsExecuted.toString())}`,
      `│    Errors: ${this.theme.fg(metrics.errorsCount > 0 ? "error" : "success", metrics.errorsCount.toString())}`,
      `│    Error Rate: ${this.theme.fg(parseFloat(errorRate) > 10 ? "error" : "success", errorRate + "%")}`,
    ];
  }

  renderToolsWidget(state: HUDState): string[] {
    if (state.activeToolCalls.length === 0) {
      return [`│    ${this.theme.fg("muted", "(No tool calls yet)")}`];
    }

    const lines: string[] = [];
    const recent = state.activeToolCalls.slice(-5);
    for (const tool of recent) {
      const { icon, color } = TOOL_STATUS_ICONS[tool.status] || TOOL_STATUS_ICONS.pending;
      const name = sanitizeForDisplay(tool.name).slice(0, 15).padEnd(15);
      lines.push(`│    ${this.theme.fg(color as any, icon)} ${this.theme.fg("muted", name)}`);
    }

    if (state.activeToolCalls.length > 5) {
      lines.push(`│    ${this.theme.fg("muted", `... and ${state.activeToolCalls.length - 5} more`)}`);
    }

    return lines;
  }
}

// HUD Controller

let unsubscribe: (() => void) | null = null;
let currentRenderer: HUDDashboardRenderer | null = null;
let currentTheme: Theme | null = null;
let currentWidth = 80;

export function initHUD(pi: ExtensionAPI): void {
  widgetRegistry.registerRenderer("status", (state, theme, width) =>
    new HUDDashboardRenderer(theme, width).renderStatusWidget(state)
  );
  widgetRegistry.registerRenderer("metrics", (state, theme, width) =>
    new HUDDashboardRenderer(theme, width).renderMetricsWidget(state)
  );
  widgetRegistry.registerRenderer("tools", (state, theme, width) =>
    new HUDDashboardRenderer(theme, width).renderToolsWidget(state)
  );
  widgetRegistry.registerRenderer("goals", (state, theme) => {
    if (!state.currentGoal) return [`│    ${theme.fg("muted", "(No active goal)")}`];
    return state.currentGoal.split("\n").slice(0, 3)
      .map(line => `│    ${theme.fg("muted", sanitizeForDisplay(line).slice(0, 40))}`);
  });

  unsubscribe = hudStore.subscribe(() => {});

  setInterval(() => { hudActions.heartbeat(); }, 30000);
}

export function setHUDTheme(theme: Theme, width: number): void {
  currentTheme = theme;
  currentWidth = width;
  currentRenderer = new HUDDashboardRenderer(theme, width);
}

export function destroyHUD(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  currentRenderer = null;
  currentTheme = null;
}

export function registerHUDCommands(pi: ExtensionAPI): void {
  pi.registerCommand("hud-metrics", {
    description: "Toggle HUD metrics display",
    handler: async (_args, ctx) => {
      hudActions.toggleMetrics();
      widgetRegistry.toggleVisibility("metrics");
      ctx.ui.notify("HUD metrics toggled", "info");
    },
  });

  pi.registerCommand("hud-tools", {
    description: "Toggle HUD tool list display",
    handler: async (_args, ctx) => {
      hudActions.toggleToolList();
      widgetRegistry.toggleVisibility("tools");
      ctx.ui.notify("HUD tools toggled", "info");
    },
  });

  pi.registerCommand("hud-minimize", {
    description: "Minimize or restore the HUD dashboard",
    handler: async (_args, ctx) => {
      hudActions.toggleMinimized();
      ctx.ui.notify(hudStore.getState().isMinimized ? "HUD minimized" : "HUD restored", "info");
    },
  });

  pi.registerCommand("hud-reset", {
    description: "Reset HUD dashboard state",
    handler: async (_args, ctx) => {
      hudActions.reset();
      ctx.ui.notify("HUD state reset", "info");
    },
  });
}
