import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runAgent, resolveDepthConfig } from "../subagent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureScript = join(__dirname, "fixtures", "subagent-parent.mjs");
const originalArgv = [...process.argv];
const trackedPids = new Set<number>();
const tempDirs: string[] = [];

function isPidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== "ESRCH";
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs: number = 25): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function loadState(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

afterEach(() => {
  process.argv = [...originalArgv];
  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  trackedPids.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.runIf(process.platform !== "win32")("runAgent process ownership", () => {
  it("reaps the owned process group after semantic success", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-success-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");
    const logFile = join(tempDir, "process.log");

    process.argv = [process.execPath, fixtureScript];

    const result = await runAgent({
      agent: {
        name: "fixture",
        description: "fixture agent",
        filePath: fixtureScript,
        source: "project",
        systemPrompt: "",
        tools: [],
      },
      agentName: "fixture",
      task: "success-hang",
      cwd: tempDir,
      depthConfig: resolveDepthConfig(),
      ownership: { runId: "root-success-run", owner: "test-suite" },
      extraEnv: {
        FIXTURE_STATE_FILE: stateFile,
        PI_SUBAGENT_PROCESS_LOG: logFile,
      },
      makeDetails: (results) => ({ mode: "single", results }),
    });

    await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
    const state = loadState(stateFile);
    trackedPids.add(state.parentPid);
    trackedPids.add(state.grandchildPid);

    expect(result.exitCode).toBe(0);
    expect(state.runId).toBe("root-success-run");
    expect(state.rootRunId).toBe(process.env.PI_SUBAGENT_ROOT_RUN_ID || "root-success-run");

    await waitFor(() => !isPidAlive(state.parentPid) && !isPidAlive(state.grandchildPid), 4000);

    const processLog = readFileSync(logFile, "utf8");
    expect(processLog).toContain('"phase":"spawned"');
    expect(processLog).toContain('"phase":"terminating"');
    expect(processLog).toContain('"phase":"closed"');
    expect(processLog).toContain('"runId":"root-success-run"');

    const events = readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const closedEvent = events.find((event) => event.phase === "closed");
    expect(closedEvent).toMatchObject({
      phase: "closed",
      runId: "root-success-run",
      signal: "SIGTERM",
      exitCode: null,
    });
  });

  it("does not convert a post-agent_end failure into success", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-agent-end-fail-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");

    process.argv = [process.execPath, fixtureScript];

    const result = await runAgent({
      agent: {
        name: "fixture",
        description: "fixture agent",
        filePath: fixtureScript,
        source: "project",
        systemPrompt: "",
        tools: [],
      },
      agentName: "fixture",
      task: "agent-end-fail",
      cwd: tempDir,
      depthConfig: resolveDepthConfig(),
      ownership: { runId: "root-agent-end-fail", owner: "test-suite" },
      extraEnv: {
        FIXTURE_STATE_FILE: stateFile,
      },
      makeDetails: (results) => ({ mode: "single", results }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("error");
  });

  it("keeps semantic success when abort arrives after agent_end", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-late-abort-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");

    process.argv = [process.execPath, fixtureScript];
    const controller = new AbortController();

    const runPromise = runAgent({
      agent: {
        name: "fixture",
        description: "fixture agent",
        filePath: fixtureScript,
        source: "project",
        systemPrompt: "",
        tools: [],
      },
      agentName: "fixture",
      task: "success-hang",
      cwd: tempDir,
      depthConfig: resolveDepthConfig(),
      ownership: { runId: "root-late-abort", owner: "test-suite" },
      extraEnv: {
        FIXTURE_STATE_FILE: stateFile,
      },
      signal: controller.signal,
      makeDetails: (results) => ({ mode: "single", results }),
    });

    await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(0);
    expect(result.stopReason).not.toBe("aborted");
  });

  it("kills owned descendants when aborted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-abort-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");

    process.argv = [process.execPath, fixtureScript];
    const controller = new AbortController();

    const runPromise = runAgent({
      agent: {
        name: "fixture",
        description: "fixture agent",
        filePath: fixtureScript,
        source: "project",
        systemPrompt: "",
        tools: [],
      },
      agentName: "fixture",
      task: "abort-hang",
      cwd: tempDir,
      depthConfig: resolveDepthConfig(),
      ownership: { runId: "root-abort-run", owner: "test-suite" },
      extraEnv: {
        FIXTURE_STATE_FILE: stateFile,
      },
      signal: controller.signal,
      makeDetails: (results) => ({ mode: "single", results }),
    });

    await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
    const state = loadState(stateFile);
    trackedPids.add(state.parentPid);
    trackedPids.add(state.grandchildPid);

    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(130);
    expect(result.stopReason).toBe("aborted");
    await waitFor(() => !isPidAlive(state.parentPid) && !isPidAlive(state.grandchildPid), 4000);
  });
});
