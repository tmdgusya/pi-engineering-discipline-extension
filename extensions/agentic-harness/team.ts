import type { AgentConfig } from "./agents.js";
import { MAX_CONCURRENCY, MAX_PARALLEL_TASKS, mapWithConcurrencyLimit } from "./subagent.js";
import { getResultSummaryText, isResultSuccess, type SingleResult } from "./types.js";
import {
  createTeamRunRecord,
  generateTeamRunId,
  markStaleRunningTasks,
  recordTeamEvent,
  recordTeamMessage,
  setTeamRunStatus,
  type StaleTaskResumeMode,
  type TeamRunRecord,
} from "./team-state.js";

export const PI_TEAM_WORKER_ENV = "PI_TEAM_WORKER";

export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked" | "interrupted";

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
}

export interface TeamRunOptions {
  goal: string;
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

export interface TeamRuntime {
  findAgent?(name: string): AgentConfig | undefined;
  runTask(input: TeamRunTaskInput, index: number): Promise<SingleResult>;
  summarizeResult?(result: SingleResult, maxOutput?: number): string;
  emitProgress?(summary: TeamRunSummary): void;
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

export function buildTeamWorkerPrompt(task: TeamTask, opts: TeamRunOptions): string {
  return [
    "# Team Worker Assignment",
    "",
    `Team goal: ${opts.goal}`,
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
      "Worker self-reported verification appears in each task result summary.",
    ],
  };
}

export function synthesizeTeamRun(goal: string, tasks: TeamTask[], results: SingleResult[], maxOutput?: number): TeamRunSummary {
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const interruptedCount = tasks.filter((task) => task.status === "interrupted" || task.status === "in_progress").length;
  const success = tasks.length > 0 && completedCount === tasks.length && failedCount === 0 && blockedCount === 0 && interruptedCount === 0;
  const verificationEvidence = createEvidence(tasks, results);
  const taskLines = tasks.map((task) => [
    `- ${task.id} (${task.owner}, ${task.agent}): ${task.status}`,
    task.resultSummary ? `  ${task.resultSummary}` : undefined,
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
    ].join("\n"),
    verificationEvidence,
  };
}

export function formatTeamRunSummary(summary: TeamRunSummary): string {
  const evidence = summary.verificationEvidence;
  return [
    summary.finalSynthesis,
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

async function persistIfEnabled(runtime: TeamRuntime, record: TeamRunRecord): Promise<void> {
  await runtime.persistRun?.(record);
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

export async function runTeam(opts: TeamRunOptions, runtime: TeamRuntime): Promise<TeamRunSummary> {
  const agentName = opts.agent || "worker";
  const now = runtime.now ?? (() => new Date().toISOString());
  const initialNow = now();
  const isResume = !!opts.resumeRunId;
  let record = isResume && runtime.loadRun
    ? await runtime.loadRun(opts.resumeRunId as string)
    : createTeamRunRecord({
      runId: opts.runId || generateTeamRunId(),
      goal: opts.goal,
      options: opts,
      tasks: createDefaultTeamTasks(opts.goal, opts.workerCount, agentName),
      now: initialNow,
    });

  if (isResume) {
    record = recordTeamEvent(record, { type: "run_resumed", createdAt: initialNow, message: `Resumed as ${opts.resumeRunId}` });
    record = markStaleRunningTasks(record, { now: initialNow, staleTaskMs: opts.staleTaskMs, mode: opts.resumeMode });
  }

  const tasks = record.tasks;
  const existingResults: SingleResult[] = [];
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
    const summary = synthesizeTeamRun(record.goal, tasks, [], opts.maxOutput);
    record = setTeamRunStatus(record, "failed", now(), summary);
    await persistIfEnabled(runtime, record);
    return summary;
  }

  record = setTeamRunStatus(record, "running", now());
  await persistIfEnabled(runtime, record);

  const runnableTasks = tasks.filter((task) => task.status === "pending");
  const runWithWorktree = resolveTeamWorktreePolicy(opts);
  const results = await mapWithConcurrencyLimit(runnableTasks, MAX_CONCURRENCY, async (task, index) => {
    const startedAt = now();
    task.status = "in_progress";
    task.startedAt = task.startedAt || startedAt;
    task.updatedAt = startedAt;
    task.heartbeatAt = startedAt;
    record = recordTeamEvent(record, { type: "task_started", taskId: task.id, createdAt: startedAt });
    record = recordTeamMessage(record, {
      taskId: task.id,
      from: "leader",
      to: task.owner,
      kind: "inbox",
      body: buildTeamWorkerPrompt(task, opts),
      createdAt: startedAt,
      deliveredAt: startedAt,
    });
    await persistIfEnabled(runtime, record);
    runtime.emitProgress?.(synthesizeTeamRun(record.goal, tasks, [], opts.maxOutput));
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
        prompt: buildTeamWorkerPrompt(task, opts),
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
    runtime.emitProgress?.(synthesizeTeamRun(record.goal, tasks, [result], opts.maxOutput));
    return result;
  });

  const summary = synthesizeTeamRun(record.goal, tasks, [...existingResults, ...results], opts.maxOutput);
  const finalStatus = summary.success
    ? "completed"
    : tasks.some((task) => task.status === "interrupted" || task.status === "in_progress")
      ? "interrupted"
      : "failed";
  record = recordTeamEvent(record, { type: summary.success ? "run_completed" : "run_failed", createdAt: now() });
  record = setTeamRunStatus(record, finalStatus, now(), summary);
  await persistIfEnabled(runtime, record);
  return summary;
}
