import { execFile, type ExecFileOptions } from "child_process";
import { randomBytes } from "crypto";
import { mkdir } from "fs/promises";
import { join } from "path";
import { shellQuote } from "./shell.js";

export interface TmuxAvailability {
  available: boolean;
  binary?: string;
}

export interface TmuxPaneRef {
  sessionName: string;
  windowName: string;
  paneId: string;
  attachCommand: string;
  logFile: string;
  tmuxBinary?: string;
  sessionAttempt?: string;
}

export interface CreateWorkerPanesOptions {
  runId: string;
  workerCount: number;
  logDir: string;
  windowName?: string;
  binary?: string;
  commandRunner?: TmuxCommandRunner;
  suffixGenerator?: () => string;
}

export type TmuxCommandRunner = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => void;

function runCommand(commandRunner: TmuxCommandRunner, file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    commandRunner(file, args, {}, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.toString());
    });
  });
}

export function parseTmuxAvailability(stdout: string): TmuxAvailability {
  const binary = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return binary ? { available: true, binary } : { available: false };
}

export function parsePaneIds(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function detectTmux(commandRunner: TmuxCommandRunner = execFile as unknown as TmuxCommandRunner): Promise<TmuxAvailability> {
  try {
    return parseTmuxAvailability(await runCommand(commandRunner, "which", ["tmux"]));
  } catch {
    return { available: false };
  }
}

export function buildTmuxSessionName(runId: string): string {
  const safeRunId = runId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "team";
  return `pi-${safeRunId}`;
}

export function buildAttachCommand(ref: { sessionName: string }): string {
  return `tmux attach -t ${ref.sessionName}`;
}

export function buildTmuxSessionAttemptName(runId: string, suffix: string): string {
  return `${buildTmuxSessionName(runId)}-attempt-${suffix}`;
}

function randomSessionSuffix(): string {
  return randomBytes(4).toString("hex");
}

function isDuplicateSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate|duplicate-session|sessions? already exists|session.*exists/i.test(message);
}

async function pipePane(
  commandRunner: TmuxCommandRunner,
  binary: string,
  paneId: string,
  logFile: string,
): Promise<void> {
  await runCommand(commandRunner, binary, ["pipe-pane", "-t", paneId, "-o", `cat >> ${shellQuote(logFile)}`]);
}

export async function createWorkerPanes(options: CreateWorkerPanesOptions): Promise<TmuxPaneRef[]> {
  const commandRunner = options.commandRunner ?? (execFile as unknown as TmuxCommandRunner);
  const binary = options.binary ?? "tmux";
  let sessionName = buildTmuxSessionName(options.runId);
  const windowName = options.windowName ?? "workers";
  let attachCommand = buildAttachCommand({ sessionName });
  const paneRefs: TmuxPaneRef[] = [];

  if (options.workerCount <= 0) return paneRefs;

  await mkdir(options.logDir, { recursive: true });

  const createSession = (name: string) => runCommand(commandRunner, binary, [
    "new-session",
    "-d",
    "-s",
    name,
    "-n",
    windowName,
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  let firstPaneOutput: string;
  let sessionAttempt: string | undefined;
  try {
    firstPaneOutput = await createSession(sessionName);
  } catch (error) {
    if (!isDuplicateSessionError(error)) throw error;
    sessionAttempt = options.suffixGenerator?.() ?? randomSessionSuffix();
    sessionName = buildTmuxSessionAttemptName(options.runId, sessionAttempt);
    attachCommand = buildAttachCommand({ sessionName });
    firstPaneOutput = await createSession(sessionName);
  }
  const firstPaneId = parsePaneIds(firstPaneOutput)[0];
  if (!firstPaneId) throw new Error("tmux did not return a pane id for the new session");

  const firstLogFile = join(options.logDir, "task-1.log");
  await pipePane(commandRunner, binary, firstPaneId, firstLogFile);
  paneRefs.push({
    sessionName,
    windowName,
    paneId: firstPaneId,
    attachCommand,
    logFile: firstLogFile,
    ...(options.binary ? { tmuxBinary: binary } : {}),
    ...(sessionAttempt ? { sessionAttempt } : {}),
  });

  for (let index = 2; index <= options.workerCount; index += 1) {
    const paneId = parsePaneIds(
      await runCommand(commandRunner, binary, ["split-window", "-t", `${sessionName}:${windowName}`, "-P", "-F", "#{pane_id}"]),
    )[0];
    if (!paneId) throw new Error(`tmux did not return a pane id for worker ${index}`);

    const logFile = join(options.logDir, `task-${index}.log`);
    await pipePane(commandRunner, binary, paneId, logFile);
    paneRefs.push({
      sessionName,
      windowName,
      paneId,
      attachCommand,
      logFile,
      ...(options.binary ? { tmuxBinary: binary } : {}),
      ...(sessionAttempt ? { sessionAttempt } : {}),
    });
  }

  await runCommand(commandRunner, binary, ["select-layout", "-t", `${sessionName}:${windowName}`, "tiled"]);
  return paneRefs;
}

export async function killTmuxSession(
  sessionName: string,
  commandRunner: TmuxCommandRunner = execFile as unknown as TmuxCommandRunner,
  binary = "tmux",
): Promise<void> {
  try {
    await runCommand(commandRunner, binary, ["kill-session", "-t", sessionName]);
  } catch {
    // best-effort cleanup
  }
}
