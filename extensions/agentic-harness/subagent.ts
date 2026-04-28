// subagent.ts
import { execFile, spawn } from "child_process";
import { appendFile, mkdir, open, readFile, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename, dirname, relative } from "path";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import type { AgentConfig, SubagentContextMode } from "./agents.js";
import type { SingleResult, SubagentDetails } from "./types.js";
import { emptyUsage, getFinalOutput } from "./types.js";
import { createArtifactContext, readDeclaredFiles, readFilePrefix, type ArtifactContext } from "./artifacts.js";
import { captureWorktreeDiff, cleanupWorktree, createWorktree, type WorktreeContext } from "./worktree.js";
import { processPiJsonLine } from "./runner-events.js";
import { getInheritedCliArgs } from "./runner-cli.js";
import { getDefaultApprovalStore } from "./sandbox/approval-store.js";
import { resolveSandboxLaunch } from "./sandbox/executor.js";
import type { SandboxRuntimeOptions } from "./sandbox/types.js";
import { shellQuote } from "./shell.js";

export const MAX_PARALLEL_TASKS = 12;
export const MAX_CONCURRENCY = 10;
const KILL_TIMEOUT_MS = 5000;
const AGENT_END_GRACE_MS = 1000;

const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_MAX_DEPTH_ENV = "PI_SUBAGENT_MAX_DEPTH";
const SUBAGENT_STACK_ENV = "PI_SUBAGENT_STACK";
const SUBAGENT_PREVENT_CYCLES_ENV = "PI_SUBAGENT_PREVENT_CYCLES";
const SUBAGENT_RUN_ID_ENV = "PI_SUBAGENT_RUN_ID";
const SUBAGENT_PARENT_RUN_ID_ENV = "PI_SUBAGENT_PARENT_RUN_ID";
const SUBAGENT_ROOT_RUN_ID_ENV = "PI_SUBAGENT_ROOT_RUN_ID";
const SUBAGENT_OWNER_ENV = "PI_SUBAGENT_OWNER";
const SUBAGENT_PROCESS_LOG_ENV = "PI_SUBAGENT_PROCESS_LOG";
const SUBAGENT_FORK_SESSION_ENV = "PI_SUBAGENT_FORK_SESSION";
const SUBAGENT_CONTEXT_MODE_ENV = "PI_SUBAGENT_CONTEXT_MODE";

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

function sanitizedParentEnv(): NodeJS.ProcessEnv {
  if (process.env.PI_SUBAGENT_INHERIT_ENV === "1") return process.env;
  const env = { ...process.env };
  for (const key of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GITLAB_TOKEN",
    "NPM_TOKEN",
    "YARN_NPM_AUTH_TOKEN",
    "HOMEBREW_GITHUB_API_TOKEN",
    "SSH_AUTH_SOCK",
  ]) {
    delete env[key];
  }
  return env;
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

export function buildPiArgs(agent: AgentConfig | undefined, systemPromptPath: string | null, task: string, contextMode: SubagentContextMode = "fresh", outputMode: "json" | "text" = "json", printMode = true): string[] {
  const inherited = getInheritedCliArgs();
  const args = [
    ...(outputMode === "json" ? ["--mode", "json"] : []),
    ...inherited.extensionArgs,
    ...inherited.alwaysProxy,
    ...(printMode ? ["-p"] : []),
  ];

  if (contextMode === "fork") {
    const forkSession = process.env[SUBAGENT_FORK_SESSION_ENV];
    if (!forkSession) throw new Error('context:"fork" requires PI_SUBAGENT_FORK_SESSION to identify the parent session to fork.');
    args.push("--fork", forkSession);
  } else {
    args.push("--no-session");
  }

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
  backend?: "native" | "tmux";
  sessionName?: string;
  windowName?: string;
  paneId?: string;
  attachCommand?: string;
  logFile?: string;
  eventLogFile?: string;
  tmuxBinary?: string;
  sessionAttempt?: string;
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
  sandbox?: Omit<SandboxRuntimeOptions, "approvalStore"> & { approvalStore?: SandboxRuntimeOptions["approvalStore"] };
  maxOutput?: number;
  output?: string;
  reads?: string[];
  progress?: string;
  contextMode?: SubagentContextMode;
  worktree?: boolean;
  executionMode?: "native" | "tmux";
  tmuxPane?: {
    sessionName: string;
    windowName: string;
    paneId: string;
    logFile: string;
    eventLogFile?: string;
    attachCommand: string;
    tmuxBinary?: string;
    sessionAttempt?: string;
  };
}

