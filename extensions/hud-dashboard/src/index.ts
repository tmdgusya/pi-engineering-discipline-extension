import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { VERSION } from "@mariozechner/pi-coding-agent";
import { hudStore, hudActions } from "./state.js";
import { checkApiCompatibility, logSecurityEvent, grantPermission } from "./security.js";
import { hudEventBus } from "./eventBus.js";
import { widgetRegistry, registerHUDCommands, setHUDTheme } from "./ui.js";
import { heartbeatMonitor, optimisticManager, reconciler, initStateSync, forceSync, getReconciliationStatus } from "./sync.js";
import { preferenceManager, contextDisplay, indicatorManager, initHUDDashboard, destroyHUDDashboard } from "./preferences.js";

const EXTENSION_VERSION = "1.0.0";

export default function hudDashboardExtension(pi: ExtensionAPI): void {
  const compatible = checkApiCompatibility(VERSION);
  if (!compatible) {
    console.warn(`[HUD Dashboard] API version ${VERSION} may not be fully compatible`);
  }

  hudActions.setApiVersion(VERSION);
  hudActions.setProviderConnected(true);

  // Event bus
  hudEventBus.init(pi);

  hudEventBus.subscribe("workflow:start", (event) => {
    indicatorManager.show("info", `Workflow started: ${(event.payload as any).status}`);
  });

  hudEventBus.subscribe("workflow:end", (event) => {
    if ((event.payload as any).status === "completed") {
      indicatorManager.show("success", "Workflow completed");
    }
  });

  hudEventBus.subscribe("tool:start", () => {
    hudActions.setWorkflowStatus("executing");
  });

  hudEventBus.subscribe("tool:error", () => {
    indicatorManager.show("error", "Tool execution failed");
  });

  // Security: grant permissions, intercept tool results
  grantPermission("hud-dashboard", "hud:read", 3600000);
  grantPermission("hud-dashboard", "hud:write", 3600000);
  grantPermission("hud-dashboard", "metrics:read", 3600000);

  pi.on("tool_result", async (event) => {
    const content = typeof event.content === "string" ? event.content : String(event.content);
    if (content.includes("key")) {
      logSecurityEvent("secret_detected", "Potential secret in tool output", "medium");
    }
  });

  // UI setup
  registerHUDCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      setHUDTheme(ctx.ui.theme, 80);
      ctx.ui.notify(`HUD Dashboard v${EXTENSION_VERSION} loaded`, "info");
      ctx.ui.setStatus("hud", "HUD Ready");
    }
  });

  // State sync
  initStateSync(pi);

  hudStore.subscribe((state) => {
    if (state.workflowStatus === "error") {
      indicatorManager.show("error", "Agent error detected");
    }
  });

  // UX polish
  initHUDDashboard(pi);

  // Block dangerous commands
  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash") {
      const cmd = (event.input as { command?: string })?.command || "";
      if (cmd.includes("rm -rf /") || cmd.includes(":(){ :|:& };:")) {
        logSecurityEvent("permission_rejected", "Dangerous command blocked", "high");
        return { block: true, reason: "Dangerous command blocked by HUD security" };
      }
    }
  });

  pi.on("session_shutdown", () => {
    forceSync();
    logSecurityEvent("permission_revoked", "Session shutdown", "low");
    optimisticManager.rollbackAll();
  });

  pi.registerCommand("hud-help", {
    description: "Show HUD Dashboard help",
    handler: async (_args, ctx) => {
      ctx.ui.notify("HUD Commands: /hud-metrics, /hud-tools, /hud-minimize, /hud-reset, /hud-help", "info");
    },
  });

  pi.registerCommand("hud-status", {
    description: "Show HUD Dashboard status",
    handler: async (_args, ctx) => {
      const state = hudStore.getState();
      const syncStatus = getReconciliationStatus();

      ctx.ui.notify([
        `Workflow: ${state.workflowStatus}`,
        `Tools executed: ${state.metrics.toolsExecuted}`,
        `Errors: ${state.metrics.errorsCount}`,
        `Heartbeat: ${heartbeatMonitor.isHealthy() ? "OK" : "FAILED"}`,
        `Sync: ${syncStatus.isSynced ? "Synced" : "Pending"}`,
        `Pending updates: ${optimisticManager.getPendingCount()}`,
      ].join("\n"), "info");
    },
  });

  logSecurityEvent("permission_granted", `HUD Dashboard v${EXTENSION_VERSION} initialized`, "low");
}
