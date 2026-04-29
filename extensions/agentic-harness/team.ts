import type { AgentConfig } from "./agents.js";
import { join } from "path";
import { MAX_CONCURRENCY, MAX_PARALLEL_TASKS, mapWithConcurrencyLimit } from "./subagent.js";
import { createWorkerPanes, detectTmux, killTmuxPane, killTmuxSession } from "./tmux.js";
import { emptyUsage, getResultSummaryText, isResultSuccess, type SingleResult } from "./types.js";
import {
  acknowledgeTeamCommand,
  blockTeamCommand,
  completeTeamCommand,
  createTeamRunRecord,
  enqueueTeamCommand,
  failTeamCommand,
  generateTeamRunId,
  markStaleRunningTasks,
  normalizeTeamRunRecord,
  recordTeamEvent,
  recordTeamMessage,
  setTeamRunStatus,
  startTeamCommand,
  type StaleTaskResumeMode,
  type TeamCommand,
  type TeamRunRecord,
} from "./team-state.js";

export const PI_TEAM_WORKER_ENV = "PI_TEAM_WORKER";
export const PI_ENABLE_TEAM_MODE_ENV = "PI_ENABLE_TEAM_MODE";

export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked" | "interrupted";
export type TeamBackend = "auto" | "native" | "tmux";
export type ResolvedTeamBackend = "native" | "tmux";

export interface TeamTerminalMetadata {
  backend: ResolvedTeamBackend;
  sessionName?: string;
  windowName?: string;
  paneId?: string;
  attachCommand?: string;
  logFile?: string;
  eventLogFile?: string;
  tmuxBinary?: string;
  sessionAttempt?: string;
}

export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  agent: string;
  owner: string;
  status: TeamTaskStatus;
  blockedBy: string[];
  resultSummary?: string;
  artifactRefs: string[];
  worktreeRefs: string[];
  errorMessage?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  heartbeatAt?: string;
  terminal?: TeamTerminalMetadata;
}

export interface TeamRunOptions {
  goal?: string;
  workerCount?: number;
  agent?: string;
  worktree?: boolean;
  worktreePolicy?: "off" | "on" | "auto";
  maxOutput?: number;
  runId?: string;
  resumeRunId?: string;
  resumeMode?: StaleTaskResumeMode;
  staleTaskMs?: number;
  heartbeatMs?: number;
  backend?: TeamBackend;
  signal?: AbortSignal;
  commandTarget?: string;
  commandMessage?: string;
}

export interface TeamVerificationEvidence {
  checksRun: string[];
  passed: boolean;
  failed: boolean;
  passedChecks: string[];
  failedChecks: string[];
  artifactRefs: string[];
  worktreeRefs: string[];
  notes: string[];
}

export interface TeamRunSummary {
  goal: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  blockedCount: number;
  success: boolean;
  ok: boolean;
  backendRequested: TeamBackend;
  backendUsed: ResolvedTeamBackend;
  tasks: TeamTask[];
  finalSynthesis: string;
  verificationEvidence: TeamVerificationEvidence;
}

export interface TeamRunTaskInput {
  task: TeamTask;
  prompt: string;
  agent: AgentConfig | undefined;
  agentName: string;
  worktree?: boolean;
  maxOutput?: number;
  extraEnv: Record<string, string>;
}

export interface TeamBackendResolvedInfo {
  requested: TeamBackend;
  used: ResolvedTeamBackend;
  // `used === "tmux"` with `tmuxAvailable === false` means the caller forced backend=tmux
  // on a host without tmux — pane creation will fail in the catch branch immediately after.
  tmuxAvailable: boolean;
}

export interface TeamTmuxReadyInfo {
  sessionName: string;
  attachCommand: string;
  paneCount: number;
  logDir: string;
  attachedToCurrentClient?: boolean;
}

export interface TeamRuntime {
  findAgent?(name: string): AgentConfig | undefined;
  runTask(input: TeamRunTaskInput, index: number): Promise<SingleResult>;
  summarizeResult?(result: SingleResult, maxOutput?: number): string;
  emitProgress?(summary: TeamRunSummary): void;
  emitBackendResolved?(info: TeamBackendResolvedInfo): void;
  emitTmuxReady?(info: TeamTmuxReadyInfo): void;
  persistRun?(record: TeamRunRecord): void | Promise<void>;
  loadRun?(runId: string): TeamRunRecord | Promise<TeamRunRecord>;
  now?(): string;
}

const WORKER_PROTOCOL = [
  "You are a team worker, not the leader.",
  "Execute only the bounded assignment below; do not rewrite the global plan.",
  "Do not spawn subagents or delegate to other agents.",
  "Do not run team/ultrawork/autopilot/ralph or other orchestration commands.",
  "If blocked, report the blocker clearly instead of widening scope.",
  "Before finishing, report changed files, verification performed, and remaining blockers.",
].join("\n- ");

