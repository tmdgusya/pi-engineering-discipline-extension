import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FileApprovalStore } from "../sandbox/approval-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("FileApprovalStore", () => {
  it("stores session approvals in memory only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-approval-session-"));
    tempDirs.push(dir);
    const store = new FileApprovalStore(join(dir, "approvals.json"));

    await store.setApprovedScope("k1", "session");
    expect(store.getApprovedScope("k1")).toBe("session");
  });

  it("persists always approvals to disk and reloads them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-approval-always-"));
    tempDirs.push(dir);
    const filePath = join(dir, "approvals.json");
    const store = new FileApprovalStore(filePath);
    await store.setApprovedScope("k2", "always");
    expect(store.getApprovedScope("k2")).toBe("always");

    const reloaded = new FileApprovalStore(filePath);
    expect(reloaded.getApprovedScope("k2")).toBe("always");
  });
});

