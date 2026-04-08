// subagent.ts
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename } from "path";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import type { AgentConfig } from "./agents.js";
import type { SingleResult, SubagentDetails } from "./types.js";
import { emptyUsage, getFinalOutput } from "./types.js";
import { processPiJsonLine } from "./runner-events.js";
import { getInheritedCliArgs } from "./runner-cli.js";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
const KILL_TIMEOUT_MS = 5000;
const AGENT_END_GRACE_MS = 250;

const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_MAX_DEPTH_ENV = "PI_SUBAGENT_MAX_DEPTH";
const SUBAGENT_STACK_ENV = "PI_SUBAGENT_STACK";
const SUBAGENT_PREVENT_CYCLES_ENV = "PI_SUBAGENT_PREVENT_CYCLES";

export const DEFAULT_MAX_DEPTH = 3;

export interface DepthConfig {
  currentDepth: number;
  maxDepth: number;
  canDelegate: boolean;
  ancestorStack: string[];
  preventCycles: boolean;
}

export function resolveDepthConfig(): DepthConfig {
  const raw = process.env[SUBAGENT_DEPTH_ENV];
  const currentDepth = raw ? parseInt(raw, 10) || 0 : 0;
  const maxRaw = process.env[SUBAGENT_MAX_DEPTH_ENV];
  const maxDepth = maxRaw ? parseInt(maxRaw, 10) || DEFAULT_MAX_DEPTH : DEFAULT_MAX_DEPTH;
  const stackRaw = process.env[SUBAGENT_STACK_ENV];
  let ancestorStack: string[] = [];
  if (stackRaw) {
    try { ancestorStack = JSON.parse(stackRaw); } catch { /* ignore */ }
  }
  const cycleRaw = process.env[SUBAGENT_PREVENT_CYCLES_ENV];
  const preventCycles = cycleRaw ? cycleRaw !== "0" : true;
  return {
    currentDepth,
    maxDepth,
    canDelegate: currentDepth < maxDepth,
    ancestorStack,
    preventCycles,
  };
}

export function getCycleViolations(requested: string[], stack: string[]): string[] {
  if (requested.length === 0 || stack.length === 0) return [];
  const stackSet = new Set(stack);
  return requested.filter((name) => stackSet.has(name));
}

function isTransientRunnerScript(mainScript: string | undefined): boolean {
  const normalizedMainScript = mainScript?.replace(/\\/g, "/").toLowerCase() ?? "";
  const runnerMarkers = [
    "/vite-node/",
    "/vitest/",
    "/vite/",
    "/tsx/",
    "/ts-node/",
    "/node_modules/vitest.mjs",
    "/node_modules/vite.mjs",
  ];

  return runnerMarkers.some((marker) => normalizedMainScript.includes(marker));
}

export function getPiInvocation(): { command: string; args: string[] } {
  const mainScript = process.argv[1];
  const isTransientRunner = isTransientRunnerScript(mainScript);

  if (!isTransientRunner && mainScript && existsSync(mainScript)) {
    const execName = basename(process.execPath).toLowerCase();
    if (execName === "node" || execName === "bun" || execName.startsWith("node.") || execName.startsWith("bun.")) {
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
      if (event.type === "message_end" && event.message) messages.push(event.message);
    } catch { /* skip */ }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        if (msg.content[j].type === "text" && msg.content[j].text?.trim()) return msg.content[j].text;
      }
    }
  }
  return "";
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>,
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