const TMUX_EXIT_MARKER = "__PI_TMUX_EXIT:";

function execFileAsync(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], (error, _stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      const stderrText = stderr?.toString().trim();
      if (stderrText) {
        reject(new Error(stderrText));
        return;
      }
      resolve();
    });
  });
}

export function buildTmuxShellCommand(params: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  exitMarkerLogFile?: string;
}): string {
  const envArgs = Object.entries(params.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value)}`);
  const command = [shellQuote(params.command), ...params.args.map(shellQuote)].join(" ");
  const invocation = ["env", ...envArgs, command].join(" ");
  const markerTarget = params.exitMarkerLogFile
    ? ` >> ${shellQuote(params.exitMarkerLogFile)}`
    : "";
  return `{ cd ${shellQuote(params.cwd)} && ${invocation}; code=$?; printf '\\n${TMUX_EXIT_MARKER}%s\\n' "$code"${markerTarget}; exit "$code"; } 2>&1`;
}


export function buildTmuxLaunchEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const allowed = new Set([
    "PI_TEAM_WORKER",
    "PI_SUBAGENT_ARTIFACT_DIR",
    "PI_SUBAGENT_OUTPUT_FILE",
    "PI_SUBAGENT_PROGRESS_FILE",
    SUBAGENT_DEPTH_ENV,
    SUBAGENT_MAX_DEPTH_ENV,
    SUBAGENT_STACK_ENV,
    SUBAGENT_PREVENT_CYCLES_ENV,
    SUBAGENT_RUN_ID_ENV,
    SUBAGENT_PARENT_RUN_ID_ENV,
    SUBAGENT_ROOT_RUN_ID_ENV,
    SUBAGENT_OWNER_ENV,
    SUBAGENT_PROCESS_LOG_ENV,
    SUBAGENT_FORK_SESSION_ENV,
    SUBAGENT_CONTEXT_MODE_ENV,
  ]);
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key)));
}

export function buildTmuxLaunchScript(params: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}): string {
  const envArgs = Object.entries(params.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value)}`);
  const command = [shellQuote(params.command), ...params.args.map(shellQuote)].join(" ");
  const invocation = ["env", ...envArgs, command].join(" ");
  return [
    "#!/usr/bin/env bash",
    `cd ${shellQuote(params.cwd)} || exit 1`,
    `exec ${invocation}`,
    "",
  ].join("\n");
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

async function readTmuxUsefulLogTail(logFile: string, limit = 4000): Promise<string> {
  try {
    const text = await readFile(logFile, "utf-8");
    const useful = text
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith(TMUX_EXIT_MARKER)) return false;
        if (trimmed.startsWith("{")) {
          try {
            JSON.parse(trimmed);
            return false;
          } catch {
            return true;
          }
        }
        return true;
      })
      .join("\n")
      .trim();
    return useful.length > limit ? useful.slice(useful.length - limit) : useful;
  } catch {
    return "";
  }
}

