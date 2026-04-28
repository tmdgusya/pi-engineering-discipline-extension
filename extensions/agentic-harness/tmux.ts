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
  eventLogFile: string;
  tmuxBinary?: string;
  sessionAttempt?: string;
  placement?: "detached-session" | "current-window";
}

interface CurrentTmuxContext {
  sessionName: string;
  windowName: string;
  windowId: string;
  paneId: string;
}

export interface CreateWorkerPanesOptions {
  runId: string;
  workerCount: number;
  logDir: string;
  windowName?: string;
  binary?: string;
  commandRunner?: TmuxCommandRunner;
  suffixGenerator?: () => string;
  env?: NodeJS.ProcessEnv;
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

const TMUX_NO_UNDERLINE_STYLE_FLAGS = [
  "nounderscore",
  "nodouble-underscore",
  "nocurly-underscore",
  "nodotted-underscore",
  "nodashed-underscore",
] as const;

const TMUX_COPY_MODE_STYLE_OPTIONS = ["mode-style", "copy-mode-selection-style"] as const;

export function appendNoUnderlineStyleFlags(style: string): string {
  const tokens = style
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  for (const flag of TMUX_NO_UNDERLINE_STYLE_FLAGS) {
    if (!tokens.includes(flag)) tokens.push(flag);
  }
  return tokens.join(",");
}

async function sanitizeTmuxStyleOption(
  commandRunner: TmuxCommandRunner,
  binary: string,
  sessionTarget: string,
  optionName: string,
): Promise<void> {
  let current: string;
  try {
    const stdout = await runCommand(commandRunner, binary, ["show-options", "-gv", "-t", sessionTarget, optionName]);
    current = stdout.trim();
  } catch {
    return;
  }
  if (current === "") return;
  const sanitized = appendNoUnderlineStyleFlags(current);
  if (sanitized === current) return;
  try {
    await runCommand(commandRunner, binary, ["set-option", "-t", sessionTarget, optionName, sanitized]);
  } catch {
    // best-effort: never block pane creation on style cosmetics
  }
}

export async function mitigateCopyModeUnderlineArtifacts(
  commandRunner: TmuxCommandRunner,
  binary: string,
  sessionTarget: string,
): Promise<void> {
  const target = sessionTarget.trim();
  if (target === "") return;
  for (const optionName of TMUX_COPY_MODE_STYLE_OPTIONS) {
    await sanitizeTmuxStyleOption(commandRunner, binary, target, optionName);
  }
}

export async function enableMouseScrolling(
  commandRunner: TmuxCommandRunner,
  binary: string,
  sessionTarget: string,
): Promise<void> {
  const target = sessionTarget.trim();
  if (target === "") return;
  try {
    await runCommand(commandRunner, binary, ["set-option", "-t", target, "mouse", "on"]);
  } catch {
    // If we cannot even enable mouse, skip the rest — there is nothing to mitigate.
    return;
  }
  try {
    await runCommand(commandRunner, binary, ["set-option", "-t", target, "set-clipboard", "on"]);
  } catch {
    // best-effort: OSC 52 is a nice-to-have, do not abort underline mitigation
  }
  await mitigateCopyModeUnderlineArtifacts(commandRunner, binary, target);
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

function parseCurrentTmuxContext(stdout: string, paneId: string): CurrentTmuxContext {
  const [sessionName, windowName, windowId] = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!sessionName || !windowName || !windowId) {
    throw new Error("tmux did not return the current session/window context");
  }
  return { sessionName, windowName, windowId, paneId };
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

async function detectCurrentTmuxContext(
  commandRunner: TmuxCommandRunner,
  binary: string,
  env: NodeJS.ProcessEnv,
): Promise<CurrentTmuxContext | null> {
  if (!env.TMUX || !env.TMUX_PANE) return null;
  const stdout = await runCommand(commandRunner, binary, [
    "display-message",
    "-p",
    "-t",
    env.TMUX_PANE,
    "#{session_name}\n#{window_name}\n#{window_id}",
  ]);
  return parseCurrentTmuxContext(stdout, env.TMUX_PANE);
}

export async function createWorkerPanes(options: CreateWorkerPanesOptions): Promise<TmuxPaneRef[]> {
  const commandRunner = options.commandRunner ?? (execFile as unknown as TmuxCommandRunner);
  const binary = options.binary ?? "tmux";
  const env = options.env ?? process.env;
  let sessionName = buildTmuxSessionName(options.runId);
  const defaultWindowName = options.windowName ?? "workers";
  let attachCommand = buildAttachCommand({ sessionName });
  const paneRefs: TmuxPaneRef[] = [];

  if (options.workerCount <= 0) return paneRefs;

  await mkdir(options.logDir, { recursive: true });

  const currentContext = await detectCurrentTmuxContext(commandRunner, binary, env);
  if (currentContext) {
    attachCommand = buildAttachCommand({ sessionName: currentContext.sessionName });
    if ((env.PI_TEAM_MOUSE ?? "1") !== "0") {
      await enableMouseScrolling(commandRunner, binary, currentContext.sessionName);
    }
    for (let index = 1; index <= options.workerCount; index += 1) {
      const paneId = parsePaneIds(
        await runCommand(commandRunner, binary, ["split-window", "-t", currentContext.paneId, "-P", "-F", "#{pane_id}"]),
      )[0];
      if (!paneId) throw new Error(`tmux did not return a pane id for worker ${index}`);

      const logFile = join(options.logDir, `task-${index}.log`);
      const eventLogFile = join(options.logDir, `task-${index}.events.jsonl`);
      await pipePane(commandRunner, binary, paneId, logFile);
      paneRefs.push({
        sessionName: currentContext.sessionName,
        windowName: currentContext.windowName,
        paneId,
        attachCommand,
        logFile,
        eventLogFile,
        placement: "current-window",
        ...(options.binary ? { tmuxBinary: binary } : {}),
      });
    }

    await runCommand(commandRunner, binary, ["select-layout", "-t", currentContext.windowId, "tiled"]);
    return paneRefs;
  }

  const createSession = (name: string) => runCommand(commandRunner, binary, [
    "new-session",
    "-d",
    "-s",
    name,
    "-n",
    defaultWindowName,
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

  if ((env.PI_TEAM_MOUSE ?? "1") !== "0") {
    await enableMouseScrolling(commandRunner, binary, sessionName);
  }

  const firstLogFile = join(options.logDir, "task-1.log");
  const firstEventLogFile = join(options.logDir, "task-1.events.jsonl");
  await pipePane(commandRunner, binary, firstPaneId, firstLogFile);
  paneRefs.push({
    sessionName,
    windowName: defaultWindowName,
    paneId: firstPaneId,
    attachCommand,
    logFile: firstLogFile,
    eventLogFile: firstEventLogFile,
    placement: "detached-session",
    ...(options.binary ? { tmuxBinary: binary } : {}),
    ...(sessionAttempt ? { sessionAttempt } : {}),
  });

  for (let index = 2; index <= options.workerCount; index += 1) {
    const paneId = parsePaneIds(
      await runCommand(commandRunner, binary, ["split-window", "-t", `${sessionName}:${defaultWindowName}`, "-P", "-F", "#{pane_id}"]),
    )[0];
    if (!paneId) throw new Error(`tmux did not return a pane id for worker ${index}`);

    const logFile = join(options.logDir, `task-${index}.log`);
    const eventLogFile = join(options.logDir, `task-${index}.events.jsonl`);
    await pipePane(commandRunner, binary, paneId, logFile);
    paneRefs.push({
      sessionName,
      windowName: defaultWindowName,
      paneId,
      attachCommand,
      logFile,
      eventLogFile,
      placement: "detached-session",
      ...(options.binary ? { tmuxBinary: binary } : {}),
      ...(sessionAttempt ? { sessionAttempt } : {}),
    });
  }

  await runCommand(commandRunner, binary, ["select-layout", "-t", `${sessionName}:${defaultWindowName}`, "tiled"]);
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

export async function killTmuxPane(
  paneId: string,
  commandRunner: TmuxCommandRunner = execFile as unknown as TmuxCommandRunner,
  binary = "tmux",
): Promise<void> {
  try {
    await runCommand(commandRunner, binary, ["kill-pane", "-t", paneId]);
  } catch {
    // best-effort cleanup
  }
}
