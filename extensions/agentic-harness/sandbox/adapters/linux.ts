import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import type { SandboxCapability, SandboxNetworkMode } from "../types.js";

export interface LinuxSandboxLaunch {
  command: string;
  args: string[];
}

function commandExists(command: string): boolean {
  const which = spawnSync("which", [command], { encoding: "utf-8" });
  return which.status === 0;
}

export function detectLinuxSandboxCapability(platform: NodeJS.Platform): SandboxCapability {
  if (platform !== "linux") {
    return { supported: false, reason: "Linux sandbox adapter is only available on linux." };
  }
  if (!commandExists("bwrap")) {
    return { supported: false, reason: "bubblewrap (bwrap) is not installed on this host." };
  }
  return { supported: true };
}

export function buildLinuxSandboxLaunch(
  command: string,
  args: string[],
  cwd: string,
  workspaceRoot: string,
  networkMode: SandboxNetworkMode,
  additionalWritableRoots: string[] = [],
): LinuxSandboxLaunch {
  const resolvedWorkspace = resolve(workspaceRoot);
  const resolvedCwd = resolve(cwd);
  if (!resolvedCwd.startsWith(resolvedWorkspace)) {
    throw new Error(`Sandbox denied: cwd "${resolvedCwd}" is outside workspace root "${resolvedWorkspace}".`);
  }

  const bwrapArgs = [
    "--die-with-parent",
    "--new-session",
    "--ro-bind", "/", "/",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--bind", resolvedWorkspace, resolvedWorkspace,
    "--chdir", resolvedCwd,
  ];

  const extraRoots = Array.from(new Set(
    additionalWritableRoots
      .map((root) => resolve(root))
      .filter((root) => root && root !== resolvedWorkspace && existsSync(root)),
  ));
  for (const root of extraRoots) {
    bwrapArgs.push("--bind", root, root);
  }

  if (networkMode === "off") bwrapArgs.push("--unshare-net");

  bwrapArgs.push("--", command, ...args);
  return { command: "bwrap", args: bwrapArgs };
}