async function hydrateResultFromArtifactOutput(
  result: SingleResult,
  artifactContext: ArtifactContext,
  opts: { required: boolean; maxOutput?: number },
): Promise<boolean> {
  if (!artifactContext.outputFile) return false;
  if (opts.required && getFinalOutput(result.messages).trim()) return true;
  try {
    const output = await readFilePrefix(artifactContext.outputFile, opts.maxOutput || 24000);
    const outputText = output.truncated
      ? `${output.text}\n\n[truncated artifact output: ${output.originalBytes} -> ${opts.maxOutput || 24000} bytes]`
      : output.text;
    if (outputText.trim()) {
      result.messages.push({ role: "assistant", content: [{ type: "text", text: outputText }] });
      return true;
    }
    result.artifacts = { ...result.artifacts, artifactError: "Output file was empty." };
    if (opts.required) {
      result.exitCode = result.exitCode === 0 ? 1 : result.exitCode;
      result.stopReason = "error";
      result.errorMessage = "Required tmux worker output artifact was empty.";
    }
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.artifacts = { ...result.artifacts, artifactError: `Output file was not readable: ${message}` };
    if (opts.required) {
      result.exitCode = result.exitCode === 0 ? 1 : result.exitCode;
      result.stopReason = "error";
      result.errorMessage = `Required tmux worker output artifact was not readable: ${message}`;
    }
    return false;
  }
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
    sandbox,
    maxOutput,
    output,
    reads,
    progress,
    contextMode: requestedContextMode,
    worktree,
    executionMode = "native",
    tmuxPane,
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
    maxOutput: maxOutput ?? agent.maxOutput,
    contextMode: requestedContextMode ?? agent.context ?? "fresh",
    terminal: executionMode === "tmux" && tmuxPane
      ? { backend: "tmux", ...tmuxPane }
      : { backend: "native" },
  };

  const emitUpdate = () => {
    onUpdate?.({
      content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
      details: makeDetails([result]),
    });
  };

  const invocation = getPiInvocation();
  let tmpPromptPath: string | undefined;
  let sandboxCleanup: (() => Promise<void>) | undefined;
  let artifactContext: ArtifactContext | undefined;
  let worktreeContext: WorktreeContext | undefined;
  let runCwd = cwd;
  const resolvedOwnership = resolveRunOwnership(ownership, agentName);

  try {
    const tmuxRequiresOutputArtifact = executionMode === "tmux" && !!tmuxPane?.eventLogFile;
    const effectiveOutput = output ?? agent.output ?? (tmuxRequiresOutputArtifact ? "final.md" : undefined);
    const effectiveReads = reads ?? agent.defaultReads;
    const effectiveProgress = progress ?? agent.defaultProgress;
    const effectiveWorktree = worktree ?? agent.worktree;
    const needsArtifacts = tmuxRequiresOutputArtifact || !!effectiveOutput || !!effectiveProgress || !!effectiveReads?.length || !!effectiveWorktree;

    if (needsArtifacts) {
      artifactContext = await createArtifactContext({
        cwd,
        rootRunId: resolvedOwnership.rootRunId,
        runId: resolvedOwnership.runId,
        agentName,
        output: effectiveOutput,
        reads: effectiveReads,
        progress: effectiveProgress,
      });
      result.artifacts = {
        artifactDir: artifactContext.runDir,
        outputFile: artifactContext.outputFile,
        progressFile: artifactContext.progressFile,
        readFiles: artifactContext.readFiles,
      };
    }

    if (effectiveWorktree) {
      try {
        worktreeContext = await createWorktree(cwd, resolvedOwnership.runId);
        const relativeCwd = relative(worktreeContext.gitRoot, cwd);
        runCwd = relativeCwd && !relativeCwd.startsWith("..") ? join(worktreeContext.path, relativeCwd) : worktreeContext.path;
        result.worktree = {
          logicalCwd: cwd,
          worktreePath: worktreeContext.path,
          worktreeCleanupStatus: worktreeContext.cleanupStatus,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.exitCode = 1;
        result.stopReason = "error";
        result.errorMessage = `Failed to create git worktree: ${message}`;
        result.worktree = { logicalCwd: cwd, worktreeCleanupStatus: "failed", worktreeError: message };
        return result;
      }
    }

    let effectiveTask = task;
    if (artifactContext) {
      const instructions: string[] = [];
      if (artifactContext.readFiles.length > 0) {
        instructions.push("Read and use the declared files included below before completing the task.");
        effectiveTask += await readDeclaredFiles(artifactContext.readFiles, cwd);
      }
      if (artifactContext.outputFile) {
        instructions.push(`Write your final answer to this file before finishing: ${artifactContext.outputFile}`);
        if (tmuxRequiresOutputArtifact) instructions.push("This run is displayed in a tmux CLI pane; orchestration reads your final result from that file, so do not finish until the file contains your final report.");
      }
      if (artifactContext.progressFile) instructions.push(`Keep progress notes in this file as you work: ${artifactContext.progressFile}`);
      if (instructions.length > 0) {
        effectiveTask = `${effectiveTask}\n\nSubagent file IO instructions:\n- ${instructions.join("\n- ")}`;
      }
    }

    if (agent.systemPrompt?.trim()) {
      tmpPromptPath = await writeTempSystemPrompt(agent.systemPrompt);
    }

    const contextMode = requestedContextMode ?? agent.context ?? "fresh";
    const piArgs = buildPiArgs(
      agent,
      tmpPromptPath || null,
      effectiveTask,
      contextMode,
      executionMode === "tmux" ? "text" : "json",
      !tmuxRequiresOutputArtifact,
    );
    const allArgs = [...invocation.args, ...piArgs];

    const nextDepth = depthConfig.currentDepth + 1;
    const propagatedStack = [...depthConfig.ancestorStack, agentName];
    const effectiveMaxDepth = agent.maxSubagentDepth ? Math.min(depthConfig.maxDepth, agent.maxSubagentDepth) : depthConfig.maxDepth;
    const processLogPath = extraEnv?.[SUBAGENT_PROCESS_LOG_ENV] || process.env[SUBAGENT_PROCESS_LOG_ENV];
    const effectiveEnv: Record<string, string | undefined> = {
      ...sanitizedParentEnv(),
      ...extraEnv,
      [SUBAGENT_DEPTH_ENV]: String(nextDepth),
      [SUBAGENT_MAX_DEPTH_ENV]: String(effectiveMaxDepth),
      [SUBAGENT_STACK_ENV]: JSON.stringify(propagatedStack),
      [SUBAGENT_PREVENT_CYCLES_ENV]: depthConfig.preventCycles ? "1" : "0",
      [SUBAGENT_CONTEXT_MODE_ENV]: contextMode,
      PI_SUBAGENT_ARTIFACT_DIR: artifactContext?.runDir,
      PI_SUBAGENT_OUTPUT_FILE: artifactContext?.outputFile,
      PI_SUBAGENT_PROGRESS_FILE: artifactContext?.progressFile,
      [SUBAGENT_RUN_ID_ENV]: resolvedOwnership.runId,
      [SUBAGENT_PARENT_RUN_ID_ENV]: resolvedOwnership.parentRunId,
      [SUBAGENT_ROOT_RUN_ID_ENV]: resolvedOwnership.rootRunId,
      [SUBAGENT_OWNER_ENV]: resolvedOwnership.owner,
    };
    const resolvedSandbox = await resolveSandboxLaunch({
      command: invocation.command,
      args: allArgs,
      cwd: runCwd,
      env: effectiveEnv,
      platform: process.platform,
      sandbox: sandbox?.enabled
        ? {
          ...sandbox,
          approvalStore: sandbox.approvalStore || getDefaultApprovalStore(),
        }
        : undefined,
    });
    sandboxCleanup = resolvedSandbox.cleanup;

    let wasAborted = false;
    let semanticTerminationRequested = false;
    let closeSignal: NodeJS.Signals | undefined;
    const lifecycleWrites: Promise<void>[] = [];

    const emitLifecycle = (event: RunLifecycleEvent) => {
      onLifecycleEvent?.(event);
      lifecycleWrites.push(appendLifecycleLog(processLogPath, event).catch(() => undefined));
    };

    let exitCode: number;
    if (executionMode === "tmux") {
      if (!tmuxPane) throw new Error('executionMode:"tmux" requires tmuxPane metadata.');
      const tmuxEventLogFile = tmuxPane.eventLogFile;
      const tmuxPollLogFile = tmuxEventLogFile ?? tmuxPane.logFile;
      if (result.terminal?.backend === "tmux" && tmuxEventLogFile) result.terminal.eventLogFile = tmuxEventLogFile;
      const tmuxLifecycleMetadata = {
        backend: "tmux" as const,
        sessionName: tmuxPane.sessionName,
        windowName: tmuxPane.windowName,
        paneId: tmuxPane.paneId,
        attachCommand: tmuxPane.attachCommand,
        logFile: tmuxPane.logFile,
        ...(tmuxEventLogFile ? { eventLogFile: tmuxEventLogFile } : {}),
        tmuxBinary: tmuxPane.tmuxBinary,
        sessionAttempt: tmuxPane.sessionAttempt,
      };
      await mkdir(dirname(tmuxPane.logFile), { recursive: true });
      if (tmuxEventLogFile) await mkdir(dirname(tmuxEventLogFile), { recursive: true });
      await writeFile(tmuxPane.logFile, "", "utf-8");
      if (tmuxEventLogFile) await writeFile(tmuxEventLogFile, "", "utf-8");
      const tmuxLaunchScript = join(
        dirname(tmuxPane.logFile),
        `.pi-tmux-launch-${resolvedOwnership.runId}-${randomBytes(8).toString("hex")}.sh`,
      );
      await writeFile(
        tmuxLaunchScript,
        buildTmuxLaunchScript({
          command: resolvedSandbox.command,
          args: resolvedSandbox.args,
          cwd: runCwd,
          env: buildTmuxLaunchEnv(resolvedSandbox.env),
        }),
        { encoding: "utf-8", mode: 0o700 },
      );
      const tmuxCommand = buildTmuxShellCommand({
        command: "/bin/bash",
        args: [tmuxLaunchScript],
        cwd: runCwd,
        env: {},
        ...(tmuxEventLogFile ? { exitMarkerLogFile: tmuxEventLogFile } : {}),
      });
      const tmuxBinary = tmuxPane.tmuxBinary ?? "tmux";
      try {
        try {
          await execFileAsync(tmuxBinary, ["send-keys", "-t", tmuxPane.paneId, tmuxCommand, "Enter"]);
        } catch (error) {
          // Real tmux only reports whether send-keys succeeded, not the
          // eventual command exit code. Some tests use a fake tmux that runs
          // the command synchronously and returns the worker exit code; if it
          // already wrote the poll log, continue so the normal exit-marker
          // path can report the worker status.
          const existingLog = await readFile(tmuxPollLogFile, "utf-8").catch(() => "");
          if (!existingLog.trim()) throw error;
        }
        emitLifecycle({
          phase: "spawned",
          runId: resolvedOwnership.runId,
          parentRunId: resolvedOwnership.parentRunId,
          rootRunId: resolvedOwnership.rootRunId,
          owner: resolvedOwnership.owner,
          pid: 0,
          ...tmuxLifecycleMetadata,
        });

        exitCode = await new Promise<number>((resolve) => {
        let readOffset = 0;
        let buffer = "";
        let settled = false;
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        let abortHandler: (() => void) | undefined;
        let terminationStarted = false;

        const finish = (code: number) => {
          if (settled) return;
          settled = true;
          if (pollTimer) clearTimeout(pollTimer);
          if (graceTimer) clearTimeout(graceTimer);
          if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
          emitLifecycle({
            phase: "closed",
            runId: resolvedOwnership.runId,
            parentRunId: resolvedOwnership.parentRunId,
            rootRunId: resolvedOwnership.rootRunId,
            owner: resolvedOwnership.owner,
            pid: 0,
            signal: closeSignal,
            exitCode: code,
            ...tmuxLifecycleMetadata,
          });
          resolve(code);
        };

        const finishFromOutputArtifact = async () => {
          if (!tmuxRequiresOutputArtifact || !artifactContext?.outputFile || settled) return false;
          const hydrated = await hydrateResultFromArtifactOutput(result, artifactContext, { required: false, maxOutput: result.maxOutput });
          if (!hydrated || settled) return false;
          semanticTerminationRequested = true;
          closeSignal = "SIGTERM";
          sendPaneSignal("output_artifact_written");
          finish(0);
          return true;
        };

        const sendPaneSignal = (reason: string) => {
          if (!terminationStarted) {
            terminationStarted = true;
            emitLifecycle({
              phase: "terminating",
              runId: resolvedOwnership.runId,
              parentRunId: resolvedOwnership.parentRunId,
              rootRunId: resolvedOwnership.rootRunId,
              owner: resolvedOwnership.owner,
              pid: 0,
              reason,
              signal: "SIGTERM",
              ...tmuxLifecycleMetadata,
            });
          }
          void execFileAsync(tmuxBinary, ["send-keys", "-t", tmuxPane.paneId, "C-c"]).catch(() => undefined);
        };

        const flushLine = (line: string) => {
          if (line.startsWith(TMUX_EXIT_MARKER)) {
            const parsed = Number.parseInt(line.slice(TMUX_EXIT_MARKER.length).trim(), 10);
            finish(Number.isFinite(parsed) ? parsed : 1);
            return;
          }
          if (processPiJsonLine(line, result)) emitUpdate();
          if (result.sawAgentEnd && !settled) {
            if (graceTimer) clearTimeout(graceTimer);
            graceTimer = setTimeout(() => {
              if (!settled && result.sawAgentEnd) {
                semanticTerminationRequested = true;
                closeSignal = "SIGTERM";
                sendPaneSignal("agent_end_grace_elapsed");
                finish(143);
              }
            }, AGENT_END_GRACE_MS);
          }
        };

        const poll = async () => {
          if (settled) return;
          if (await finishFromOutputArtifact()) return;
          try {
            const handle = await open(tmuxPollLogFile, "r");
            try {
              const stats = await handle.stat();
              if (stats.size > readOffset) {
                const chunk = Buffer.alloc(stats.size - readOffset);
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, readOffset);
                if (bytesRead > 0) {
                  readOffset += bytesRead;
                  buffer += chunk.subarray(0, bytesRead).toString("utf-8");
                  const lines = buffer.split("\n");
                  buffer = lines.pop() || "";
                  for (const line of lines) {
                    if (line.trim()) flushLine(line);
                    if (settled) return;
                  }
                }
              }
            } finally {
              await handle.close();
            }
          } catch (error) {
            if (!result.stderr.trim()) result.stderr = error instanceof Error ? error.message : String(error);
          }
          pollTimer = setTimeout(() => void poll(), 25);
        };

        abortHandler = () => {
          if (settled) return;
          const hasSemanticCompletion = result.sawAgentEnd && !!getFinalOutput(result.messages).trim();
          if (hasSemanticCompletion) {
            semanticTerminationRequested = true;
            closeSignal = "SIGTERM";
            sendPaneSignal("abort_signal_received");
            finish(143);
          } else {
            wasAborted = true;
            closeSignal = "SIGTERM";
            sendPaneSignal("abort_signal_received");
            finish(130);
          }
        };
        if (signal?.aborted) abortHandler();
        else signal?.addEventListener("abort", abortHandler, { once: true });

        void poll();
      });
      } finally {
        await unlink(tmuxLaunchScript).catch(() => undefined);
      }
    } else {
      exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(resolvedSandbox.command, resolvedSandbox.args, {
        cwd: runCwd,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: resolvedSandbox.env,
      });

      const pid = proc.pid ?? 0;
      const pgid = process.platform !== "win32" && pid > 0 ? pid : undefined;

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

    }

    await Promise.allSettled(lifecycleWrites);
    result.exitCode = exitCode;

    if (executionMode === "tmux" && tmuxPane && result.exitCode > 0 && !result.stderr.trim()) {
      const usefulTail = await readTmuxUsefulLogTail(tmuxPane.logFile);
      if (usefulTail) result.stderr = usefulTail;
      result.errorMessage ||= usefulTail || `exitCode ${result.exitCode}`;
    }

    const hasSemanticOutput = result.sawAgentEnd && !!getFinalOutput(result.messages).trim();
    const endedViaSemanticReap = (semanticTerminationRequested || wasAborted) && hasSemanticOutput && (closeSignal === "SIGTERM" || closeSignal === "SIGKILL");

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

    if (artifactContext?.outputFile) {
      await hydrateResultFromArtifactOutput(result, artifactContext, {
        required: tmuxRequiresOutputArtifact,
        maxOutput: result.maxOutput,
      });
    }

    if (worktreeContext && artifactContext) {
      await captureWorktreeDiff(worktreeContext, artifactContext.runDir);
      result.worktree = {
        ...result.worktree,
        logicalCwd: cwd,
        worktreePath: worktreeContext.path,
        worktreeDiffFile: worktreeContext.diffFile,
        worktreeCleanupStatus: worktreeContext.cleanupStatus,
        worktreeError: worktreeContext.error,
      };
    }

    return result;
  } catch (error) {
    if (result.exitCode === -1) {
      const message = error instanceof Error ? error.message : String(error);
      result.exitCode = 1;
      result.stopReason = "error";
      result.errorMessage = message;
      if (result.contextMode === "fork") result.contextError = message;
    }
    return result;
  } finally {
    if (worktreeContext) {
      await cleanupWorktree(worktreeContext).catch(() => undefined);
      result.worktree = {
        ...result.worktree,
        logicalCwd: cwd,
        worktreePath: worktreeContext.path,
        worktreeDiffFile: worktreeContext.diffFile,
        worktreeCleanupStatus: worktreeContext.cleanupStatus,
        worktreeError: worktreeContext.error,
      };
    }
    if (tmpPromptPath) await unlink(tmpPromptPath).catch(() => {});
    await sandboxCleanup?.().catch(() => undefined);
  }
}
