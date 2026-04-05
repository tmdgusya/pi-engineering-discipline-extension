import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename } from "path";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import type { AgentConfig } from "./agents.js";

// ============================================================
// Types
// ============================================================

export interface SubagentResult {
  output: string;
  exitCode: number;
  error?: string;
}

// ============================================================
// Constants
// ============================================================

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
const KILL_TIMEOUT_MS = 5000;

// ============================================================
// Helpers (exported for testing)
// ============================================================

export function getPiInvocation(): { command: string; args: string[] } {
  const mainScript = process.argv[1];
  if (mainScript && existsSync(mainScript)) {
    const execName = basename(process.execPath).toLowerCase();
    if (
      execName === "node" ||
      execName === "bun" ||
      execName.startsWith("node.") ||
      execName.startsWith("bun.")
    ) {
      return { command: process.execPath, args: [mainScript] };
    }
    return { command: process.execPath, args: [] };
  }
  return { command: "pi", args: [] };
}

export function extractFinalOutput(stdout: string): string {
  const lines = stdout.split("\n");
  const messages: any[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "message_end" && event.message) {
        messages.push(event.message);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        if (msg.content[j].type === "text" && msg.content[j].text?.trim()) {
          return msg.content[j].text;
        }
      }
    }
  }

  return "";
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

// ============================================================
// Core Execution
// ============================================================

async function writeTempSystemPrompt(content: string): Promise<string> {
  const filename = `pi-subagent-${randomBytes(8).toString("hex")}.md`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

export async function runSingleAgent(
  agent: AgentConfig | undefined,
  task: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  const invocation = getPiInvocation();
  const args = [...invocation.args, "--mode", "json", "-p", "--no-session"];

  if (agent?.model) args.push("--model", agent.model);
  if (agent?.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  let tmpPromptPath: string | undefined;

  try {
    if (agent?.systemPrompt) {
      tmpPromptPath = await writeTempSystemPrompt(agent.systemPrompt);
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);

    return await new Promise<SubagentResult>((resolve) => {
      const proc = spawn(invocation.command, args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let wasAborted = false;

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, KILL_TIMEOUT_MS);
        };
        if (signal.aborted) {
          killProc();
        } else {
          signal.addEventListener("abort", killProc, { once: true });
        }
      }

      proc.on("close", (code) => {
        if (wasAborted) {
          resolve({
            output: "",
            exitCode: code ?? 1,
            error: "Subagent was aborted",
          });
          return;
        }
        const output = extractFinalOutput(stdout);
        resolve({
          output,
          exitCode: code ?? 0,
          error: code !== 0 ? stderr.trim() || undefined : undefined,
        });
      });

      proc.on("error", (err) => {
        resolve({ output: "", exitCode: 1, error: err.message });
      });
    });
  } finally {
    if (tmpPromptPath) {
      await unlink(tmpPromptPath).catch(() => {});
    }
  }
}

export async function runParallel(
  tasks: { agent: AgentConfig | undefined; task: string; cwd?: string }[],
  defaultCwd: string,
  signal?: AbortSignal,
): Promise<SubagentResult[]> {
  if (tasks.length > MAX_PARALLEL_TASKS) {
    throw new Error(
      `Maximum ${MAX_PARALLEL_TASKS} parallel tasks allowed, got ${tasks.length}`,
    );
  }

  return mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (item) => {
    return runSingleAgent(
      item.agent,
      item.task,
      item.cwd || defaultCwd,
      signal,
    );
  });
}

export async function runChain(
  steps: { agent: AgentConfig | undefined; task: string; cwd?: string }[],
  defaultCwd: string,
  signal?: AbortSignal,
): Promise<{ finalResult: SubagentResult; allResults: SubagentResult[] }> {
  const allResults: SubagentResult[] = [];
  let previousOutput = "";

  for (const step of steps) {
    const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
    const result = await runSingleAgent(
      step.agent,
      taskWithContext,
      step.cwd || defaultCwd,
      signal,
    );
    allResults.push(result);

    if (result.exitCode !== 0) {
      return { finalResult: result, allResults };
    }

    previousOutput = result.output;
  }

  return {
    finalResult: allResults[allResults.length - 1],
    allResults,
  };
}