function clampWorkerCount(workerCount: number | undefined): number {
  const requested = Number.isFinite(workerCount) ? Math.floor(workerCount as number) : 2;
  return Math.max(1, Math.min(MAX_PARALLEL_TASKS, requested));
}

export function createDefaultTeamTasks(goal: string, workerCount?: number, agent = "worker"): TeamTask[] {
  const count = clampWorkerCount(workerCount);
  return Array.from({ length: count }, (_, index) => {
    const id = `task-${index + 1}`;
    return {
      id,
      subject: `Worker ${index + 1}: ${goal}`,
      description: [
        `Goal: ${goal}`,
        `Execute worker lane ${index + 1} of ${count} as an independent parallel-batch task.`,
        "Keep the scope bounded, verify your work, and report concrete evidence.",
      ].join("\n"),
      agent,
      owner: `worker-${index + 1}`,
      status: "pending",
      blockedBy: [],
      artifactRefs: [],
      worktreeRefs: [],
    } satisfies TeamTask;
  });
}

export function validateTeamTasks(tasks: TeamTask[]): void {
  const blocked = tasks.find((task) => task.blockedBy.length > 0);
  if (blocked) {
    throw new Error(`blockedBy dependencies are not supported by the MVP parallel batch scheduler: ${blocked.id}`);
  }
}

function isFollowUpCommand(opts: TeamRunOptions): boolean {
  return !!(opts.resumeRunId && opts.commandTarget && opts.commandMessage);
}

function findCommandTarget(tasks: TeamTask[], target: string | undefined): TeamTask | undefined {
  if (!target) return undefined;
  return tasks.find((task) => task.id === target || task.owner === target);
}

function buildCommandWorkerPrompt(task: TeamTask, command: TeamCommand, goal: string): string {
  return [
    "# Team Worker Command",
    "",
    `Team goal: ${goal}`,
    `Task id: ${task.id}`,
    `Task owner: ${task.owner}`,
    `Command id: ${command.id}`,
    `Command attempt: ${command.attempt}`,
    "",
    "## Runtime rules",
    `- ${WORKER_PROTOCOL}`,
    "- Treat the durable team command record as the source of truth.",
    "- Report completion, blocker, or failure clearly so the leader can update the command lifecycle.",
    "",
    "## Command",
    command.body,
    "",
    "## Required final report",
    "- Command outcome: completed, blocked, or failed.",
    "- Changed files, or `none` if read-only.",
    "- Verification commands/results, or explicit gaps if verification was impossible.",
    "- Blockers/risks, or `none`.",
  ].join("\n");
}

function commandRefs(result: SingleResult): string[] {
  return [
    result.artifacts?.artifactDir,
    result.artifacts?.outputFile,
    result.artifacts?.progressFile,
    ...(result.artifacts?.readFiles ?? []),
    result.worktree?.worktreePath,
  ].filter((value): value is string => !!value);
}

export function buildTeamWorkerPrompt(task: TeamTask, opts: TeamRunOptions): string {
  return [
    "# Team Worker Assignment",
    "",
    `Team goal: ${opts.goal ?? task.subject}`,
    `Task id: ${task.id}`,
    `Task owner: ${task.owner}`,
    `Task subject: ${task.subject}`,
    "",
    "## Runtime rules",
    `- ${WORKER_PROTOCOL}`,
    "",
    "## Assignment",
    task.description,
    "",
    "## Required final report",
    "- Changed files, or `none` if read-only.",
    "- Verification commands/results, or explicit gaps if verification was impossible.",
    "- Blockers/risks, or `none`.",
  ].join("\n");
}

function taskRefs(result: SingleResult): { artifactRefs: string[]; worktreeRefs: string[] } {
  const artifactRefs = [
    result.artifacts?.artifactDir,
    result.artifacts?.outputFile,
    result.artifacts?.progressFile,
    ...(result.artifacts?.readFiles ?? []),
  ].filter((value): value is string => !!value);
  const worktreeRefs = [result.worktree?.worktreePath]
    .filter((value): value is string => !!value);
  return { artifactRefs, worktreeRefs };
}

function createEvidence(tasks: TeamTask[], results: SingleResult[]): TeamVerificationEvidence {
  const artifactRefs = tasks.flatMap((task) => task.artifactRefs);
  const worktreeRefs = tasks.flatMap((task) => task.worktreeRefs);
  const passedChecks = tasks
    .filter((task) => task.status === "completed")
    .map((task) => `${task.id}: worker completed`);
  const failedChecks = tasks
    .filter((task) => task.status === "failed" || task.status === "blocked" || task.status === "interrupted")
    .map((task) => `${task.id}: ${task.errorMessage || task.status}`);
  const checksRun = results.map((result, index) => `${tasks[index]?.id ?? `task-${index + 1}`}: pi worker execution`);
  return {
    checksRun,
    passed: failedChecks.length === 0 && tasks.length > 0 && passedChecks.length === tasks.length,
    failed: failedChecks.length > 0,
    passedChecks,
    failedChecks,
    artifactRefs,
    worktreeRefs,
    notes: [
      "MVP team mode uses dependency-free parallel-batch task records.",
      "Team mode persists durable command lifecycle records; inbox/outbox messages are audit history.",
      "Worker self-reported verification appears in each task result summary.",
    ],
  };
}

