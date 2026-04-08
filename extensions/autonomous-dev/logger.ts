import { appendFile, mkdir, rename, stat } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { homedir } from "os";

const DEFAULT_LOG_PATH = `${homedir()}/.pi/autonomous-dev.log`;
const MAX_LOG_SIZE_BYTES = 1_000_000;

export type AutonomousDevLogLevel = "info" | "warn" | "error";

export interface AutonomousDevLogEntry {
  ts: string;
  level: AutonomousDevLogLevel;
  event: string;
  repo?: string;
  issueNumber?: number;
  issueTitle?: string;
  message?: string;
  details?: Record<string, unknown>;
}

let writeQueue: Promise<void> = Promise.resolve();

export function getAutonomousDevLogPath(): string {
  return process.env.PI_AUTONOMOUS_DEV_LOG_PATH || DEFAULT_LOG_PATH;
}

async function rotateIfNeeded(path: string): Promise<void> {
  if (!existsSync(path)) return;
  if ((await stat(path)).size < MAX_LOG_SIZE_BYTES) return;
  try {
    await rename(path, `${path}.1`);
  } catch {
    // Best-effort rotation only.
  }
}

function sanitize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitize(item)])
    );
  }

  return value;
}

export function logAutonomousDev(level: AutonomousDevLogLevel, event: string, entry: Omit<AutonomousDevLogEntry, "ts" | "level" | "event"> = {}): void {
  const path = getAutonomousDevLogPath();
  const line = `${JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(sanitize(entry) as Record<string, unknown>),
  })}\n`;

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await rotateIfNeeded(path);
      await appendFile(path, line, "utf-8");
    })
    .catch((error) => {
      console.warn("[autonomous-dev] Failed to write log:", error);
    });
}

export async function flushAutonomousDevLogs(): Promise<void> {
  await writeQueue;
}
