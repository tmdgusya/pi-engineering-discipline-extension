import { mkdir, readdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import type { TeamRunOptions, TeamRunSummary, TeamTask, TeamTaskStatus } from "./team.js";

export const TEAM_RUN_SCHEMA_VERSION = 1;
export const PI_TEAM_RUN_STATE_ROOT_ENV = "PI_TEAM_RUN_STATE_ROOT";
export const TEAM_RUN_FILE = "team-run.json";

export type TeamRunStatus = "created" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type TeamEventType =
  | "run_created"
  | "run_resumed"
  | "run_completed"
  | "run_failed"
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_interrupted";

export interface TeamRunEvent {
  id: string;
  type: TeamEventType;
  runId: string;
  taskId?: string;
  createdAt: string;
  message?: string;
}

export interface TeamRunRecord {
  schemaVersion: typeof TEAM_RUN_SCHEMA_VERSION;
  runId: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: TeamRunStatus;
  options: TeamRunOptionsSnapshot;
  tasks: TeamTask[];
  events: TeamRunEvent[];
  summary?: TeamRunSummary;
}

export type TeamRunOptionsSnapshot = Pick<TeamRunOptions,
  "goal" | "workerCount" | "agent" | "worktree" | "maxOutput" | "runId" | "resumeRunId" | "resumeMode" | "staleTaskMs"
>;

export type StaleTaskResumeMode = "mark-interrupted" | "retry-stale";

export interface MarkStaleRunningTasksOptions {
  now: string;
  staleTaskMs?: number;
  mode?: StaleTaskResumeMode;
}

export function generateTeamRunId(): string {
  return `team-${randomBytes(8).toString("hex")}`;
}

export function defaultTeamRunStateRoot(cwd = process.cwd()): string {
  return process.env[PI_TEAM_RUN_STATE_ROOT_ENV] || join(cwd, ".pi", "agent", "runs");
}

export function teamRunRecordPath(rootDir: string, runId: string): string {
  return join(rootDir, runId, TEAM_RUN_FILE);
}

function eventId(runId: string, index: number): string {
  return `${runId}-event-${index + 1}`;
}

function taskTimestamp(task: TeamTask): string | undefined {
  return task.updatedAt || task.startedAt;
}

export function createTeamRunRecord(params: {
  runId?: string;
  goal: string;
  options?: Partial<TeamRunOptions>;
  tasks: TeamTask[];
  now: string;
}): TeamRunRecord {
  const runId = params.runId || generateTeamRunId();
  const createdEvents = params.tasks.map((task, index): TeamRunEvent => ({
    id: eventId(runId, index),
    type: "task_created",
    runId,
    taskId: task.id,
    createdAt: params.now,
  }));
  return {
    schemaVersion: TEAM_RUN_SCHEMA_VERSION,
    runId,
    goal: params.goal,
    createdAt: params.now,
    updatedAt: params.now,
    status: "created",
    options: {
      goal: params.goal,
      workerCount: params.options?.workerCount,
      agent: params.options?.agent,
      worktree: params.options?.worktree,
      maxOutput: params.options?.maxOutput,
      runId: params.options?.runId,
      resumeRunId: params.options?.resumeRunId,
      resumeMode: params.options?.resumeMode,
      staleTaskMs: params.options?.staleTaskMs,
    },
    tasks: params.tasks,
    events: [
      { id: eventId(runId, -1), type: "run_created", runId, createdAt: params.now },
      ...createdEvents,
    ],
  };
}

export function recordTeamEvent(record: TeamRunRecord, event: Omit<TeamRunEvent, "id" | "runId" | "createdAt"> & { createdAt?: string }): TeamRunRecord {
  const createdAt = event.createdAt || record.updatedAt;
  return {
    ...record,
    updatedAt: createdAt,
    events: [
      ...record.events,
      {
        id: eventId(record.runId, record.events.length),
        runId: record.runId,
        type: event.type,
        taskId: event.taskId,
        createdAt,
        message: event.message,
      },
    ],
  };
}

export function setTeamRunStatus(record: TeamRunRecord, status: TeamRunStatus, now: string, summary?: TeamRunSummary): TeamRunRecord {
  return {
    ...record,
    status,
    updatedAt: now,
    summary,
  };
}

export function markStaleRunningTasks(record: TeamRunRecord, options: MarkStaleRunningTasksOptions): TeamRunRecord {
  const staleTaskMs = options.staleTaskMs ?? 0;
  const nowMs = Date.parse(options.now);
  let next = { ...record, tasks: record.tasks.map((task) => ({ ...task })), events: [...record.events], updatedAt: options.now };

  next.tasks = next.tasks.map((task) => {
    if (task.status !== "in_progress") return task;
    const timestamp = taskTimestamp(task);
    const age = timestamp ? nowMs - Date.parse(timestamp) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(age) && age < staleTaskMs) return task;

    const status: TeamTaskStatus = options.mode === "retry-stale" ? "pending" : "interrupted";
    const message = options.mode === "retry-stale"
      ? `Stale in-progress task reset for retry during resume at ${options.now}.`
      : `Stale in-progress task interrupted during resume at ${options.now}.`;
    next = recordTeamEvent(next, { type: "task_interrupted", taskId: task.id, createdAt: options.now, message });
    return {
      ...task,
      status,
      updatedAt: options.now,
      errorMessage: status === "interrupted" ? message : task.errorMessage,
    };
  });

  return next;
}

export async function writeTeamRunRecord(record: TeamRunRecord, rootDir = defaultTeamRunStateRoot()): Promise<string> {
  const file = teamRunRecordPath(rootDir, record.runId);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  await rename(tmp, file);
  return file;
}

export async function readTeamRunRecord(runId: string, rootDir = defaultTeamRunStateRoot()): Promise<TeamRunRecord> {
  const file = teamRunRecordPath(rootDir, runId);
  const raw = await readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as TeamRunRecord;
  if (parsed.schemaVersion !== TEAM_RUN_SCHEMA_VERSION) {
    throw new Error(`Unsupported team run schema version for ${runId}: ${String((parsed as any).schemaVersion)}`);
  }
  return parsed;
}

export async function listTeamRuns(rootDir = defaultTeamRunStateRoot()): Promise<TeamRunRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records: TeamRunRecord[] = [];
  for (const entry of entries) {
    try {
      records.push(await readTeamRunRecord(entry, rootDir));
    } catch {
      // Ignore non-run directories/corrupt records in list mode. Direct reads still throw.
    }
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
