// subagent.ts
import { spawn } from "child_process";
import { appendFile, mkdir, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename, dirname } from "path";
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
const SUBAGENT_RUN_ID_ENV = "PI_SUBAGENT_RUN_ID";
const SUBAGENT_PARENT_RUN_ID_ENV = "PI_SUBAGENT_PARENT_RUN_ID";
const SUBAGENT_ROOT_RUN_ID_ENV = "PI_SUBAGENT_ROOT_RUN_ID";
const SUBAGENT_OWNER_ENV = "PI_SUBAGENT_OWNER";
const SUBAGENT_PROCESS_LOG_ENV = "PI_SUBAGENT_PROCESS_LOG";

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

export interface RunOwnership {
  runId?: string;
  parentRunId?: string;
  rootRunId?: string;
  owner?: string;
}

export interface RunLifecycleEvent {
  phase: "spawned" | "terminating" | "closed";
  runId: string;
  parentRunId?: string;
  rootRunId: string;
  owner?: string;
  pid: number;
  pgid?: number;
  reason?: string;
  signal?: NodeJS.Signals;
  exitCode?: number | null;
}

export interface RunAgentOptions {
  agent: AgentConfig | undefined;
  agentName: string;
  task: string;
  cwd: string;
  depthConfig: DepthConfig;
  signal?: AbortSignal;
  ownership?: RunOwnership;
  extraEnv?: Record<string, string | undefined>;
  onUpdate?: OnUpdateCallback;
  onLifecycleEvent?: (event: RunLifecycleEvent) => void;
  makeDetails: (results: SingleResult[]) => SubagentDetails;
}

function generateRunId(): string {
  return randomBytes(8).toString("hex");
}

function resolveRunOwnership(ownership: RunOwnership | undefined, fallbackOwner: string): Required<Pick<RunOwnership, "runId" | "rootRunId">> & RunOwnership {
  const inheritedRunId = process.env[SUBAGENT_RUN_ID_ENV];
  const inheritedRootRunId = process.env[SUBAGENT_ROOT_RUN_ID_ENV];

  const runId = ownership?.runId || generateRunId();
  const parentRunId = ownership?.parentRunId ?? inheritedRunId;
  const rootRunId = ownership?.rootRunId || inheritedRootRunId || parentRunId || runId;
  const owner = ownership?.owner || process.env[SUBAGENT_OWNER_ENV] || fallbackOwner;

  return { runId, parentRunId, rootRunId, owner };
}

async function appendLifecycleLog(path: string | undefined, event: RunLifecycleEvent): Promise<void> {
  if (!path) return;
  const line = `${JSON.stringify({
    ts: new Date().toISOString(),
    event: "subagent.process",
    ...event,
  })}\n`;

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line, "utf-8");
}