export function synthesizeTeamRun(
  goal: string,
  tasks: TeamTask[],
  results: SingleResult[],
  maxOutput?: number,
  backendRequested: TeamBackend = "auto",
  backendUsed: ResolvedTeamBackend = "native",
): TeamRunSummary {
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const interruptedCount = tasks.filter((task) => task.status === "interrupted" || task.status === "in_progress").length;
  const success = tasks.length > 0 && completedCount === tasks.length && failedCount === 0 && blockedCount === 0 && interruptedCount === 0;
  const verificationEvidence = createEvidence(tasks, results);
  const taskLines = tasks.map((task) => [
    `- ${task.id} (${task.owner}, ${task.agent}): ${task.status}`,
    task.resultSummary ? `  ${task.resultSummary}` : undefined,
    task.terminal?.attachCommand ? `  Attach: ${task.terminal.attachCommand}` : undefined,
    task.errorMessage ? `  Error: ${task.errorMessage}` : undefined,
  ].filter(Boolean).join("\n"));
  return {
    goal,
    taskCount: tasks.length,
    completedCount,
    failedCount,
    blockedCount,
    success,
    ok: success,
    backendRequested,
    backendUsed,
    tasks,
    finalSynthesis: [
      `Team ${success ? "completed" : "finished with failures"}: ${completedCount}/${tasks.length} completed for goal: ${goal}`,
      ...taskLines,
      "",
      "Verification evidence:",
      `- checksRun: ${verificationEvidence.checksRun.length}`,
      `- passed: ${verificationEvidence.passed}`,
      `- failed: ${verificationEvidence.failed}`,
      interruptedCount ? `- interrupted/running: ${interruptedCount}` : undefined,
      backendUsed === "tmux" ? "- Tmux cleanup policy: successful runs are cleaned up automatically; failed runs leave tmux panes/sessions behind for debugging." : undefined,
    ].filter(Boolean).join("\n"),
    verificationEvidence,
  };
}

function normalizeWorkerReportItem(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (/^[-*]\s+(none|none\.|no blockers|no blockers\.|n\/a)$/i.test(trimmed)) return undefined;
  if (/^(none|none\.|no blockers|no blockers\.|n\/a)$/i.test(trimmed)) return undefined;
  if (/^#{1,6}\s+/.test(trimmed)) return undefined;
  if (/^[-*]\s+/.test(trimmed)) return trimmed;
  return `- ${trimmed}`;
}

function uniqueItems(items: string[]): string[] {
  return Array.from(new Set(items));
}

function extractWorkerReportSection(summaryText: string | undefined, headingMatchers: RegExp[]): string[] {
  if (!summaryText) return [];
  const lines = summaryText.split(/\r?\n/);
  const items: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)\s*$/);
    if (heading) {
      collecting = headingMatchers.some((matcher) => matcher.test(heading[1].trim()));
      continue;
    }
    if (!collecting) continue;
    const item = normalizeWorkerReportItem(line);
    if (item) items.push(item);
  }

  return uniqueItems(items);
}

function collectWorkerOutputs(tasks: TeamTask[]): string[] {
  return uniqueItems(tasks.flatMap((task) => extractWorkerReportSection(task.resultSummary, [
    /^(changed files|files changed|outputs?|changed files\/outputs?)$/i,
  ])));
}

function collectWorkerVerification(tasks: TeamTask[]): string[] {
  return uniqueItems(tasks.flatMap((task) => extractWorkerReportSection(task.resultSummary, [
    /^(verification|verification performed|checks|tests)$/i,
  ])));
}

function collectWorkerRisks(tasks: TeamTask[]): string[] {
  const reportedRisks = tasks.flatMap((task) => extractWorkerReportSection(task.resultSummary, [
    /^(blockers|blockers\/risks|risks|remaining blockers)$/i,
  ]));
  const taskFailures = tasks
    .filter((task) => task.errorMessage)
    .map((task) => `- ${task.id}: ${task.errorMessage}`);
  return uniqueItems([...reportedRisks, ...taskFailures]);
}

