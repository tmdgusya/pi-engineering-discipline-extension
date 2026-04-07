/** Aggregated token usage from a subagent run. */
export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

/** Result of a single subagent invocation. */
export interface SingleResult {
  agent: string;
  agentSource: "bundled" | "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: any[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  sawAgentEnd?: boolean;
}

/** Metadata attached to every tool result for rendering. */
export interface SubagentDetails {
  mode: "single" | "parallel";
  results: SingleResult[];
}

/** A display-friendly representation of a message part. */
export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

export function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

export function aggregateUsage(results: SingleResult[]): UsageStats {
  const total = emptyUsage();
  for (const r of results) {
    total.input += r.usage.input;
    total.output += r.usage.output;
    total.cacheRead += r.usage.cacheRead;
    total.cacheWrite += r.usage.cacheWrite;
    total.cost += r.usage.cost;
    total.turns += r.usage.turns;
  }
  return total;
}

export function isResultSuccess(r: SingleResult): boolean {
  if (r.exitCode === -1) return false;
  return r.exitCode === 0 && r.stopReason !== "error" && r.stopReason !== "aborted";
}

export function isResultError(r: SingleResult): boolean {
  if (r.exitCode === -1) return false;
  return !isResultSuccess(r);
}

export function getFinalOutput(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "text" && typeof part.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }
  return "";
}

export function getDisplayItems(messages: any[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          items.push({ type: "text", text: part.text });
        } else if (part.type === "toolCall") {
          items.push({ type: "toolCall", name: part.name, args: part.arguments });
        }
      }
    }
  }
  return items;
}

export function getResultSummaryText(r: SingleResult): string {
  const finalText = getFinalOutput(r.messages);
  if (finalText) return finalText;
  if (r.errorMessage) return r.errorMessage;
  if (r.exitCode > 0 && r.stderr.trim()) return r.stderr.trim();
  return "(no output)";
}
