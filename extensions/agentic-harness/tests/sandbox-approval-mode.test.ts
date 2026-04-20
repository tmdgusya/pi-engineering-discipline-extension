import { describe, expect, it } from "vitest";
import { parseSandboxApprovalMode } from "../sandbox/approval-mode.js";

describe("parseSandboxApprovalMode", () => {
  it("defaults to ask when env is unset", () => {
    expect(parseSandboxApprovalMode(undefined)).toEqual({ mode: "ask" });
  });

  it("parses ask", () => {
    expect(parseSandboxApprovalMode("ask")).toEqual({ mode: "ask" });
  });

  it("parses always", () => {
    expect(parseSandboxApprovalMode("always")).toEqual({ mode: "always" });
  });

  it("parses deny", () => {
    expect(parseSandboxApprovalMode("deny")).toEqual({ mode: "deny" });
  });

  it("falls back to ask for invalid values", () => {
    expect(parseSandboxApprovalMode("invalid-value")).toEqual({
      mode: "ask",
      invalidRawValue: "invalid-value",
    });
  });
});
