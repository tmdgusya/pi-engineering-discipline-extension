import { mkdir, readdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import type { TeamRunOptions, TeamRunSummary, TeamTask, TeamTaskStatus } from "./team.js";

export const TEAM_RUN_SCHEMA_VERSION = 1;
export const PI_TEAM_RUN_STATE_ROOT_ENV = "PI_TEAM_RUN_STATE_ROOT";
export const TEAM_RUN_FILE = "team-run.json";
export const TEAM_COMMAND_MAX_ATTEMPT = 3;

export type TeamRunStatus = "created" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type TeamEventType =
  | "run_created"
  | "run_resumed"
  | "run_completed"
  | "run_failed"
  | "message_recorded"
  | "task_created"
  | "task_started"
  | "task_heartbeat"
  | "task_completed"
  | "task_failed"
  | "task_interrupted"
  | "command_enqueued"
  | "command_acknowledged"
  | "command_started"
  | "command_completed"
  | "command_blocked"
  | "command_failed"
  | "command_stale"
  | "command_retried"
  | "command_conflict";

export interface TeamRunEvent {
  id: string;
  type: TeamEventType;
  runId: string;
  taskId?: string;
  commandId?: string;
  createdAt: string;
  message?: string;
}

export type TeamCommandStatus = "queued" | "acknowledged" | "started" | "completed" | "blocked" | "failed" | "stale";

export interface TeamCommand {
  id: string;
  runId: string;
  taskId: string;
  owner: string;
  sequence: number;
  attempt: number;
  status: TeamCommandStatus;
  statusVersion: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string;
  completedAt?: string;
  resultSummary?: string;
  errorMessage?: string;
  artifactRefs: string[];
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
  commands: TeamCommand[];
  events: TeamRunEvent[];
  messages: TeamMessage[];
  summary?: TeamRunSummary;
}

export type TeamRunOptionsSnapshot = Pick<TeamRunOptions,
  "goal" | "workerCount" | "agent" | "worktree" | "worktreePolicy" | "backend" | "maxOutput" | "runId" | "resumeRunId" | "resumeMode" | "staleTaskMs" | "commandTarget" | "commandMessage"
>;

export type StaleTaskResumeMode = "mark-interrupted" | "retry-stale";
export type TeamMessageKind = "inbox" | "outbox" | "status" | "error";

export interface TeamMessage {
  id: string;
  runId: string;
  taskId: string;
  from: string;
  to: string;
  kind: TeamMessageKind;
  body: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface MarkStaleRunningTasksOptions {
  now: string;
  staleTaskMs?: number;
  mode?: StaleTaskResumeMode;
}

export interface MarkStaleCommandsOptions extends MarkStaleRunningTasksOptions {
  maxAttempt?: number;
}

export interface CommandTransitionOptions {
  expectedStatusVersion?: number;
  now?: string;
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

function commandTimestamp(command: TeamCommand): string {
  return command.updatedAt || command.lastAttemptAt || command.createdAt;
}

function terminalCommandStatus(status: TeamCommandStatus): boolean {
  return status === "completed" || status === "blocked" || status === "failed" || status === "stale";
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
      worktreePolicy: params.options?.worktreePolicy,
      backend: params.options?.backend,
      maxOutput: params.options?.maxOutput,
      runId: params.options?.runId,
      resumeRunId: params.options?.resumeRunId,
      resumeMode: params.options?.resumeMode,
      staleTaskMs: params.options?.staleTaskMs,
      commandTarget: params.options?.commandTarget,
      commandMessage: params.options?.commandMessage,
    },
    tasks: params.tasks,
    commands: [],
    events: [
      { id: eventId(runId, -1), type: "run_created", runId, createdAt: params.now },
      ...createdEvents,
    ],
    messages: [],
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
        commandId: event.commandId,
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

export function recordTeamMessage(record: TeamRunRecord, message: Omit<TeamMessage, "id" | "runId">): TeamRunRecord {
  const id = `${record.runId}-message-${record.messages.length + 1}`;
  const next: TeamRunRecord = {
    ...record,
    updatedAt: message.createdAt,
    messages: [
      ...record.messages,
      {
        ...message,
        id,
        runId: record.runId,
      },
    ],
  };
  return recordTeamEvent(next, {
    type: "message_recorded",
    taskId: message.taskId,
    createdAt: message.createdAt,
    message: `${message.kind}:${message.from}->${message.to}`,
  });
}

export function enqueueTeamCommand(record: TeamRunRecord, params: {
  taskId: string;
  owner: string;
  body: string;
  createdAt: string;
}): TeamRunRecord {
  const sequence = record.commands.length + 1;
  const command: TeamCommand = {
    id: `${record.runId}-command-${sequence}`,
    runId: record.runId,
    taskId: params.taskId,
    owner: params.owner,
    sequence,
    attempt: 1,
    status: "queued",
    statusVersion: 0,
    body: params.body,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
    lastAttemptAt: params.createdAt,
    artifactRefs: [],
  };
  return recordTeamEvent({ ...record, updatedAt: params.createdAt, commands: [...record.commands, command] }, {
    type: "command_enqueued",
    taskId: params.taskId,
    commandId: command.id,
    createdAt: params.createdAt,
    message: `queued:${params.owner}`,
  });
}

function transitionConflict(record: TeamRunRecord, command: TeamCommand, now: string, expected: number): TeamRunRecord {
  return recordTeamEvent(record, {
    type: "command_conflict",
    taskId: command.taskId,
    commandId: command.id,
    createdAt: now,
    message: `statusVersion conflict: expected ${expected}, found ${command.statusVersion}`,
  });
}

function updateCommand(record: TeamRunRecord, command: TeamCommand): TeamRunRecord {
  return {
    ...record,
    updatedAt: command.updatedAt,
    commands: record.commands.map((candidate) => candidate.id === command.id ? command : candidate),
  };
}

function transitionCommand(record: TeamRunRecord, commandId: string, status: TeamCommandStatus, eventType: TeamEventType, opts: CommandTransitionOptions & {
  resultSummary?: string;
  errorMessage?: string;
  artifactRefs?: string[];
  incrementAttempt?: boolean;
  clearTerminalFields?: boolean;
  message?: string;
} = {}): TeamRunRecord {
  const command = record.commands.find((candidate) => candidate.id === commandId);
  if (!command) return record;
  const now = opts.now || record.updatedAt;
  if (opts.expectedStatusVersion !== undefined && command.statusVersion !== opts.expectedStatusVersion) {
    return transitionConflict(record, command, now, opts.expectedStatusVersion);
  }
  if (!opts.incrementAttempt && !terminalCommandStatus(command.status) && command.status === status) {
    return record;
  }
  if (terminalCommandStatus(command.status)) {
    const sameTerminal = command.status === status
      && (opts.resultSummary === undefined || command.resultSummary === opts.resultSummary)
      && (opts.errorMessage === undefined || command.errorMessage === opts.errorMessage);
    if (sameTerminal) return record;
    if (status !== "queued") {
      return recordTeamEvent(record, {
        type: "command_conflict",
        taskId: command.taskId,
        commandId,
        createdAt: now,
        message: `terminal command cannot transition from ${command.status} to ${status}`,
      });
    }
  }
  const next: TeamCommand = {
    ...command,
    status,
    statusVersion: command.statusVersion + 1,
    updatedAt: now,
    lastAttemptAt: opts.incrementAttempt ? now : command.lastAttemptAt,
    attempt: opts.incrementAttempt ? command.attempt + 1 : command.attempt,
    completedAt: status === "completed" || status === "blocked" || status === "failed" || status === "stale" ? now : opts.clearTerminalFields ? undefined : command.completedAt,
    resultSummary: opts.clearTerminalFields ? undefined : opts.resultSummary ?? command.resultSummary,
    errorMessage: opts.clearTerminalFields ? undefined : opts.errorMessage ?? command.errorMessage,
    artifactRefs: opts.clearTerminalFields ? [] : opts.artifactRefs ?? command.artifactRefs,
  };
  return recordTeamEvent(updateCommand(record, next), {
    type: eventType,
    taskId: next.taskId,
    commandId,
    createdAt: now,
    message: opts.message || `${command.status}->${status}`,
  });
}

export function acknowledgeTeamCommand(record: TeamRunRecord, commandId: string, opts: CommandTransitionOptions = {}): TeamRunRecord {
  return transitionCommand(record, commandId, "acknowledged", "command_acknowledged", opts);
}

export function startTeamCommand(record: TeamRunRecord, commandId: string, opts: CommandTransitionOptions = {}): TeamRunRecord {
  return transitionCommand(record, commandId, "started", "command_started", opts);
}

export function completeTeamCommand(record: TeamRunRecord, commandId: string, params: CommandTransitionOptions & {
  resultSummary: string;
  artifactRefs?: string[];
}): TeamRunRecord {
  return transitionCommand(record, commandId, "completed", "command_completed", {
    ...params,
    resultSummary: params.resultSummary,
    artifactRefs: params.artifactRefs ?? [],
  });
}

export function blockTeamCommand(record: TeamRunRecord, commandId: string, params: CommandTransitionOptions & { errorMessage: string }): TeamRunRecord {
  return transitionCommand(record, commandId, "blocked", "command_blocked", params);
}

export function failTeamCommand(record: TeamRunRecord, commandId: string, params: CommandTransitionOptions & { errorMessage: string }): TeamRunRecord {
  return transitionCommand(record, commandId, "failed", "command_failed", params);
}

export function retryTeamCommand(record: TeamRunRecord, commandId: string, params: CommandTransitionOptions & { reason: string; maxAttempt?: number }): TeamRunRecord {
  const command = record.commands.find((candidate) => candidate.id === commandId);
  if (!command) return record;
  const now = params.now || record.updatedAt;
  const maxAttempt = params.maxAttempt ?? TEAM_COMMAND_MAX_ATTEMPT;
  if (params.expectedStatusVersion !== undefined && command.statusVersion !== params.expectedStatusVersion) {
    return transitionConflict(record, command, now, params.expectedStatusVersion);
  }
  if (command.attempt >= maxAttempt) {
    return blockTeamCommand(record, commandId, { now, errorMessage: `Retry cap reached at attempt ${command.attempt}: ${params.reason}` });
  }
  return transitionCommand(record, commandId, "queued", "command_retried", {
    now,
    incrementAttempt: true,
    clearTerminalFields: true,
    message: `retry attempt ${command.attempt + 1}: ${params.reason}`,
  });
}

export function markStaleCommands(record: TeamRunRecord, options: MarkStaleCommandsOptions): TeamRunRecord {
  const staleTaskMs = options.staleTaskMs ?? 0;
  const nowMs = Date.parse(options.now);
  let next = record;
  for (const command of record.commands) {
    if (terminalCommandStatus(command.status)) continue;
    const timestampMs = Date.parse(commandTimestamp(command));
    const age = Number.isFinite(nowMs) && Number.isFinite(timestampMs)
      ? nowMs - timestampMs
      : Number.POSITIVE_INFINITY;
    const isStale = staleTaskMs <= 0 || !Number.isFinite(age) || age < 0 || age >= staleTaskMs;
    if (!isStale) continue;
    if (options.mode === "retry-stale") {
      next = retryTeamCommand(next, command.id, { now: options.now, reason: `stale at ${options.now}`, maxAttempt: options.maxAttempt });
    } else {
      next = transitionCommand(next, command.id, "stale", "command_stale", { now: options.now, errorMessage: `Command stale at ${options.now}` });
    }
  }
  return next;
}

export function projectTeamTasksFromCommands(record: TeamRunRecord): TeamRunRecord {
  if (!record.commands.length) return record;
  const latestByTask = new Map<string, TeamCommand>();
  for (const command of record.commands) {
    const existing = latestByTask.get(command.taskId);
    if (!existing || command.sequence >= existing.sequence) latestByTask.set(command.taskId, command);
  }
  return {
    ...record,
    tasks: record.tasks.map((task) => {
      const command = latestByTask.get(task.id);
      if (!command) return task;
      if (command.status === "queued" || command.status === "acknowledged" || command.status === "started") {
        return { ...task, status: "in_progress", updatedAt: command.updatedAt };
      }
      if (command.status === "completed") {
        return {
          ...task,
          status: "completed",
          updatedAt: command.updatedAt,
          completedAt: command.completedAt || command.updatedAt,
          resultSummary: command.resultSummary ?? task.resultSummary,
          artifactRefs: command.artifactRefs.length ? command.artifactRefs : task.artifactRefs,
        };
      }
      if (command.status === "blocked") {
        return { ...task, status: "blocked", updatedAt: command.updatedAt, errorMessage: command.errorMessage ?? task.errorMessage };
      }
      if (command.status === "failed") {
        return { ...task, status: "failed", updatedAt: command.updatedAt, errorMessage: command.errorMessage ?? task.errorMessage };
      }
      return { ...task, status: "interrupted", updatedAt: command.updatedAt, errorMessage: command.errorMessage ?? task.errorMessage };
    }),
  };
}

export function markStaleRunningTasks(record: TeamRunRecord, options: MarkStaleRunningTasksOptions): TeamRunRecord {
  const staleTaskMs = options.staleTaskMs ?? 0;
  const nowMs = Date.parse(options.now);
  let next = { ...record, tasks: record.tasks.map((task) => ({ ...task })), events: [...record.events], updatedAt: options.now };

  const mappedTasks = next.tasks.map((task) => {
    if (task.status !== "in_progress") return task;
    const timestamp = taskTimestamp(task);
    const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
    const age = Number.isFinite(nowMs) && Number.isFinite(timestampMs)
      ? nowMs - timestampMs
      : Number.POSITIVE_INFINITY;
    const isStale = staleTaskMs <= 0 || !Number.isFinite(age) || age < 0 || age >= staleTaskMs;
    if (!isStale) return task;

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
  next = { ...next, tasks: mappedTasks };
  next = markStaleCommands(next, options);

  return projectTeamTasksFromCommands(next);
}

export function normalizeTeamRunRecord(record: TeamRunRecord): TeamRunRecord {
  if (record.schemaVersion !== TEAM_RUN_SCHEMA_VERSION) {
    throw new Error(`Unsupported team run schema version for ${record.runId}: ${String((record as any).schemaVersion)}`);
  }
  return {
    ...record,
    commands: Array.isArray((record as any).commands) ? (record as any).commands : [],
    events: Array.isArray(record.events) ? record.events : [],
    messages: Array.isArray(record.messages) ? record.messages : [],
  };
}

export async function writeTeamRunRecord(record: TeamRunRecord, rootDir = defaultTeamRunStateRoot()): Promise<string> {
  const file = teamRunRecordPath(rootDir, record.runId);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(normalizeTeamRunRecord(record), null, 2)}\n`, "utf-8");
  await rename(tmp, file);
  return file;
}

export async function readTeamRunRecord(runId: string, rootDir = defaultTeamRunStateRoot()): Promise<TeamRunRecord> {
  const file = teamRunRecordPath(rootDir, runId);
  const raw = await readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as TeamRunRecord;
  return normalizeTeamRunRecord(parsed);
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
