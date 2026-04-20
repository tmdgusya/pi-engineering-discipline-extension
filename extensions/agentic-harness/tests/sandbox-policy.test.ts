import { describe, expect, it } from "vitest";
import { decideSandboxPolicy, makePolicyFingerprint } from "../sandbox/policy-engine.js";

describe("sandbox policy engine", () => {
  it("returns sandboxed decision when capability is available", () => {
    const decision = decideSandboxPolicy(
      {
        platform: "linux",
        cwd: "/repo",
        workspaceRoot: "/repo",
        fsMode: "workspace-write",
        networkMode: "off",
      },
      { supported: true },
    );
    expect(decision.mode).toBe("sandboxed");
    expect(decision.requiresApproval).toBe(false);
  });

  it("returns unsandboxed+approval decision when capability is unavailable", () => {
    const decision = decideSandboxPolicy(
      {
        platform: "darwin",
        cwd: "/repo",
        workspaceRoot: "/repo",
        fsMode: "workspace-write",
        networkMode: "off",
      },
      { supported: false, reason: "sandbox tool missing" },
    );
    expect(decision.mode).toBe("unsandboxed");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain("missing");
  });

  it("generates stable fingerprint for same policy input", () => {
    const input = {
      platform: "linux" as const,
      cwd: "/repo",
      workspaceRoot: "/repo",
      fsMode: "workspace-write" as const,
      networkMode: "off" as const,
    };
    expect(makePolicyFingerprint(input)).toBe(makePolicyFingerprint(input));
  });
});

