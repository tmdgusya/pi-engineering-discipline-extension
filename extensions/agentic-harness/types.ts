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

export interface NestedSubagentCall {
  agent: string;
  task: string;
}

export interface OutputTruncationMetadata {
  truncated: boolean;
  originalLength: number;
  returnedLength: number;
  maxOutput: number;
}

export interface ArtifactMetadata {
  artifactDir?: string;
  outputFile?: string;
  progressFile?: string;
  readFiles?: string[];
  artifactError?: string;
}

export interface WorktreeMetadata {
  logicalCwd?: string;
  worktreePath?: string;
  worktreeDiffFile?: string;
  worktreeCleanupStatus?: "not-needed" | "removed" | "failed" | "kept";
  worktreeError?: string;
}

export interface TerminalMetadata {
  backend: "native" | "tmux";
  sessionName?: string;
  windowName?: string;
  paneId?: string;
  attachCommand?: string;
  logFile?: string;
  tmuxBinary?: string;
  sessionAttempt?: string;
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
  nestedCalls?: NestedSubagentCall[];
  maxOutput?: number;
  outputTruncation?: OutputTruncationMetadata;
  artifacts?: ArtifactMetadata;
  contextMode?: "fresh" | "fork";
  contextError?: string;
  worktree?: WorktreeMetadata;
  terminal?: TerminalMetadata;
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

/** Create an empty UsageStats object. */
export function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** Sum usage across multiple results. */
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

/** Whether a result represents a successful completion. */
export function isResultSuccess(r: SingleResult): boolean {
  if (r.exitCode === -1) return false;
  return r.exitCode === 0 && r.stopReason !== "error" && r.stopReason !== "aborted";
}

/** Whether a result represents an error. */
export function isResultError(r: SingleResult): boolean {
  if (r.exitCode === -1) return false;
  return !isResultSuccess(r);
}

/** Extract the last assistant text from a message history. */
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

/** Extract all display-worthy items from a message history. */
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

export function truncateForModel(text: string, maxOutput: number | undefined): { text: string; metadata?: OutputTruncationMetadata } {
  if (!maxOutput || maxOutput <= 0 || text.length <= maxOutput) return { text };
  const marker = `\n\n[truncated: ${text.length} -> ${maxOutput} chars]`;
  let truncated: string;
  if (marker.length >= maxOutput) {
    truncated = marker.slice(marker.length - maxOutput);
  } else {
    const separator = "\n…\n";
    const bodyLimit = Math.max(0, maxOutput - marker.length - separator.length);
    const headLength = Math.ceil(bodyLimit * 0.7);
    const tailLength = Math.max(0, bodyLimit - headLength);
    truncated = tailLength > 0
      ? `${text.slice(0, headLength)}${separator}${text.slice(text.length - tailLength)}${marker}`
      : `${text.slice(0, maxOutput - marker.length)}${marker}`;
  }
  return {
    text: truncated,
    metadata: {
      truncated: true,
      originalLength: text.length,
      returnedLength: truncated.length,
      maxOutput,
    },
  };
}

/** Get a human-readable summary text from a result. */
export function getResultSummaryText(r: SingleResult, maxOutput?: number): string {
  const finalText = getFinalOutput(r.messages);
  const raw = finalText || r.errorMessage || (r.exitCode > 0 && r.stderr.trim() ? r.stderr.trim() : "(no output)");
  const limit = maxOutput ?? r.maxOutput;
  const { text, metadata } = truncateForModel(raw, limit);
  if (metadata) r.outputTruncation = metadata;
  if (limit) r.maxOutput = limit;
  return text;
}
