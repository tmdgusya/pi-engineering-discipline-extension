import * as os from "os";
import { getMarkdownTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import type { PiToolName } from "./pi-tools.js";
import {
  type DisplayItem,
  type SingleResult,
  type SubagentDetails,
  type UsageStats,
  aggregateUsage,
  getDisplayItems,
  getFinalOutput,
  getResultSummaryText,
  isResultError,
  isResultSuccess,
} from "./types.js";

const COLLAPSED_LINE_COUNT = 10;
const COLLAPSED_PARALLEL_LINE_COUNT = 5;

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsage(usage: Partial<UsageStats>, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

type ThemeFg = (color: any, text: string) => string;

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function statusIcon(r: SingleResult, fg: ThemeFg): string {
  if (r.exitCode === -1) return fg("warning", "⏳");
  return isResultError(r) ? fg("error", "✗") : fg("success", "✓");
}

export function formatToolCall(toolName: PiToolName | string, args: Record<string, unknown>, fg: ThemeFg): string {
  const pathArg = (args.file_path || args.path || "...") as string;
  switch (toolName) {
    case "bash": {
      const cmd = (args.command as string) || "...";
      return fg("muted", "$ ") + fg("toolOutput", truncate(cmd, 60));
    }
    case "read": {
      let text = fg("accent", shortenPath(pathArg));
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : "";
        text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
      }
      return fg("muted", "read ") + text;
    }
    case "write": {
      const lines = ((args.content || "") as string).split("\n").length;
      let text = fg("muted", "write ") + fg("accent", shortenPath(pathArg));
      if (lines > 1) text += fg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit":
      return fg("muted", "edit ") + fg("accent", shortenPath(pathArg));
    case "ls":
      return fg("muted", "ls ") + fg("accent", shortenPath((args.path || ".") as string));
    case "find":
      return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
    case "grep":
      return fg("muted", "grep ") + fg("accent", `/${(args.pattern || "") as string}/`) + fg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
    default:
      return fg("accent", toolName) + fg("dim", ` ${truncate(JSON.stringify(args), 50)}`);
  }
}

function splitOutputLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function countDisplayLines(items: DisplayItem[]): number {
  let count = 0;
  for (const item of items) {
    count += item.type === "text" ? splitOutputLines(item.text).length : 1;
  }
  return count;
}

function renderDisplayItems(items: DisplayItem[], expanded: boolean, fg: ThemeFg, limit?: number): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.type === "text") {
      for (const line of splitOutputLines(item.text)) lines.push(fg("toolOutput", line));
    } else {
      lines.push(fg("muted", "→ ") + formatToolCall(item.name, item.args, fg));
    }
  }
  const shouldTail = !expanded && typeof limit === "number";
  const toShow = shouldTail ? lines.slice(-limit) : lines;
  const skipped = shouldTail && lines.length > limit ? lines.length - limit : 0;
  let text = "";
  if (skipped > 0) text += fg("muted", `... ${skipped} earlier lines\n`);
  text += toShow.join("\n");
  return text.trimEnd();
}

export function renderCall(
  args: Record<string, any>,
  theme: Theme,
): Component {
  if (args.tasks && args.tasks.length > 0) {
    let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
    for (const t of args.tasks.slice(0, 3)) {
      text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${truncate(t.task, 40)}`)}`;
    }
    if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }

  if (args.chain && args.chain.length > 0) {
    let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `chain (${args.chain.length} steps)`);
    for (const s of args.chain.slice(0, 3)) {
      text += `\n  ${theme.fg("accent", s.agent)}${theme.fg("dim", ` ${truncate(s.task, 40)}`)}`;
    }
    if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }

  // Single mode
  const agentName = args.agent || "...";
  const preview = args.task ? truncate(args.task, 60) : "...";
  let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName);
  text += `\n  ${theme.fg("dim", preview)}`;
  return new Text(text, 0, 0);
}

export function renderResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  expanded: boolean,
  theme: Theme,
): Component {
  const details = result.details as SubagentDetails | undefined;
  if (!details || details.results.length === 0) {
    const first = result.content[0];
    return new Text(first?.type === "text" && first.text ? first.text : "(no output)", 0, 0);
  }

  if (details.mode === "single") {
    return renderSingleResult(details.results[0], expanded, theme);
  }
  return renderParallelResult(details, expanded, theme);
}

function renderNestedCalls(r: SingleResult, fg: ThemeFg): string {
  if (!r.nestedCalls || r.nestedCalls.length === 0) return "";
  const isRunning = r.exitCode === -1;
  const lines: string[] = [];
  for (const call of r.nestedCalls) {
    const icon = isRunning ? fg("warning", "⏳") : fg("success", "✓");
    const taskPreview = truncate(call.task, 50);
    lines.push(`  ${fg("muted", "└─")} ${icon} ${fg("accent", call.agent)} ${fg("dim", taskPreview)}`);
  }
  return lines.join("\n");
}

