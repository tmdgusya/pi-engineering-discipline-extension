import { createHash } from "crypto";
import type { SandboxCapability, SandboxDecision, SandboxPolicyInput } from "./types.js";

export function makePolicyFingerprint(input: SandboxPolicyInput): string {
  const payload = JSON.stringify({
    platform: input.platform,
    workspaceRoot: input.workspaceRoot,
    fsMode: input.fsMode,
    networkMode: input.networkMode,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function decideSandboxPolicy(input: SandboxPolicyInput, capability: SandboxCapability): SandboxDecision {
  const policyFingerprint = makePolicyFingerprint(input);
  if (capability.supported) {
    return {
      mode: "sandboxed",
      requiresApproval: false,
      policyFingerprint,
      fsMode: input.fsMode,
      networkMode: input.networkMode,
    };
  }

  return {
    mode: "unsandboxed",
    requiresApproval: true,
    reason: capability.reason || "Sandbox capability unavailable.",
    policyFingerprint,
    fsMode: input.fsMode,
    networkMode: input.networkMode,
  };
}

