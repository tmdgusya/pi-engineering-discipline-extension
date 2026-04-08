import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { flushAutonomousDevLogs, getAutonomousDevLogPath, logAutonomousDev } from "../logger.js";

describe("logger", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    delete process.env.PI_AUTONOMOUS_DEV_LOG_PATH;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("writes structured JSON logs to the configured file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "autonomous-dev-log-"));
    const logPath = join(tempDir, "autonomous-dev.log");
    process.env.PI_AUTONOMOUS_DEV_LOG_PATH = logPath;

    logAutonomousDev("info", "poll.started", {
      repo: "owner/repo",
      issueNumber: 8,
      message: "Polling GitHub issues",
      details: { trackedIssueCount: 1 },
    });
    await flushAutonomousDevLogs();

    expect(getAutonomousDevLogPath()).toBe(logPath);
    expect(existsSync(logPath)).toBe(true);

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      level: "info",
      event: "poll.started",
      repo: "owner/repo",
      issueNumber: 8,
      message: "Polling GitHub issues",
      details: { trackedIssueCount: 1 },
    });
    expect(typeof entry.ts).toBe("string");
  });
});
