import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";
import type { ApprovalScope, ApprovalStore } from "./types.js";

interface ApprovalFileV1 {
  version: 1;
  approvals: Record<string, true>;
}

interface ApprovalFileV2 {
  version: 2;
  approvals: Record<string, { scope: "always" | "session"; expiresAt?: number }>;
}

const DEFAULT_SESSION_TTL_MS = Number.parseInt(process.env.PI_SANDBOX_SESSION_APPROVAL_TTL_MS || "21600000", 10); // 6h

function resolvePiAgentDir(envDir = process.env.PI_CODING_AGENT_DIR, homeDir = homedir()): string {
  if (!envDir) return join(homeDir, ".pi", "agent");
  if (envDir === "~") return homeDir;
  if (envDir.startsWith("~/")) return join(homeDir, envDir.slice(2));
  return envDir;
}

const DEFAULT_APPROVAL_FILE = join(resolvePiAgentDir(), "sandbox-approvals.json");

export class FileApprovalStore implements ApprovalStore {
  private readonly sessionApprovals = new Map<string, "session" | "always">();
  private loaded = false;
  private readonly alwaysApprovals = new Set<string>();
  private readonly persistedSessionApprovals = new Map<string, number>();

  constructor(private readonly filePath: string = DEFAULT_APPROVAL_FILE) {}

  getApprovedScope(key: string): ApprovalScope | undefined {
    const session = this.sessionApprovals.get(key);
    if (session) return session;
    this.ensureLoadedSync();
    if (this.alwaysApprovals.has(key)) return "always";

    const expiresAt = this.persistedSessionApprovals.get(key);
    if (!expiresAt) return undefined;
    if (Date.now() <= expiresAt) return "session";
    this.persistedSessionApprovals.delete(key);
    return undefined;
  }

  async setApprovedScope(key: string, scope: "session" | "always"): Promise<void> {
    this.sessionApprovals.set(key, scope);

    await this.ensureLoaded();
    if (scope === "always") {
      this.alwaysApprovals.add(key);
      this.persistedSessionApprovals.delete(key);
    } else {
      const ttlMs = Number.isFinite(DEFAULT_SESSION_TTL_MS) && DEFAULT_SESSION_TTL_MS > 0
        ? DEFAULT_SESSION_TTL_MS
        : 21600000;
      this.persistedSessionApprovals.set(key, Date.now() + ttlMs);
    }

    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const approvals: ApprovalFileV2["approvals"] = {};
    for (const key of this.alwaysApprovals) approvals[key] = { scope: "always" };
    const now = Date.now();
    for (const [key, expiresAt] of this.persistedSessionApprovals) {
      if (expiresAt > now) approvals[key] = { scope: "session", expiresAt };
    }

    const payload: ApprovalFileV2 = {
      version: 2,
      approvals,
    };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private loadFromRaw(raw: string): void {
    const data = JSON.parse(raw) as ApprovalFileV1 | ApprovalFileV2;
    if (!data || typeof data !== "object") return;

    if ((data as ApprovalFileV1).version === 1) {
      const v1 = data as ApprovalFileV1;
      if (v1.approvals && typeof v1.approvals === "object") {
        for (const key of Object.keys(v1.approvals)) this.alwaysApprovals.add(key);
      }
      return;
    }

    if ((data as ApprovalFileV2).version === 2) {
      const v2 = data as ApprovalFileV2;
      if (!v2.approvals || typeof v2.approvals !== "object") return;
      const now = Date.now();
      for (const [key, value] of Object.entries(v2.approvals)) {
        if (!value || typeof value !== "object") continue;
        if (value.scope === "always") {
          this.alwaysApprovals.add(key);
          continue;
        }
        if (value.scope === "session" && typeof value.expiresAt === "number" && value.expiresAt > now) {
          this.persistedSessionApprovals.set(key, value.expiresAt);
        }
      }
    }
  }

  private ensureLoadedSync(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      this.loadFromRaw(raw);
    } catch {
      // corrupt store is treated as empty
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.loadFromRaw(raw);
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