function renderSingleResult(
  r: SingleResult,
  expanded: boolean,
  theme: Theme,
): Component {
  const error = isResultError(r);
  const icon = statusIcon(r, theme.fg.bind(theme));
  const displayItems = getDisplayItems(r.messages);
  const finalOutput = getFinalOutput(r.messages);

  if (expanded) {
    const mdTheme = getMarkdownTheme();
    const container = new Container();

    // Header
    let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
    if (error && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
    container.addChild(new Text(header, 0, 0));
    if (error && r.errorMessage) container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));

    // Task
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
    container.addChild(new Text(theme.fg("dim", r.task), 0, 0));

    // Output
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
    if (displayItems.length === 0 && !finalOutput) {
      container.addChild(new Text(theme.fg("muted", getResultSummaryText(r)), 0, 0));
    } else {
      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
        }
      }

      if (r.nestedCalls && r.nestedCalls.length > 0) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("muted", "─── Nested Calls ───"), 0, 0));
        const nestedText = renderNestedCalls(r, theme.fg.bind(theme));
        container.addChild(new Text(nestedText, 0, 0));
      }

      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
    }

    // Usage
    const usageStr = formatUsage(r.usage, r.model);
    if (usageStr) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
    }

    return container;
  }

  // Collapsed
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
  if (error && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;

  if (error && r.errorMessage) {
    text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
  } else if (displayItems.length === 0) {
    text += `\n${theme.fg(error ? "error" : "muted", getResultSummaryText(r))}`;
  } else {
    text += `\n${renderDisplayItems(displayItems, false, theme.fg.bind(theme), COLLAPSED_LINE_COUNT)}`;
    if (countDisplayLines(displayItems) > COLLAPSED_LINE_COUNT) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
  }

  const nestedText = renderNestedCalls(r, theme.fg.bind(theme));
  if (nestedText) text += `\n${nestedText}`;

  const usageStr = formatUsage(r.usage, r.model);
  if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
  return new Text(text, 0, 0);
}

// ---------------------------------------------------------------------------
// Parallel-mode result
// ---------------------------------------------------------------------------

function renderParallelResult(
  details: SubagentDetails,
  expanded: boolean,
  theme: Theme,
): Component {
  const running = details.results.filter((r) => r.exitCode === -1).length;
  const successCount = details.results.filter((r) => isResultSuccess(r)).length;
  const failCount = details.results.filter((r) => isResultError(r)).length;
  const isRunning = running > 0;

  const icon = isRunning
    ? theme.fg("warning", "⏳")
    : failCount > 0
      ? theme.fg("warning", "◐")
      : theme.fg("success", "✓");

  const status = isRunning
    ? `${successCount + failCount}/${details.results.length} done, ${running} running`
    : `${successCount}/${details.results.length} tasks`;

  if (expanded && !isRunning) {
    const mdTheme = getMarkdownTheme();
    const container = new Container();
    container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`, 0, 0));

    for (const r of details.results) {
      const rIcon = statusIcon(r, theme.fg.bind(theme));
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);

      container.addChild(new Spacer(1));
      container.addChild(new Text(`${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`, 0, 0));
      container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
        }
      }

      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      } else if (isResultError(r)) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("error", getResultSummaryText(r)), 0, 0));
      }

      const taskUsage = formatUsage(r.usage, r.model);
      if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
    }

    const totalUsage = formatUsage(aggregateUsage(details.results));
    if (totalUsage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", `Total: ${totalUsage}`), 0, 0));
    }

    return container;
  }

  // Collapsed
  let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;

  for (const r of details.results) {
    const rIcon = statusIcon(r, theme.fg.bind(theme));
    const displayItems = getDisplayItems(r.messages);
    text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
    if (displayItems.length === 0) {
      text += `\n${theme.fg(r.exitCode === -1 ? "muted" : isResultError(r) ? "error" : "muted", r.exitCode === -1 ? "(running...)" : getResultSummaryText(r))}`;
    } else {
      text += `\n${renderDisplayItems(displayItems, false, theme.fg.bind(theme), COLLAPSED_PARALLEL_LINE_COUNT)}`;
    }
  }

  if (!isRunning) {
    const totalUsage = formatUsage(aggregateUsage(details.results));
    if (totalUsage) text += `\n\n${theme.fg("dim", `Total: ${totalUsage}`)}`;
  }
  if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;

  return new Text(text, 0, 0);
}
