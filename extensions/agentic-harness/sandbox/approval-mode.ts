import type { SandboxApprovalMode } from "./types.js";

export interface ParsedSandboxApprovalMode {
  mode: SandboxApprovalMode;
  invalidRawValue?: string;
}

export function parseSandboxApprovalMode(raw: string | undefined): ParsedSandboxApprovalMode {
  if (!raw) return { mode: "ask" };
  const normalized = raw.trim().toLowerCase();
  if (normalized === "ask" || normalized === "always" || normalized === "deny") {
    return { mode: normalized };
  }
  return { mode: "ask", invalidRawValue: raw };
}
