import { spawnSync } from "child_process";
import { randomBytes } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import type { SandboxCapability, SandboxNetworkMode } from "../types.js";

export interface MacSandboxLaunch {
  command: string;
  args: string[];
  cleanup: () => Promise<void>;
}

function commandExists(command: string): boolean {
  const which = spawnSync("which", [command], { encoding: "utf-8" });
  return which.status === 0;
}

export function detectMacSandboxCapability(platform: NodeJS.Platform): SandboxCapability {
  if (platform !== "darwin") {
    return { supported: false, reason: "macOS sandbox adapter is only available on darwin." };
  }
  if (!commandExists("sandbox-exec")) {
    return { supported: false, reason: "sandbox-exec is not available on this host." };
  }
  return { supported: true };
}

function escapeSbplPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function buildProfile(workspaceRoot: string, networkMode: SandboxNetworkMode): string {
  const escapedWorkspace = escapeSbplPath(resolve(workspaceRoot));
  const escapedTmp = escapeSbplPath(tmpdir());
  const lines = [
    "(version 1)",
    "(deny default)",
    "(import \"system.sb\")",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow file-read*)",
    "(allow file-write*",
    `  (subpath \"${escapedWorkspace}\")`,
    "  (subpath \"/tmp\")",
    `  (subpath \"${escapedTmp}\")`,
    ")",
  ];
  if (networkMode === "on") lines.push("(allow network*)");
  return `${lines.join("\n")}\n`;
}

export async function buildMacSandboxLaunch(
  command: string,
  args: string[],
  workspaceRoot: string,
  networkMode: SandboxNetworkMode,
): Promise<MacSandboxLaunch> {
  const profilePath = join(tmpdir(), `pi-sandbox-${randomBytes(8).toString("hex")}.sb`);
  await writeFile(profilePath, buildProfile(workspaceRoot, networkMode), "utf-8");
  return {
    command: "sandbox-exec",
    args: ["-f", profilePath, command, ...args],
    cleanup: async () => {
      await unlink(profilePath).catch(() => undefined);
    },
  };
}