function formatWorkerDetails(tasks: TeamTask[]): string[] {
  return tasks.map((task) => [
    `### ${task.id} (${task.owner}, ${task.agent}): ${task.status}`,
    task.resultSummary || "No worker report captured.",
    task.terminal?.attachCommand ? `Attach: ${task.terminal.attachCommand}` : undefined,
    task.errorMessage ? `Error: ${task.errorMessage}` : undefined,
  ].filter(Boolean).join("\n"));
}

export function formatTeamRunSummary(summary: TeamRunSummary): string {
  const evidence = summary.verificationEvidence;
  const outputs = collectWorkerOutputs(summary.tasks);
  const workerVerification = collectWorkerVerification(summary.tasks);
  const risks = collectWorkerRisks(summary.tasks);
  const statusWord = summary.success ? "completed" : "finished with failures";
  const verificationStatus = evidence.passed ? "PASS" : "FAIL";

  return [
    `Team ${statusWord}: ${summary.completedCount}/${summary.taskCount} tasks completed for goal: ${summary.goal}`,
    "",
    "## Summary",
    `- Goal: ${summary.goal}`,
    `- Backend: ${summary.backendUsed}`,
    `- Tasks: ${summary.completedCount}/${summary.taskCount} completed, ${summary.failedCount} failed, ${summary.blockedCount} blocked.`,
    `- Result: ${summary.success ? "All worker tasks completed." : "One or more worker tasks did not complete successfully."}`,
    "",
    "## Outputs",
    ...(outputs.length > 0 ? outputs : ["- No changed files or outputs were reported by workers."]),
    "",
    "## Verification",
    `- ${verificationStatus}: ${summary.completedCount}/${summary.taskCount} worker tasks completed.`,
    ...(workerVerification.length > 0 ? workerVerification : ["- No worker-reported verification commands were captured."]),
    "",
    "## Risks / Blockers",
    ...(risks.length > 0 ? risks : ["- None reported."]),
    "",
    "## Worker Details",
    ...formatWorkerDetails(summary.tasks),
    "",
    "Structured verification evidence:",
    `- checksRun: ${evidence.checksRun.join("; ") || "none"}`,
    `- passed: ${evidence.passed} (${evidence.passedChecks.join("; ") || "none"})`,
    `- failed: ${evidence.failed} (${evidence.failedChecks.join("; ") || "none"})`,
    `- artifactRefs: ${evidence.artifactRefs.join("; ") || "none"}`,
    `- worktreeRefs: ${evidence.worktreeRefs.join("; ") || "none"}`,
    `- notes: ${evidence.notes.join("; ") || "none"}`,
  ].join("\n");
}

const persistChains = new WeakMap<TeamRuntime, Promise<void>>();

async function persistIfEnabled(runtime: TeamRuntime, record: TeamRunRecord): Promise<void> {
  if (!runtime.persistRun) return;
  const snapshot = JSON.parse(JSON.stringify(record)) as TeamRunRecord;
  const previous = persistChains.get(runtime) ?? Promise.resolve();
  const next = previous.then(() => runtime.persistRun?.(snapshot));
  persistChains.set(runtime, next.catch(() => undefined));
  await next;
}

function terminalTaskStatus(status: TeamTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "interrupted";
}

export function resolveTeamWorktreePolicy(opts: Pick<TeamRunOptions, "worktree" | "worktreePolicy">): boolean {
  if (opts.worktreePolicy === "on") return true;
  if (opts.worktreePolicy === "off") return false;
  if (opts.worktreePolicy === "auto") return !!opts.worktree;
  return !!opts.worktree;
}

interface TeamTmuxCleanupRegistration {
  backendUsed: ResolvedTeamBackend;
  attachedToCurrentClient: boolean;
  paneIds: string[];
  sessionName?: string;
  tmuxBinary?: string;
}

const activeTeamTmuxResources = new Set<TeamTmuxCleanupRegistration>();

async function cleanupTeamTmuxResources(params: TeamTmuxCleanupRegistration): Promise<void> {
  if (params.backendUsed !== "tmux") return;
  if (params.attachedToCurrentClient && params.paneIds.length > 0) {
    await Promise.all(params.paneIds.map((paneId) => killTmuxPane(paneId, undefined, params.tmuxBinary)));
    return;
  }
  if (params.sessionName) {
    await killTmuxSession(params.sessionName, undefined, params.tmuxBinary);
  }
}

async function cleanupRegisteredTeamTmuxResources(registration: TeamTmuxCleanupRegistration | undefined): Promise<void> {
  if (!registration) return;
  activeTeamTmuxResources.delete(registration);
  await cleanupTeamTmuxResources(registration);
}

export async function cleanupActiveTeamTmuxResources(): Promise<void> {
  const registrations = Array.from(activeTeamTmuxResources);
  activeTeamTmuxResources.clear();
  await Promise.all(registrations.map((registration) => cleanupTeamTmuxResources(registration)));
}

