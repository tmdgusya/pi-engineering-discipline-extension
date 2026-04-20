import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FileApprovalStore } from "../sandbox/approval-store.js";

describe("FileApprovalStore", () => {
  it("persists always approvals across instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-store-"));
    const file = join(dir, "sandbox-approvals.json");

    const storeA = new FileApprovalStore(file);
    await storeA.setApprovedScope("k1", "always");

    const storeB = new FileApprovalStore(file);
    expect(storeB.getApprovedScope("k1")).toBe("always");
  });

  it("persists session approvals with expiration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-store-"));
    const file = join(dir, "sandbox-approvals.json");

    const storeA = new FileApprovalStore(file);
    await storeA.setApprovedScope("k2", "session");

    const storeB = new FileApprovalStore(file);
    expect(storeB.getApprovedScope("k2")).toBe("session");
  });

  it("loads legacy v1 format as always approvals", () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-store-"));
    const file = join(dir, "sandbox-approvals.json");
    writeFileSync(
      file,
      JSON.stringify({ version: 1, approvals: { legacy: true } }, null, 2),
      "utf-8",
    );

    const store = new FileApprovalStore(file);
    expect(store.getApprovedScope("legacy")).toBe("always");
  });
});
