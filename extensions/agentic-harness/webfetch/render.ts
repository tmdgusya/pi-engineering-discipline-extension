/**
 * Custom TUI rendering for the webfetch tool.
 */

import { type Theme } from "@mariozechner/pi-coding-agent";
import { Text, Container, Spacer } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import type { WebFetchDetails } from "./types.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function methodLabel(
  method: string,
  fg: (color: any, text: string) => string,
): string {
  switch (method) {
    case "readability":
      return fg("success", "readability");
    case "full":
      return fg("warning", "full-html");
    case "raw":
      return fg("dim", "raw");
    default:
      return fg("dim", method);
  }
}

export function renderWebfetchCall(
  args: Record<string, any>,
  theme: Theme,
): Component {
  const url = args.url || "...";
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Use raw URL if parsing fails
  }

  let text = theme.fg("toolTitle", theme.bold("webfetch "));
  text += theme.fg("accent", hostname);
  if (args.raw) text += theme.fg("dim", " --raw");
  if (args.maxLength) text += theme.fg("dim", ` --max ${args.maxLength}`);
  return new Text(text, 0, 0);
}

export function renderWebfetchResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  expanded: boolean,
  theme: Theme,
): Component {
  const details = result.details as WebFetchDetails | undefined;

  if (!details) {
    const first = result.content[0];
    const text =
      first?.type === "text" && first.text ? first.text : "(no output)";
    return new Text(text, 0, 0);
  }

  const method = methodLabel(details.method, theme.fg.bind(theme));
  const size = formatBytes(details.bytes);
  const cached = details.cached
    ? theme.fg("success", "cached")
    : theme.fg("dim", "fetched");
  const duration = `${details.duration}ms`;

  if (expanded) {
    const container = new Container();

    let header = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold("webfetch "))}`;
    header += theme.fg("accent", details.url);
    container.addChild(new Text(header, 0, 0));

    container.addChild(new Spacer(1));

    const meta = [
      `${theme.fg("muted", "method:")} ${method}`,
      `${theme.fg("muted", "size:")} ${theme.fg("dim", size)}`,
      `${theme.fg("muted", "type:")} ${theme.fg("dim", details.contentType)}`,
      `${theme.fg("muted", "status:")} ${cached}`,
      `${theme.fg("muted", "time:")} ${theme.fg("dim", duration)}`,
    ].join("  ");
    container.addChild(new Text(meta, 0, 0));

    return container;
  }

  // Collapsed
  let text = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold("webfetch"))}`;
  text += ` ${method} ${theme.fg("dim", size)} ${cached} ${theme.fg("dim", duration)}`;
  return new Text(text, 0, 0);
}
