import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hudStore, hudActions, type HUDState } from "./state.js";
import { widgetRegistry, registerHUDCommands } from "./ui.js";
import { heartbeatMonitor, optimisticManager, reconciler, initStateSync, getReconciliationStatus } from "./sync.js";
import { checkApiCompatibility, cleanupExpiredPermissions, hasHighSeverityEvents, logSecurityEvent } from "./security.js";

interface UserPreferences {
  visibleWidgets: string[];
  collapsedWidgets: string[];
  showMetrics: boolean;
  theme: string;
  animationSpeed: number;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  visibleWidgets: ["status", "goals", "tools"],
  collapsedWidgets: ["metrics"],
  showMetrics: false,
  theme: "auto",
  animationSpeed: 1.0,
};

class PreferenceManager {
  private prefs: UserPreferences = { ...DEFAULT_PREFERENCES };
  private listeners: Array<(prefs: UserPreferences) => void> = [];

  load(): void {
    // TODO: read from pi session state via appendEntry/getEntries
    this.prefs = { ...DEFAULT_PREFERENCES };
  }

  save(): void {
    // TODO: persist to pi session state via appendEntry
    logSecurityEvent("permission_granted", "Preferences saved", "low");
  }

  get<K extends keyof UserPreferences>(key: K): UserPreferences[K] { return this.prefs[key]; }

  set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
    this.prefs[key] = value;
    this.save();
    this.notifyListeners();
  }

  reset(): void {
    this.prefs = { ...DEFAULT_PREFERENCES };
    this.save();
    this.notifyListeners();
  }

  onChange(listener: (prefs: UserPreferences) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try { listener(this.prefs); } catch (e) { console.error("[HUD Preferences] Listener error:", e); }
    }
  }
}

export const preferenceManager = new PreferenceManager();

type DisplayContext = "idle" | "active" | "deep_work" | "error" | "review";

const CONTEXT_CONFIGS: Record<DisplayContext, Partial<UserPreferences>> = {
  idle:      { visibleWidgets: ["status"],                    showMetrics: false },
  active:    { visibleWidgets: ["status", "tools", "goals"],  showMetrics: false },
  deep_work: { visibleWidgets: ["status", "metrics"],         showMetrics: true },
  error:     { visibleWidgets: ["status", "metrics", "tools"], showMetrics: true },
  review:    { visibleWidgets: ["tools", "metrics", "status"], showMetrics: true },
};

class ContextAwareDisplay {
  private currentContext: DisplayContext = "idle";

  determineContext(state: HUDState): DisplayContext {
    if (!state.providerConnected || hasHighSeverityEvents()) return "error";
    if (state.workflowStatus === "idle") return "idle";
    if (state.workflowStatus === "thinking" && state.activeToolCalls.length === 0) return "deep_work";
    if (state.workflowStatus === "executing" && state.activeToolCalls.length > 3) return "review";
    return "active";
  }

  update(state: HUDState): void {
    const newContext = this.determineContext(state);
    if (newContext !== this.currentContext) {
      this.currentContext = newContext;
      this.applyContext(newContext);
    }
  }

  private applyContext(context: DisplayContext): void {
    const config = CONTEXT_CONFIGS[context];
    if (!config) return;

    if (config.visibleWidgets) {
      for (const id of ["status", "goals", "tools", "metrics"]) {
        const shouldShow = config.visibleWidgets.includes(id);
        if (widgetRegistry.isVisible(id as any) !== shouldShow) {
          widgetRegistry.toggleVisibility(id as any);
        }
      }
    }

    if (config.showMetrics !== undefined) {
      if (config.showMetrics !== hudStore.getState().showMetrics) {
        hudActions.toggleMetrics();
      }
    }
  }
}

export const contextDisplay = new ContextAwareDisplay();

type StateIndicator = {
  type: "loading" | "error" | "success" | "info";
  message: string;
  timestamp: number;
};

const MAX_INDICATORS = 5;

class StateIndicatorManager {
  private indicators: StateIndicator[] = [];
  private listeners: Array<(indicators: StateIndicator[]) => void> = [];

  show(type: StateIndicator["type"], message: string): void {
    const indicator: StateIndicator = { type, message, timestamp: Date.now() };
    this.indicators.push(indicator);
    if (this.indicators.length > MAX_INDICATORS) this.indicators.shift();
    this.notify();

    if (type === "success" || type === "info") {
      setTimeout(() => this.dismiss(indicator.timestamp), 5000);
    }
  }

  dismiss(timestamp: number): void {
    const idx = this.indicators.findIndex(i => i.timestamp === timestamp);
    if (idx !== -1) { this.indicators.splice(idx, 1); this.notify(); }
  }

  clear(): void { this.indicators = []; this.notify(); }
  getAll(): readonly StateIndicator[] { return this.indicators; }

  onChange(listener: (indicators: StateIndicator[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener([...this.indicators]); } catch (e) { console.error("[HUD Indicators] Listener error:", e); }
    }
  }
}

export const indicatorManager = new StateIndicatorManager();

function cleanup(): void {
  cleanupExpiredPermissions();
  reconciler.flush();
  indicatorManager.clear();
}

export function initHUDDashboard(pi: ExtensionAPI): void {
  const apiVersion = "0.65.0";

  if (!checkApiCompatibility(apiVersion)) {
    console.warn(`[HUD] API version mismatch: ${apiVersion}`);
    hudActions.setApiVersion(apiVersion);
  }

  preferenceManager.load();
  initStateSync(pi);
  registerHUDCommands(pi);

  setInterval(cleanup, 60000);

  hudStore.subscribe((state) => { contextDisplay.update(state); });

  logSecurityEvent("permission_granted", "HUD Dashboard initialized", "low");

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.notify("HUD Dashboard ready. Try /hud-metrics, /hud-tools, /hud-minimize", "info");
    }
  });
}

export function destroyHUDDashboard(): void {
  cleanup();
  optimisticManager.rollbackAll();
  heartbeatMonitor.stop();
  reconciler.cancel();
}
