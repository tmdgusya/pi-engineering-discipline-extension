import type { SingleResult } from "./types.js";

const seenSignaturesKey = Symbol("seenMessageSignatures");

function getSeenSignatures(result: SingleResult): Set<string> {
  const r = result as any;
  if (!r[seenSignaturesKey]) {
    r[seenSignaturesKey] = new Set();
  }
  return r[seenSignaturesKey];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function getMessageSignature(message: unknown): string {
  return stableStringify(message);
}


function assistantTextParts(message: any): string[] {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string" && part.text.length > 0)
    .map((part: any) => part.text);
}

function clampRenderedLine(line: string, limit = 8000): string {
  if (line.length <= limit) return line;
  return `${line.slice(0, limit)}… [truncated ${line.length - limit} chars]`;
}

function renderPiEventForPane(event: any): string[] {
  if (!event || typeof event !== "object") return [];
  switch (event.type) {
    case "message_end":
    case "turn_end":
      return assistantTextParts(event.message).flatMap((text) => text.split(/\r?\n/).map(clampRenderedLine));
    case "agent_end":
      return ["✓ worker completed"];
    case "tool_start":
      return typeof event.name === "string" ? [`→ ${event.name}`] : [];
    case "tool_end":
      return typeof event.name === "string" ? [`✓ ${event.name}`] : [];
    default:
      return [];
  }
}

/**
 * Render a pi JSON-mode stdout line into human-readable tmux pane text.
 * Raw JSON event envelopes are intentionally suppressed; invalid non-empty
 * lines are passed through because they may be command output or diagnostics.
 */
export function renderPiJsonLineForPane(line: string): string[] {
  if (!line.trim()) return [];
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return [line];
  }
  return renderPiEventForPane(event);
}

function updateMetadata(result: SingleResult, message: any): void {
  if (message.role !== "assistant") return;
  if (!result.model && message.model) result.model = message.model;
  if (message.stopReason) result.stopReason = message.stopReason;
  if (message.errorMessage) result.errorMessage = message.errorMessage;
}

function addAssistantMessage(result: SingleResult, message: any): boolean {
  if (!message || message.role !== "assistant") return false;

  updateMetadata(result, message);

  const sig = getMessageSignature(message);
  const seen = getSeenSignatures(result);
  if (seen.has(sig)) return false;
  seen.add(sig);

  result.messages.push(message);
  result.usage.turns++;

  const usage = message.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || 0;
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (
        part?.type === "toolCall" &&
        part.name === "subagent" &&
        part.arguments
      ) {
        if (!result.nestedCalls) result.nestedCalls = [];
        const args = part.arguments as Record<string, unknown>;
        const agent = (args.agent as string) || "unknown";
        const task = typeof args.task === "string"
          ? args.task.slice(0, 120)
          : "(no task)";
        result.nestedCalls.push({ agent, task });
      }
    }
  }

  return true;
}

function addAssistantMessages(result: SingleResult, messages: any[]): boolean {
  if (!Array.isArray(messages)) return false;
  let changed = false;
  for (const msg of messages) {
    if (addAssistantMessage(result, msg)) changed = true;
  }
  return changed;
}

function processPiEvent(event: any, result: SingleResult): boolean {
  if (!event || typeof event !== "object") return false;
  switch (event.type) {
    case "message_end":
      return addAssistantMessage(result, event.message);
    case "turn_end":
      return addAssistantMessage(result, event.message);
    case "agent_end":
      result.sawAgentEnd = true;
      return addAssistantMessages(result, event.messages);
    default:
      return false;
  }
}


function extractAssistantText(message: any): string[] {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string" && part.text.length > 0)
    .map((part: any) => part.text);
}

export function renderPiEventForPane(event: any): string[] {
  if (!event || typeof event !== "object") return [];
  switch (event.type) {
    case "message_end":
    case "turn_end":
      return extractAssistantText(event.message);
    case "agent_end":
      return ["✓ worker completed"];
    default:
      return [];
  }
}

export function renderPiJsonLineForPane(line: string): string[] {
  if (!line.trim()) return [];
  try {
    return renderPiEventForPane(JSON.parse(line));
  } catch {
    return [line];
  }
}

/**
 * Parse a single JSON line from pi's stdout and update the result.
 * Returns true if the result changed (for triggering UI updates).
 */
export function processPiJsonLine(line: string, result: SingleResult): boolean {
  if (!line.trim()) return false;
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }
  return processPiEvent(event, result);
}