export async function runAgent(opts: RunAgentOptions): Promise<SingleResult> {
  const {
    agent,
    agentName,
    task,
    cwd,
    depthConfig,
    signal,
    ownership,
    extraEnv,
    onUpdate,
    onLifecycleEvent,
    makeDetails,
  } = opts;

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
    const resolvedOwnership = resolveRunOwnership(ownership, agentName);
    const processLogPath = extraEnv?.[SUBAGENT_PROCESS_LOG_ENV] || process.env[SUBAGENT_PROCESS_LOG_ENV];

    let wasAborted = false;
    let semanticTerminationRequested = false;
    let closeSignal: NodeJS.Signals | undefined;
    const lifecycleWrites: Promise<void>[] = [];

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(invocation.command, allArgs, {
        cwd,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...extraEnv,
          [SUBAGENT_DEPTH_ENV]: String(nextDepth),
          [SUBAGENT_MAX_DEPTH_ENV]: String(depthConfig.maxDepth),
          [SUBAGENT_STACK_ENV]: JSON.stringify(propagatedStack),
          [SUBAGENT_PREVENT_CYCLES_ENV]: depthConfig.preventCycles ? "1" : "0",
          [SUBAGENT_RUN_ID_ENV]: resolvedOwnership.runId,
          [SUBAGENT_PARENT_RUN_ID_ENV]: resolvedOwnership.parentRunId,
          [SUBAGENT_ROOT_RUN_ID_ENV]: resolvedOwnership.rootRunId,
          [SUBAGENT_OWNER_ENV]: resolvedOwnership.owner,
        },
      });

      const pid = proc.pid ?? 0;
      const pgid = process.platform !== "win32" && pid > 0 ? pid : undefined;
      const emitLifecycle = (event: RunLifecycleEvent) => {
        onLifecycleEvent?.(event);
        lifecycleWrites.push(appendLifecycleLog(processLogPath, event).catch(() => undefined));
      };

      if (pid > 0) {
        emitLifecycle({
          phase: "spawned",
          runId: resolvedOwnership.runId,
          parentRunId: resolvedOwnership.parentRunId,
          rootRunId: resolvedOwnership.rootRunId,
          owner: resolvedOwnership.owner,
          pid,
          pgid,
        });
      }

      proc.stdin.on("error", () => { /* ignore broken pipe */ });
      proc.stdin.end();

      let buffer = "";
      let didClose = false;
      let settled = false;
      let abortHandler: (() => void) | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let terminationStarted = false;

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (killTimer) clearTimeout(killTimer);
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        resolve(code);
      };

      const sendSignal = (signalName: NodeJS.Signals) => {
        if (!pid) return;
        try {
          if (process.platform !== "win32") {
            process.kill(-pid, signalName);
          } else {
            proc.kill(signalName);
          }
        } catch (error: any) {
          if (error?.code !== "ESRCH") {
            throw error;
          }
        }
      };

      const requestTermination = (reason: string, signalName: NodeJS.Signals = "SIGTERM") => {
        if (didClose || !pid) return;
        if (!terminationStarted) {
          terminationStarted = true;
          emitLifecycle({
            phase: "terminating",
            runId: resolvedOwnership.runId,
            parentRunId: resolvedOwnership.parentRunId,
            rootRunId: resolvedOwnership.rootRunId,
            owner: resolvedOwnership.owner,
            pid,
            pgid,
            reason,
            signal: signalName,
          });
          sendSignal(signalName);
          killTimer = setTimeout(() => {
            if (didClose) return;
            emitLifecycle({
              phase: "terminating",
              runId: resolvedOwnership.runId,
              parentRunId: resolvedOwnership.parentRunId,
              rootRunId: resolvedOwnership.rootRunId,
              owner: resolvedOwnership.owner,
              pid,
              pgid,
              reason: `${reason}:escalated`,
              signal: "SIGKILL",
            });
            sendSignal("SIGKILL");
          }, KILL_TIMEOUT_MS);
          return;
        }

        if (signalName === "SIGKILL") {
          emitLifecycle({
            phase: "terminating",
            runId: resolvedOwnership.runId,
            parentRunId: resolvedOwnership.parentRunId,
            rootRunId: resolvedOwnership.rootRunId,
            owner: resolvedOwnership.owner,
            pid,
            pgid,
            reason,
            signal: signalName,
          });
          sendSignal(signalName);
        }
      };

      const flushLine = (line: string) => {
        if (processPiJsonLine(line, result)) emitUpdate();
        if (result.sawAgentEnd && !didClose && !settled) {
          if (graceTimer) clearTimeout(graceTimer);
          graceTimer = setTimeout(() => {
            if (!didClose && !settled && result.sawAgentEnd) {
              semanticTerminationRequested = true;
              requestTermination("agent_end_grace_elapsed");
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

      proc.on("close", (code, signalName) => {
        didClose = true;
        closeSignal = signalName ?? undefined;

        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            if (line.trim()) flushLine(line);
          }
        }

        if (pid > 0) {
          emitLifecycle({
            phase: "closed",
            runId: resolvedOwnership.runId,
            parentRunId: resolvedOwnership.parentRunId,
            rootRunId: resolvedOwnership.rootRunId,
            owner: resolvedOwnership.owner,
            pid,
            pgid,
            signal: closeSignal,
            exitCode: code ?? null,
          });
        }

        if (code !== null) {
          finish(code);
          return;
        }

        if (closeSignal === "SIGTERM") {
          finish(143);
          return;
        }

        if (closeSignal === "SIGKILL") {
          finish(137);
          return;
        }

        finish(1);
      });

      proc.on("error", (err) => {
        if (!result.stderr.trim()) result.stderr = err.message;
        finish(1);
      });

      if (signal) {
        abortHandler = () => {
          if (didClose || settled) return;

          const hasSemanticCompletion = result.sawAgentEnd && !!getFinalOutput(result.messages).trim();
          if (hasSemanticCompletion) {
            semanticTerminationRequested = true;
          } else {
            wasAborted = true;
          }

          requestTermination("abort_signal_received");
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    await Promise.allSettled(lifecycleWrites);
    result.exitCode = exitCode;

    const hasSemanticOutput = result.sawAgentEnd && !!getFinalOutput(result.messages).trim();
    const endedViaSemanticReap = semanticTerminationRequested && hasSemanticOutput && (closeSignal === "SIGTERM" || closeSignal === "SIGKILL");

    if (endedViaSemanticReap) {
      result.exitCode = 0;
      if (result.stopReason === "error") result.stopReason = undefined;
      result.errorMessage = undefined;
    } else if (wasAborted) {
      result.exitCode = 130;
      result.stopReason = "aborted";
      result.errorMessage = "Subagent was aborted.";
    } else if (result.exitCode > 0) {
      if (!result.stopReason) result.stopReason = "error";
      if (!result.errorMessage && result.stderr.trim()) result.errorMessage = result.stderr.trim();
    }

    return result;
  } finally {
    if (tmpPromptPath) await unlink(tmpPromptPath).catch(() => {});
  }
}
