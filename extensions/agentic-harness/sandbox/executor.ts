import { buildLinuxSandboxLaunch, detectLinuxSandboxCapability } from "./adapters/linux.js";
import { buildMacSandboxLaunch, detectMacSandboxCapability } from "./adapters/macos.js";
import { decideSandboxPolicy } from "./policy-engine.js";
import type { ApprovalResult, SandboxRuntimeOptions } from "./types.js";

export interface SandboxLaunchResult {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  applied: boolean;
  cleanup?: () => Promise<void>;
}

interface ResolveSandboxLaunchOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  sandbox?: SandboxRuntimeOptions;
}

function makeApprovalKey(policyFingerprint: string, fallbackReason: string): string {
  return `${policyFingerprint}:${fallbackReason}`;
}

async function resolveUnsandboxedApproval(
  policyFingerprint: string,
  fallbackReason: string,
  command: string,
  args: string[],
  cwd: string,
  sandbox: SandboxRuntimeOptions,
): Promise<boolean> {
  const approvalMode = sandbox.approvalMode || "ask";
  if (approvalMode === "always") {
    const rendered = `${command} ${args.join(" ")}`.trim();
    console.warn(`[agentic-harness] YOLO auto-allowed unsandboxed fallback: reason="${fallbackReason}", command="${rendered}"`);
    return true;
  }
  if (approvalMode === "deny") return false;

  const key = makeApprovalKey(policyFingerprint, fallbackReason);
  const cached = sandbox.approvalStore?.getApprovedScope(key);
  if (cached === "session" || cached === "always") return true;

  if (!sandbox.approvalResolver) return false;
  const result: ApprovalResult = await sandbox.approvalResolver({
    reason: fallbackReason,
    command,
    args,
    cwd,
    policyFingerprint,
  });
  if (!result.approved) return false;
  if (result.scope === "session" || result.scope === "always") {
    await sandbox.approvalStore?.setApprovedScope(key, result.scope);
  }
  return true;
}

export async function resolveSandboxLaunch(opts: ResolveSandboxLaunchOptions): Promise<SandboxLaunchResult> {
  const { command, args, cwd, env, platform, sandbox } = opts;
  if (!sandbox?.enabled) {
    return { command, args, env, applied: false };
  }

  const workspaceRoot = sandbox.workspaceRoot || cwd;
  const additionalWritableRoots = sandbox.additionalWritableRoots || [];
  const networkMode = sandbox.networkMode || "off";
  const fsMode = "workspace-write";

  const capability =
    platform === "linux"
      ? detectLinuxSandboxCapability(platform)
      : platform === "darwin"
        ? detectMacSandboxCapability(platform)
        : { supported: false, reason: `Unsupported platform for phase-1 sandbox: ${platform}` };

  const decision = decideSandboxPolicy(
    { platform, cwd, workspaceRoot, fsMode, networkMode },
    capability,
  );

  if (decision.mode === "sandboxed") {
    if (platform === "linux") {
      const launch = buildLinuxSandboxLaunch(command, args, cwd, workspaceRoot, networkMode, additionalWritableRoots);
      return { command: launch.command, args: launch.args, env, applied: true };
    }
    if (platform === "darwin") {
      const launch = await buildMacSandboxLaunch(command, args, workspaceRoot, networkMode, additionalWritableRoots);
      return { command: launch.command, args: launch.args, env, applied: true, cleanup: launch.cleanup };
    }
  }

  const fallbackReason = decision.reason || "Sandbox unavailable.";
  const approved = await resolveUnsandboxedApproval(
    decision.policyFingerprint,
    fallbackReason,
    command,
    args,
    cwd,
    sandbox,
  );
  if (!approved) {
    throw new Error(`Sandbox required but unavailable: ${fallbackReason}`);
  }
  return { command, args, env, applied: false };
}
