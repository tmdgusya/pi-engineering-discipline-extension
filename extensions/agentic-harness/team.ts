import type { AgentConfig } from "./agents.js";
import { MAX_CONCURRENCY, MAX_PARALLEL_TASKS, mapWithConcurrencyLimit } from "./subagent.js";
import { getResultSummaryText, isResultSuccess, type SingleResult } from "./types.js";

export const PI_TEAM_WORKER_ENV = "PI_TEAM_WORKER";

export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

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
}

export interface TeamRunOptions {
  goal: string;
  workerCount?: number;
  agent?: string;
  worktree?: boolean;
  maxOutput?: number;
}

export interface TeamVerificationEvidence {
  checksRun: string[];
  passed: string[];
  failed: string[];
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
  findAgent(name: string): AgentConfig | undefined;
  runTask(input: TeamRunTaskInput, index: number): Promise<SingleResult>;
  summarizeResult?(result: SingleResult, maxOutput?: number): string;
  emitProgress?(summary: TeamRunSummary): void;
}

const WORKER_PROTOCOL = [
  "You are a team worker, not the team leader.",
  "Execute only the bounded assignment below; do not rewrite the global plan.",
  "Do not spawn subagents or delegate to other agents.",
  "Do not run team, ultrawork, autopilot, ralph, or other orchestration commands.",
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
  const worktreeRefs = [result.worktree?.worktreePath, result.worktree?.worktreeDiffFile]
    .filter((value): value is string => !!value);
  return { artifactRefs, worktreeRefs };
}

function createEvidence(tasks: TeamTask[], results: SingleResult[]): TeamVerificationEvidence {
  const artifactRefs = tasks.flatMap((task) => task.artifactRefs);
  const worktreeRefs = tasks.flatMap((task) => task.worktreeRefs);
  const passed = tasks
    .filter((task) => task.status === "completed")
    .map((task) => `${task.id}: worker completed`);
  const failed = tasks
    .filter((task) => task.status === "failed" || task.status === "blocked")
    .map((task) => `${task.id}: ${task.errorMessage || task.status}`);
  const checksRun = results.map((result, index) => `${tasks[index]?.id ?? `task-${index + 1}`}: pi worker execution`);
  return {
    checksRun,
    passed,
    failed,
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
  const success = tasks.length > 0 && completedCount === tasks.length && failedCount === 0 && blockedCount === 0;
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
    tasks,
    finalSynthesis: [
      `Team ${success ? "completed" : "finished with failures"}: ${completedCount}/${tasks.length} completed for goal: ${goal}`,
      ...taskLines,
      "",
      "Verification evidence:",
      `- checksRun: ${verificationEvidence.checksRun.length}`,
      `- passed: ${verificationEvidence.passed.length}`,
      `- failed: ${verificationEvidence.failed.length}`,
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
    `- passed: ${evidence.passed.join("; ") || "none"}`,
    `- failed: ${evidence.failed.join("; ") || "none"}`,
    `- artifactRefs: ${evidence.artifactRefs.join("; ") || "none"}`,
    `- worktreeRefs: ${evidence.worktreeRefs.join("; ") || "none"}`,
    `- notes: ${evidence.notes.join("; ") || "none"}`,
  ].join("\n");
}

export async function runTeam(opts: TeamRunOptions, runtime: TeamRuntime): Promise<TeamRunSummary> {
  const agentName = opts.agent || "worker";
  const tasks = createDefaultTeamTasks(opts.goal, opts.workerCount, agentName);
  const invalidDependency = tasks.find((task) => task.blockedBy.length > 0);
  if (invalidDependency) {
    invalidDependency.status = "blocked";
    invalidDependency.errorMessage = "MVP team mode only supports dependency-free parallel batches.";
    return synthesizeTeamRun(opts.goal, tasks, [], opts.maxOutput);
  }

  const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (task, index) => {
    task.status = "in_progress";
    runtime.emitProgress?.(synthesizeTeamRun(opts.goal, tasks, [], opts.maxOutput));
    const result = await runtime.runTask({
      task,
      prompt: buildTeamWorkerPrompt(task, opts),
      agent: runtime.findAgent(task.agent),
      agentName: task.agent,
      worktree: opts.worktree,
      maxOutput: opts.maxOutput,
      extraEnv: {
        [PI_TEAM_WORKER_ENV]: "1",
        PI_SUBAGENT_MAX_DEPTH: "1",
      },
    }, index);

    const summarize = runtime.summarizeResult ?? getResultSummaryText;
    task.resultSummary = summarize(result, opts.maxOutput);
    const refs = taskRefs(result);
    task.artifactRefs = refs.artifactRefs;
    task.worktreeRefs = refs.worktreeRefs;
    if (isResultSuccess(result)) {
      task.status = "completed";
    } else {
      task.status = "failed";
      task.errorMessage = result.errorMessage || result.stderr || `exitCode ${result.exitCode}`;
    }
    runtime.emitProgress?.(synthesizeTeamRun(opts.goal, tasks, [result], opts.maxOutput));
    return result;
  });

  return synthesizeTeamRun(opts.goal, tasks, results, opts.maxOutput);
}