async function writeTempSystemPrompt(content: string): Promise<string> {
  const filename = `pi-subagent-${randomBytes(8).toString("hex")}.md`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

function buildPiArgs(agent: AgentConfig | undefined, systemPromptPath: string | null, task: string): string[] {
  const inherited = getInheritedCliArgs();
  const args = [
    "--mode", "json",
    ...inherited.extensionArgs,
    ...inherited.alwaysProxy,
    "-p",
    "--no-session",
  ];

  const model = agent?.model ?? inherited.fallbackModel;
  if (model) args.push("--model", model);

  const thinking = inherited.fallbackThinking;
  if (thinking) args.push("--thinking", thinking);

  if (agent?.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  } else if (agent?.tools === undefined) {
    if (inherited.fallbackTools) args.push("--tools", inherited.fallbackTools);
    else if (inherited.fallbackNoTools) args.push("--no-tools");
  }

  if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
  args.push(`Task: ${task}`);
  return args;
}

type OnUpdateCallback = (partial: { content: Array<{ type: "text"; text: string }>; details: SubagentDetails | undefined }) => void;

export interface RunAgentOptions {
  agent: AgentConfig | undefined;
  agentName: string;
  task: string;
  cwd: string;
  depthConfig: DepthConfig;
  signal?: AbortSignal;
  onUpdate?: OnUpdateCallback;
  makeDetails: (results: SingleResult[]) => SubagentDetails;
}

export async function runAgent(opts: RunAgentOptions): Promise<SingleResult> {
  const { agent, agentName, task, cwd, depthConfig, signal, onUpdate, makeDetails } = opts;

  if (!agent) {
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}".`,
      usage: emptyUsage(),
      stopReason: "error",
      errorMessage: `Unknown agent: "${agentName}".`,
    };
  }

  const result: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    model: agent.model,
  };

  const emitUpdate = () => {
    onUpdate?.({
      content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
      details: makeDetails([result]),
    });
  };

  const invocation = getPiInvocation();
  let tmpPromptPath: string | undefined;

  try {
    if (agent.systemPrompt?.trim()) {
      tmpPromptPath = await writeTempSystemPrompt(agent.systemPrompt);
    }

    const piArgs = buildPiArgs(agent, tmpPromptPath || null, task);
    const allArgs = [...invocation.args, ...piArgs];

    const nextDepth = depthConfig.currentDepth + 1;
    const propagatedStack = [...depthConfig.ancestorStack, agentName];

    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(invocation.command, allArgs, {
        cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          [SUBAGENT_DEPTH_ENV]: String(nextDepth),
          [SUBAGENT_MAX_DEPTH_ENV]: String(depthConfig.maxDepth),
          [SUBAGENT_STACK_ENV]: JSON.stringify(propagatedStack),
          [SUBAGENT_PREVENT_CYCLES_ENV]: depthConfig.preventCycles ? "1" : "0",
        },
      });

      proc.stdin.on("error", () => { /* ignore broken pipe */ });
      proc.stdin.end();

      let buffer = "";
      let didClose = false;
      let settled = false;
      let abortHandler: (() => void) | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        resolve(code);
      };

      const terminateChild = () => {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, KILL_TIMEOUT_MS);
      };

      const flushLine = (line: string) => {
        if (processPiJsonLine(line, result)) emitUpdate();
        // If agent_end seen, give a grace period then finish
        if (result.sawAgentEnd && !didClose && !settled) {
          if (graceTimer) clearTimeout(graceTimer);
          graceTimer = setTimeout(() => {
            if (!didClose && !settled && result.sawAgentEnd) {
              finish(0);
              terminateChild();
            }
          }, AGENT_END_GRACE_MS);
        }
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) flushLine(line);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        result.stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        didClose = true;
        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            if (line.trim()) flushLine(line);
          }
        }
        finish(code ?? 0);
      });

      proc.on("error", (err) => {
        if (!result.stderr.trim()) result.stderr = err.message;
        finish(1);
      });

      if (signal) {
        abortHandler = () => {
          if (didClose || settled) return;
          wasAborted = true;
          terminateChild();
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    result.exitCode = exitCode;

    // Normalize: if agent completed semantically but process exited non-zero
    if (wasAborted) {
      if (result.sawAgentEnd && getFinalOutput(result.messages).trim()) {
        result.exitCode = 0;
      } else {
        result.exitCode = 130;
        result.stopReason = "aborted";
        result.errorMessage = "Subagent was aborted.";
      }
    } else if (result.exitCode > 0 && result.sawAgentEnd && getFinalOutput(result.messages).trim()) {
      result.exitCode = 0;
      if (result.stopReason === "error") result.stopReason = undefined;
    } else if (result.exitCode > 0) {
      if (!result.stopReason) result.stopReason = "error";
      if (!result.errorMessage && result.stderr.trim()) result.errorMessage = result.stderr.trim();
    }

    return result;
  } finally {
    if (tmpPromptPath) await unlink(tmpPromptPath).catch(() => {});
  }
}
