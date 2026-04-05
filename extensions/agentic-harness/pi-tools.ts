/**
 * Central registry of pi-coding-agent built-in tool names.
 *
 * Single source of truth — import from here instead of hardcoding tool names.
 * Keep in sync with @mariozechner/pi-coding-agent's allTools export.
 */

export const PI_TOOL_NAMES = [
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export type PiToolName = (typeof PI_TOOL_NAMES)[number];

/** Set of all built-in tool names for O(1) membership checks. */
export const PI_TOOL_NAME_SET: ReadonlySet<string> = new Set(PI_TOOL_NAMES);
