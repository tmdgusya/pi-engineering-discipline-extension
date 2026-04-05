import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { basename } from "path";

export interface FooterContext {
  cwd: string;
  getModelName: () => string | undefined;
  getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
}

export interface CacheStats {
  totalInput: number;
  totalCacheRead: number;
}

export interface ActiveTools {
  /** toolCallId → toolName */
  running: Map<string, string>;
}

function progressBar(percent: number, barWidth: number, theme: Theme): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = barWidth - filled;

  let color: "success" | "warning" | "error";
  if (clamped < 60) color = "success";
  else if (clamped < 85) color = "warning";
  else color = "error";

  const bar = theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
  const label = theme.fg(color, `${Math.round(clamped)}%`);
  return `${bar} ${label}`;
}

export class RoachFooter implements Component {
  private theme: Theme;
  private footerData: ReadonlyFooterDataProvider;
  private footerCtx: FooterContext;
  private cacheStats: CacheStats;
  private activeTools: ActiveTools;

  constructor(theme: Theme, footerData: ReadonlyFooterDataProvider, footerCtx: FooterContext, cacheStats: CacheStats, activeTools: ActiveTools) {
    this.theme = theme;
    this.footerData = footerData;
    this.footerCtx = footerCtx;
    this.cacheStats = cacheStats;
    this.activeTools = activeTools;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const t = this.theme;
    const sep = t.fg("dim", " │ ");

    // === Data ===
    const dirName = basename(this.footerCtx.cwd) || this.footerCtx.cwd;
    const branch = this.footerData.getGitBranch();
    const modelName = this.footerCtx.getModelName() ?? "no model";
    const usage = this.footerCtx.getContextUsage();

    // === Line 1: dir │ branch │ model ===
    const line1Parts: string[] = [];
    line1Parts.push(t.fg("accent", dirName));
    if (branch && branch !== "detached") {
      line1Parts.push(t.fg("success", ` ${branch}`));
    }
    line1Parts.push(t.fg("dim", modelName));
    const line1 = ` ${line1Parts.join(sep)}`;

    // === Line 2: ctx bar │ cache │ tools ===
    const pct = usage?.percent ?? 0;
    const tokens = usage?.tokens ?? 0;
    const ctxK = usage ? Math.round(usage.contextWindow / 1000) : 0;
    const tokK = Math.round(tokens / 1000);
    const bar = progressBar(pct, 15, t);
    const ctxPart = `${t.fg("dim", "ctx")} ${bar} ${t.fg("dim", `${tokK}k/${ctxK}k`)}`;

    const totalTokens = this.cacheStats.totalInput + this.cacheStats.totalCacheRead;
    const cacheRate = totalTokens > 0
      ? Math.round((this.cacheStats.totalCacheRead / totalTokens) * 100)
      : 0;
    const cacheColor: "success" | "warning" | "dim" = cacheRate >= 50 ? "success" : cacheRate >= 20 ? "warning" : "dim";
    const cachePart = t.fg(cacheColor, `cache ${cacheRate}%`);

    const line2Parts = [ctxPart, cachePart];

    // Active tools
    if (this.activeTools.running.size > 0) {
      const names = [...new Set(this.activeTools.running.values())];
      const count = this.activeTools.running.size;
      const toolList = names.map(n => t.fg("accent", n)).join(t.fg("dim", ","));
      line2Parts.push(t.fg("dim", `▶${count} `) + toolList);
    }

    const line2 = ` ${line2Parts.join(sep)}`;

    const border = t.fg("dim", "─".repeat(width));
    return [border, line1, line2];
  }
}
