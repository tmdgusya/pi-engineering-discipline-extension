import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";
import type { ApprovalScope, ApprovalStore } from "./types.js";

interface ApprovalFile {
  version: 1;
  approvals: Record<string, true>;
}

const DEFAULT_APPROVAL_FILE = join(homedir(), ".pi", "agent", "sandbox-approvals.json");

export class FileApprovalStore implements ApprovalStore {
  private readonly sessionApprovals = new Map<string, "session" | "always">();
  private loaded = false;
  private readonly alwaysApprovals = new Set<string>();

  constructor(private readonly filePath: string = DEFAULT_APPROVAL_FILE) {}

  getApprovedScope(key: string): ApprovalScope | undefined {
    const session = this.sessionApprovals.get(key);
    if (session) return session;
    this.ensureLoadedSync();
    return this.alwaysApprovals.has(key) ? "always" : undefined;
  }

  async setApprovedScope(key: string, scope: "session" | "always"): Promise<void> {
    this.sessionApprovals.set(key, scope);
    if (scope !== "always") return;

    await this.ensureLoaded();
    this.alwaysApprovals.add(key);
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload: ApprovalFile = {
      version: 1,
      approvals: Object.fromEntries([...this.alwaysApprovals].map((item) => [item, true])),
    };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private ensureLoadedSync(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as ApprovalFile;
      if (data && data.version === 1 && data.approvals && typeof data.approvals === "object") {
        for (const key of Object.keys(data.approvals)) this.alwaysApprovals.add(key);
      }
    } catch {
      // corrupt store is treated as empty
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as ApprovalFile;
      if (data && data.version === 1 && data.approvals && typeof data.approvals === "object") {
        for (const key of Object.keys(data.approvals)) this.alwaysApprovals.add(key);
      }
    } catch {
      // missing or corrupt store is treated as empty
    }
  }
}

let defaultStore: FileApprovalStore | undefined;

export function getDefaultApprovalStore(): FileApprovalStore {
  if (!defaultStore) defaultStore = new FileApprovalStore();
  return defaultStore;
}