async function runTeamFollowUpCommand(
  record: TeamRunRecord,
  opts: TeamRunOptions,
  runtime: TeamRuntime,
  backendRequested: TeamBackend,
  backendUsed: ResolvedTeamBackend,
  now: () => string,
): Promise<TeamRunSummary> {
  const target = findCommandTarget(record.tasks, opts.commandTarget);
  const createdAt = now();
  const results: SingleResult[] = [];
  if (!target) {
    const message = `Follow-up target not found: ${opts.commandTarget}`;
    record = recordTeamEvent(record, { type: "run_failed", createdAt, message });
    const summary = synthesizeTeamRun(record.goal, record.tasks, results, opts.maxOutput, backendRequested, backendUsed);
    record = setTeamRunStatus(record, "failed", createdAt, { ...summary, success: false, ok: false, finalSynthesis: `${summary.finalSynthesis}\nFollow-up command failed: ${message}` });
    await persistIfEnabled(runtime, record);
    return record.summary!;
  }

  const body = opts.commandMessage || "";
  record = enqueueTeamCommand(record, { taskId: target.id, owner: target.owner, body, createdAt });
  const command = record.commands.at(-1)!;
  record = recordTeamMessage(record, {
    taskId: target.id,
    from: "leader",
    to: target.owner,
    kind: "inbox",
    body,
    createdAt,
    deliveredAt: createdAt,
  });
  await persistIfEnabled(runtime, record);

  let result: SingleResult;
  let wakeUpFailed = false;
  try {
    const prompt = buildCommandWorkerPrompt(target, { ...command, status: "started", attempt: command.attempt }, record.goal);
    result = await runtime.runTask({
      task: target,
      prompt,
      agent: runtime.findAgent?.(target.agent),
      agentName: target.agent,
      worktree: resolveTeamWorktreePolicy(opts),
      maxOutput: opts.maxOutput,
      extraEnv: {
        [PI_TEAM_WORKER_ENV]: "1",
        PI_SUBAGENT_MAX_DEPTH: "1",
      },
    }, 0);
    const startedAt = now();
    target.status = "in_progress";
    target.updatedAt = startedAt;
    target.heartbeatAt = startedAt;
    record = acknowledgeTeamCommand(record, command.id, { now: startedAt });
    record = startTeamCommand(record, command.id, { now: startedAt });
    record = recordTeamEvent(record, { type: "task_started", taskId: target.id, commandId: command.id, createdAt: startedAt, message: "follow-up command started" });
    await persistIfEnabled(runtime, record);
    results.push(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result = {
      agent: target.agent,
      agentSource: "unknown",
      task: body,
      exitCode: 1,
      messages: [],
      stderr: errorMessage,
      usage: emptyUsage(),
      stopReason: "error",
      errorMessage,
      terminal: target.terminal,
    };
    wakeUpFailed = true;
    results.push(result);
  }

  const completedAt = now();
  const summarize = runtime.summarizeResult ?? getResultSummaryText;
  target.resultSummary = summarize(result, opts.maxOutput);
  const refs = taskRefs(result);
  target.artifactRefs = refs.artifactRefs;
  target.worktreeRefs = refs.worktreeRefs;
  target.updatedAt = completedAt;
  target.completedAt = completedAt;

  if (isResultSuccess(result)) {
    target.status = "completed";
    record = completeTeamCommand(record, command.id, { now: completedAt, resultSummary: target.resultSummary, artifactRefs: commandRefs(result) });
    record = recordTeamEvent(record, { type: "task_completed", taskId: target.id, commandId: command.id, createdAt: completedAt, message: "follow-up command completed" });
  } else {
    const errorMessage = result.errorMessage || result.stderr || `exitCode ${result.exitCode}`;
    target.status = wakeUpFailed ? "blocked" : "failed";
    target.errorMessage = errorMessage;
    record = wakeUpFailed
      ? blockTeamCommand(record, command.id, { now: completedAt, errorMessage: `wake-up failed: ${errorMessage}` })
      : failTeamCommand(record, command.id, { now: completedAt, errorMessage });
    record = recordTeamEvent(record, { type: "task_failed", taskId: target.id, commandId: command.id, createdAt: completedAt, message: errorMessage });
  }
  record = recordTeamMessage(record, {
    taskId: target.id,
    from: target.owner,
    to: "leader",
    kind: isResultSuccess(result) ? "outbox" : "error",
    body: target.resultSummary,
    createdAt: completedAt,
  });
  const summary = synthesizeTeamRun(record.goal, record.tasks, results, opts.maxOutput, backendRequested, backendUsed);
  record = recordTeamEvent(record, { type: summary.success ? "run_completed" : "run_failed", createdAt: now(), message: "follow-up command finished" });
  record = setTeamRunStatus(record, summary.success ? "completed" : "failed", now(), summary);
  await persistIfEnabled(runtime, record);
  return summary;
}

export async function runTeam(opts: TeamRunOptions, runtime: TeamRuntime): Promise<TeamRunSummary> {
  const agentName = opts.agent || "worker";
  const followUpMode = isFollowUpCommand(opts);
  if (!followUpMode && !opts.goal) throw new Error("team goal is required unless follow-up command mode is used.");
  if (followUpMode && opts.goal) throw new Error("team follow-up command mode must not include goal.");
  const backendRequested = opts.backend ?? "auto";
  const tmuxAvailability = backendRequested === "native" ? { available: false } : await detectTmux();
  const tmuxBinary = "binary" in tmuxAvailability ? tmuxAvailability.binary : undefined;
  const backendUsed: ResolvedTeamBackend = backendRequested === "tmux"
    ? "tmux"
    : backendRequested === "native"
      ? "native"
      : tmuxAvailability.available ? "tmux" : "native";
  runtime.emitBackendResolved?.({
    requested: backendRequested,
    used: backendUsed,
    tmuxAvailable: tmuxAvailability.available,
  });
  const now = runtime.now ?? (() => new Date().toISOString());
  const initialNow = now();
  const isResume = !!opts.resumeRunId;
  let record = isResume && runtime.loadRun
    ? normalizeTeamRunRecord(await runtime.loadRun(opts.resumeRunId as string))
    : createTeamRunRecord({
      runId: opts.runId || generateTeamRunId(),
      goal: opts.goal!,
      options: opts,
      tasks: createDefaultTeamTasks(opts.goal!, opts.workerCount, agentName),
      now: initialNow,
    });

  if (isResume) {
    record = recordTeamEvent(record, { type: "run_resumed", createdAt: initialNow, message: `Resumed as ${opts.resumeRunId}` });
    record = markStaleRunningTasks(record, { now: initialNow, staleTaskMs: opts.staleTaskMs, mode: opts.resumeMode });
  }

  if (followUpMode) {
    return runTeamFollowUpCommand(record, opts, runtime, backendRequested, backendUsed, now);
  }

  const tasks = record.tasks;
  for (const task of tasks) {
    task.terminal = task.terminal ?? { backend: "native" };
  }
  try {
    validateTeamTasks(tasks);
  } catch (err) {
    const invalidDependency = tasks.find((task) => task.blockedBy.length > 0);
    if (invalidDependency) {
      invalidDependency.status = "blocked";
      invalidDependency.updatedAt = now();
      invalidDependency.errorMessage = err instanceof Error ? err.message : "MVP team mode only supports dependency-free parallel batches.";
      record = recordTeamEvent(record, { type: "task_failed", taskId: invalidDependency.id, createdAt: invalidDependency.updatedAt, message: invalidDependency.errorMessage });
    }
    const summary = synthesizeTeamRun(record.goal, tasks, [], opts.maxOutput, backendRequested, backendUsed);
    record = setTeamRunStatus(record, "failed", now(), summary);
    await persistIfEnabled(runtime, record);
    return summary;
  }

  record = setTeamRunStatus(record, "running", now());
  await persistIfEnabled(runtime, record);

  const runnableTasks = tasks.filter((task) => task.status === "pending");
  let tmuxSessionName: string | undefined;
  let tmuxPaneIdsToCleanup: string[] = [];
  let tmuxAttachedToCurrentClient = false;
  let tmuxCleanupRegistration: TeamTmuxCleanupRegistration | undefined;
  if (backendUsed === "tmux" && runnableTasks.length > 0) {
    try {
      const paneRefs = await createWorkerPanes({
        runId: record.runId,
        workerCount: runnableTasks.length,
        logDir: join(process.cwd(), ".pi", "agent", "runs", record.runId, "tmux"),
        ...(tmuxBinary ? { binary: tmuxBinary } : {}),
      });
      for (const [index, task] of runnableTasks.entries()) {
        const pane = paneRefs[index];
        if (pane) {
          tmuxSessionName = pane.sessionName;
          task.terminal = { backend: "tmux", ...pane, ...(tmuxBinary ? { tmuxBinary } : {}) };
        }
      }
      if (paneRefs.length > 0) {
        tmuxAttachedToCurrentClient = paneRefs[0].placement === "current-window";
        if (tmuxAttachedToCurrentClient) {
          tmuxPaneIdsToCleanup = paneRefs.map((pane) => pane.paneId);
        }
        runtime.emitTmuxReady?.({
          sessionName: paneRefs[0].sessionName,
          attachCommand: paneRefs[0].attachCommand,
          paneCount: paneRefs.length,
          logDir: join(process.cwd(), ".pi", "agent", "runs", record.runId, "tmux"),
          attachedToCurrentClient: tmuxAttachedToCurrentClient,
        });
      }
      tmuxCleanupRegistration = {
        backendUsed,
        attachedToCurrentClient: tmuxAttachedToCurrentClient,
        paneIds: tmuxPaneIdsToCleanup,
        sessionName: tmuxSessionName,
        tmuxBinary,
      };
      activeTeamTmuxResources.add(tmuxCleanupRegistration);
      await persistIfEnabled(runtime, record);
    } catch (error) {
      const failedAt = now();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const partialPanes = (error as { partialPanes?: unknown }).partialPanes;
      let cleanupSessionName = tmuxSessionName;
      let cleanupPaneIds = tmuxPaneIdsToCleanup;
      let cleanupAttachedToCurrentClient = tmuxAttachedToCurrentClient;
      if (Array.isArray(partialPanes)) {
        const partialSessionName = partialPanes
          .map((pane) => (pane as { sessionName?: unknown }).sessionName)
          .find((sessionName): sessionName is string => typeof sessionName === "string");
        const partialPaneIds = partialPanes
          .map((pane) => (pane as { paneId?: unknown }).paneId)
          .filter((paneId): paneId is string => typeof paneId === "string");
        const partialAttachedToCurrentClient = partialPanes.some((pane) =>
          (pane as { placement?: unknown }).placement === "current-window",
        );
        cleanupSessionName = cleanupSessionName ?? partialSessionName;
        cleanupPaneIds = cleanupPaneIds.length > 0 ? cleanupPaneIds : partialPaneIds;
        cleanupAttachedToCurrentClient = cleanupPaneIds.length > 0
          ? (tmuxPaneIdsToCleanup.length > 0 ? tmuxAttachedToCurrentClient : partialAttachedToCurrentClient)
          : tmuxAttachedToCurrentClient;
      }
      for (const task of runnableTasks) {
        task.status = "failed";
        task.updatedAt = failedAt;
        task.completedAt = failedAt;
        task.errorMessage = errorMessage;
        task.terminal = { backend: "tmux", ...(tmuxBinary ? { tmuxBinary } : {}) };
        record = recordTeamEvent(record, { type: "task_failed", taskId: task.id, createdAt: failedAt, message: errorMessage });
      }
      const summary = synthesizeTeamRun(record.goal, tasks, [], opts.maxOutput, backendRequested, backendUsed);
      record = recordTeamEvent(record, { type: "run_failed", createdAt: failedAt, message: errorMessage });
      record = setTeamRunStatus(record, "failed", failedAt, summary);
      await persistIfEnabled(runtime, record);
      await cleanupTeamTmuxResources({
        backendUsed,
        attachedToCurrentClient: cleanupAttachedToCurrentClient,
        paneIds: cleanupPaneIds,
        sessionName: cleanupSessionName,
        tmuxBinary,
      });
      return summary;
    }
  } else {
    for (const task of tasks) {
      task.terminal = { backend: "native" };
    }
  }
  const runWithWorktree = resolveTeamWorktreePolicy(opts);
  const abortSignal = opts.signal;
  let abortListener: (() => void) | undefined;
  const abortSummaryPromise = abortSignal ? new Promise<TeamRunSummary>((resolve) => {
    const handleAbort = () => {
      void (async () => {
        const interruptedAt = now();
        const reason = abortSignal.reason;
        const errorMessage = reason instanceof Error
          ? reason.message
          : typeof reason === "string" ? reason : "Team run aborted";
        for (const task of tasks) {
          if (task.status === "pending" || task.status === "in_progress") {
            task.status = "interrupted";
            task.updatedAt = interruptedAt;
            task.completedAt = interruptedAt;
            task.errorMessage = errorMessage;
            record = recordTeamEvent(record, { type: "task_interrupted", taskId: task.id, createdAt: interruptedAt, message: errorMessage });
          }
        }
        await cleanupRegisteredTeamTmuxResources(tmuxCleanupRegistration);
        const summary = synthesizeTeamRun(record.goal, tasks, [], opts.maxOutput, backendRequested, backendUsed);
        record = recordTeamEvent(record, { type: "run_failed", createdAt: interruptedAt, message: errorMessage });
        record = setTeamRunStatus(record, "interrupted", interruptedAt, summary);
        await persistIfEnabled(runtime, record);
        resolve(summary);
      })();
    };
    abortListener = handleAbort;
    if (abortSignal.aborted) {
      handleAbort();
    } else {
      abortSignal.addEventListener("abort", handleAbort, { once: true });
    }
  }) : undefined;
  const workerResultsPromise = mapWithConcurrencyLimit(runnableTasks, MAX_CONCURRENCY, async (task, index) => {
    const startedAt = now();
    task.status = "in_progress";
    task.startedAt = task.startedAt || startedAt;
    task.updatedAt = startedAt;
    task.heartbeatAt = startedAt;
    record = recordTeamEvent(record, { type: "task_started", taskId: task.id, createdAt: startedAt });
    const assignmentPrompt = buildTeamWorkerPrompt(task, opts);
    record = enqueueTeamCommand(record, {
      taskId: task.id,
      owner: task.owner,
      body: assignmentPrompt,
      createdAt: startedAt,
    });
    const command = record.commands.at(-1);
    if (command) {
      record = acknowledgeTeamCommand(record, command.id, { now: startedAt });
      record = startTeamCommand(record, command.id, { now: startedAt });
    }
    record = recordTeamMessage(record, {
      taskId: task.id,
      from: "leader",
      to: task.owner,
      kind: "inbox",
      body: assignmentPrompt,
      createdAt: startedAt,
      deliveredAt: startedAt,
    });
    await persistIfEnabled(runtime, record);
    runtime.emitProgress?.(synthesizeTeamRun(record.goal, tasks, [], opts.maxOutput, backendRequested, backendUsed));
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const heartbeatMs = opts.heartbeatMs ?? 15_000;
    if (heartbeatMs > 0) {
      heartbeat = setInterval(() => {
        const heartbeatAt = now();
        task.heartbeatAt = heartbeatAt;
        task.updatedAt = heartbeatAt;
        record = recordTeamEvent(record, { type: "task_heartbeat", taskId: task.id, createdAt: heartbeatAt });
        void persistIfEnabled(runtime, record);
      }, heartbeatMs);
      heartbeat.unref?.();
    }
    let result: SingleResult;
    try {
      result = await runtime.runTask({
        task,
        prompt: assignmentPrompt,
        agent: runtime.findAgent?.(task.agent),
        agentName: task.agent,
        worktree: runWithWorktree,
        maxOutput: opts.maxOutput,
        extraEnv: {
          [PI_TEAM_WORKER_ENV]: "1",
          PI_SUBAGENT_MAX_DEPTH: "1",
        },
      }, index);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    const summarize = runtime.summarizeResult ?? getResultSummaryText;
    task.resultSummary = summarize(result, opts.maxOutput);
    const refs = taskRefs(result);
    task.artifactRefs = refs.artifactRefs;
    task.worktreeRefs = refs.worktreeRefs;
    const completedAt = now();
    if (command) {
      record = isResultSuccess(result)
        ? completeTeamCommand(record, command.id, { now: completedAt, resultSummary: task.resultSummary, artifactRefs: commandRefs(result) })
        : failTeamCommand(record, command.id, { now: completedAt, errorMessage: result.errorMessage || result.stderr || `exitCode ${result.exitCode}` });
    }
    task.updatedAt = completedAt;
    task.completedAt = completedAt;
    record = recordTeamMessage(record, {
      taskId: task.id,
      from: task.owner,
      to: "leader",
      kind: isResultSuccess(result) ? "outbox" : "error",
      body: task.resultSummary,
      createdAt: completedAt,
    });
    if (isResultSuccess(result)) {
      task.status = "completed";
      record = recordTeamEvent(record, { type: "task_completed", taskId: task.id, createdAt: completedAt });
    } else {
      task.status = "failed";
      task.errorMessage = result.errorMessage || result.stderr || `exitCode ${result.exitCode}`;
      record = recordTeamEvent(record, { type: "task_failed", taskId: task.id, createdAt: completedAt, message: task.errorMessage });
    }
    await persistIfEnabled(runtime, record);
    runtime.emitProgress?.(synthesizeTeamRun(record.goal, tasks, [result], opts.maxOutput, backendRequested, backendUsed));
    return result;
  });

  let results: SingleResult[];
  if (abortSummaryPromise) {
    const outcome = await Promise.race([
      workerResultsPromise.then((workerResults) => ({ type: "completed" as const, workerResults })),
      abortSummaryPromise.then((summary) => ({ type: "aborted" as const, summary })),
    ]);
    if (outcome.type === "aborted") {
      return outcome.summary;
    }
    if (abortListener) abortSignal?.removeEventListener("abort", abortListener);
    results = outcome.workerResults;
  } else {
    results = await workerResultsPromise;
  }

  const summary = synthesizeTeamRun(record.goal, tasks, results, opts.maxOutput, backendRequested, backendUsed);
  const finalStatus = summary.success
    ? "completed"
    : tasks.some((task) => task.status === "interrupted" || task.status === "in_progress")
      ? "interrupted"
      : "failed";
  if (summary.success) {
    await cleanupRegisteredTeamTmuxResources(tmuxCleanupRegistration);
  }
  record = recordTeamEvent(record, { type: summary.success ? "run_completed" : "run_failed", createdAt: now() });
  record = setTeamRunStatus(record, finalStatus, now(), summary);
  await persistIfEnabled(runtime, record);
  return summary;
}
