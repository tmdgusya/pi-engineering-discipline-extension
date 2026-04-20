import { spawn } from "child_process";
import type { BashOperations } from "@mariozechner/pi-coding-agent";
import { resolveSandboxLaunch } from "./executor.js";
import type { SandboxRuntimeOptions } from "./types.js";
import { getDefaultApprovalStore } from "./approval-store.js";

function killProcessTree(pid: number): void {
  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
    else process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}

export function createSandboxedBashOperations(sandbox: Omit<SandboxRuntimeOptions, "approvalStore">): BashOperations {
  return {
    async exec(command, cwd, options) {
      const resolvedSandbox = await resolveSandboxLaunch({
        command: "bash",
        args: ["-lc", command],
        cwd,
        env: options.env || process.env,
        platform: process.platform,
        sandbox: {
          ...sandbox,
          approvalStore: getDefaultApprovalStore(),
        },
      });

      return await new Promise<{ exitCode: number | null }>((resolve, reject) => {
        let cleanedUp = false;
        const cleanupOnce = async () => {
          if (cleanedUp) return;
          cleanedUp = true;
          await resolvedSandbox.cleanup?.().catch(() => undefined);
        };
        const child = spawn(resolvedSandbox.command, resolvedSandbox.args, {
          cwd,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: resolvedSandbox.env,
          shell: false,
        });

        const pid = child.pid ?? 0;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        if (options.timeout && options.timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (pid) killProcessTree(pid);
          }, options.timeout * 1000);
        }

        child.stdout?.on("data", options.onData);
        child.stderr?.on("data", options.onData);
        child.on("error", async (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          await cleanupOnce();
          reject(err);
        });

        const onAbort = () => {
          if (pid) killProcessTree(pid);
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });

        child.on("close", async (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          options.signal?.removeEventListener("abort", onAbort);
          await cleanupOnce();
          if (options.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          if (timedOut) {
            reject(new Error(`timeout:${options.timeout}`));
            return;
          }
          resolve({ exitCode: code });
        });
      });
    },
  };
}
