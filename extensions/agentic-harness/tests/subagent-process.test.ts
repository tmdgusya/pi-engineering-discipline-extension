import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  it("does not complete from a stale tmux exit marker", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-tmux-stale-"));
    tempDirs.push(tempDir);
    const fakeTmux = join(tempDir, "tmux");
    const logFile = join(tempDir, "pane.log");
    const runnerScript = join(tempDir, "runner.mjs");
    writeFileSync(logFile, "old output\n__PI_TMUX_EXIT:77\n");
    writeFileSync(runnerScript, [
      "const message = { role: 'assistant', content: [{ type: 'text', text: 'fresh tmux result' }] };",
      "console.log(JSON.stringify({ type: 'message_end', message }));",
      "console.log(JSON.stringify({ type: 'agent_end', messages: [message] }));",
    ].join("\n"));
    writeFileSync(fakeTmux, [
      "#!/usr/bin/env node",
      "const { spawnSync } = require('child_process');",
      "const { appendFileSync } = require('fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'send-keys') {",
      "  const command = args[args.length - 2];",
      "  const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8' });",
      `  appendFileSync(${JSON.stringify(logFile)}, (result.stdout || '') + (result.stderr || ''));`,
      "  process.exit(result.status ?? 0);",
      "}",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(fakeTmux, 0o755);

    process.argv = [process.execPath, runnerScript];
    const originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}:${originalPath || ""}`;
    try {
      const result = await runAgent({
        agent: {
          name: "fixture",
          description: "fixture agent",
          filePath: runnerScript,
          source: "project",
          systemPrompt: "",
          tools: [],
        },
        agentName: "fixture",
        task: "tmux-stale",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "tmux-stale-run", owner: "test-suite" },
        executionMode: "tmux",
        tmuxPane: {
          sessionName: "pi-team-run-stale",
          windowName: "workers",
          paneId: "%1",
          logFile,
          attachCommand: "tmux attach -t pi-team-run-stale",
        },
        makeDetails: (results) => ({ mode: "single", results }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.messages.at(-1)?.content?.[0]?.text).toContain("fresh tmux result");
      expect(readFileSync(logFile, "utf8")).not.toContain("__PI_TMUX_EXIT:77");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("does not duplicate tmux log writes with tee", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-tmux-tee-"));
    tempDirs.push(tempDir);
    const fakeTmux = join(tempDir, "tmux");
    const logFile = join(tempDir, "pane.log");
    const commandFile = join(tempDir, "command.txt");
    const runnerScript = join(tempDir, "runner.mjs");
    writeFileSync(runnerScript, "console.log('not executed');\n");
    writeFileSync(fakeTmux, [
      "#!/usr/bin/env node",
      "const { writeFileSync, appendFileSync } = require('fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'send-keys') {",
      "  const command = args[args.length - 2];",
      `  writeFileSync(${JSON.stringify(commandFile)}, command);`,
      `  appendFileSync(${JSON.stringify(logFile)}, "__PI_TMUX_EXIT:0\\n");`,
      "}",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(fakeTmux, 0o755);

    process.argv = [process.execPath, runnerScript];
    const originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}:${originalPath || ""}`;
    try {
      const result = await runAgent({
        agent: {
          name: "fixture",
          description: "fixture agent",
          filePath: runnerScript,
          source: "project",
          systemPrompt: "",
          tools: [],
        },
        agentName: "fixture",
        task: "tmux-no-tee",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "tmux-no-tee-run", owner: "test-suite" },
        executionMode: "tmux",
        tmuxPane: {
          sessionName: "pi-team-run-no-tee",
          windowName: "workers",
          paneId: "%1",
          logFile,
          attachCommand: "tmux attach -t pi-team-run-no-tee",
        },
        makeDetails: (results) => ({ mode: "single", results }),
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(commandFile, "utf8")).not.toContain("tee -a");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("uses tmux log tail text for non-zero failures", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-tmux-failure-"));
    tempDirs.push(tempDir);
    const fakeTmux = join(tempDir, "tmux");
    const logFile = join(tempDir, "pane.log");
    const runnerScript = join(tempDir, "runner.mjs");
    writeFileSync(runnerScript, "console.error('tmux exploded');\nprocess.exit(7);\n");
    writeFileSync(fakeTmux, [
      "#!/usr/bin/env node",
      "const { spawnSync } = require('child_process');",
      "const { appendFileSync } = require('fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'send-keys') {",
      "  const command = args[args.length - 2];",
      "  const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8' });",
      `  appendFileSync(${JSON.stringify(logFile)}, (result.stdout || '') + (result.stderr || ''));`,
      "  process.exit(result.status ?? 0);",
      "}",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(fakeTmux, 0o755);

    process.argv = [process.execPath, runnerScript];
    const originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}:${originalPath || ""}`;
    try {
      const result = await runAgent({
        agent: {
          name: "fixture",
          description: "fixture agent",
          filePath: runnerScript,
          source: "project",
          systemPrompt: "",
          tools: [],
        },
        agentName: "fixture",
        task: "tmux-failure",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "tmux-failure-run", owner: "test-suite" },
        executionMode: "tmux",
        tmuxPane: {
          sessionName: "pi-team-run-failure",
          windowName: "workers",
          paneId: "%1",
          logFile,
          attachCommand: "tmux attach -t pi-team-run-failure",
        },
        makeDetails: (results) => ({ mode: "single", results }),
      });

      expect(result.exitCode).toBe(7);
      expect(result.stderr || result.errorMessage).toContain("tmux exploded");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("emits tmux lifecycle events with terminal metadata", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-tmux-lifecycle-"));
    tempDirs.push(tempDir);
    const fakeTmux = join(tempDir, "tmux");
    const logFile = join(tempDir, "pane.log");
    const processLog = join(tempDir, "process.log");
    const runnerScript = join(tempDir, "runner.mjs");
    const lifecycleEvents: any[] = [];
    writeFileSync(runnerScript, [
      "const message = { role: 'assistant', content: [{ type: 'text', text: 'lifecycle done' }] };",
      "console.log(JSON.stringify({ type: 'message_end', message }));",
      "console.log(JSON.stringify({ type: 'agent_end', messages: [message] }));",
    ].join("\n"));
    writeFileSync(fakeTmux, [
      "#!/usr/bin/env node",
      "const { spawnSync } = require('child_process');",
      "const { appendFileSync } = require('fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'send-keys') {",
      "  const command = args[args.length - 2];",
      "  const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8' });",
      `  appendFileSync(${JSON.stringify(logFile)}, (result.stdout || '') + (result.stderr || ''));`,
      "  process.exit(result.status ?? 0);",
      "}",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(fakeTmux, 0o755);

    process.argv = [process.execPath, runnerScript];
    const originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}:${originalPath || ""}`;
    try {
      const result = await runAgent({
        agent: {
          name: "fixture",
          description: "fixture agent",
          filePath: runnerScript,
          source: "project",
          systemPrompt: "",
          tools: [],
        },
        agentName: "fixture",
        task: "tmux-lifecycle",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "tmux-lifecycle-run", owner: "test-suite" },
        extraEnv: {
          PI_SUBAGENT_PROCESS_LOG: processLog,
        },
        executionMode: "tmux",
        tmuxPane: {
          sessionName: "pi-team-run-lifecycle",
          windowName: "workers",
          paneId: "%1",
          logFile,
          attachCommand: "tmux attach -t pi-team-run-lifecycle",
        },
        onLifecycleEvent: (event) => lifecycleEvents.push(event),
        makeDetails: (results) => ({ mode: "single", results }),
      });

      expect(result.exitCode).toBe(0);
      expect(lifecycleEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: "spawned", backend: "tmux", sessionName: "pi-team-run-lifecycle", paneId: "%1" }),
        expect.objectContaining({ phase: "closed", backend: "tmux", sessionName: "pi-team-run-lifecycle", paneId: "%1", exitCode: 0 }),
      ]));
      const loggedEvents = readFileSync(processLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(loggedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: "spawned", backend: "tmux", sessionName: "pi-team-run-lifecycle", paneId: "%1" }),
        expect.objectContaining({ phase: "closed", backend: "tmux", sessionName: "pi-team-run-lifecycle", paneId: "%1", exitCode: 0 }),
      ]));
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("uses the provided tmux binary for send-keys", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-tmux-binary-"));
    tempDirs.push(tempDir);
    const customTmux = join(tempDir, "custom-tmux");
    const logFile = join(tempDir, "pane.log");
    const callsFile = join(tempDir, "calls.log");
    const runnerScript = join(tempDir, "runner.mjs");
    writeFileSync(runnerScript, [
      "const message = { role: 'assistant', content: [{ type: 'text', text: 'custom tmux binary done' }] };",
      "console.log(JSON.stringify({ type: 'message_end', message }));",
      "console.log(JSON.stringify({ type: 'agent_end', messages: [message] }));",
    ].join("\n"));
    writeFileSync(customTmux, [
      `#!${process.execPath}`,
      "const { spawnSync } = require('child_process');",
      "const { appendFileSync } = require('fs');",
      `appendFileSync(${JSON.stringify(callsFile)}, process.argv[1] + ' ' + process.argv.slice(2).join(' ') + '\\n');`,
      "const args = process.argv.slice(2);",
      "if (args[0] === 'send-keys') {",
      "  const command = args[args.length - 2];",
      "  const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8' });",
      `  appendFileSync(${JSON.stringify(logFile)}, (result.stdout || '') + (result.stderr || ''));`,
      "  process.exit(result.status ?? 0);",
      "}",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(customTmux, 0o755);

    process.argv = [process.execPath, runnerScript];
    const originalPath = process.env.PATH;
    process.env.PATH = tempDir;
    try {
      const result = await runAgent({
        agent: {
          name: "fixture",
          description: "fixture agent",
          filePath: runnerScript,
          source: "project",
          systemPrompt: "",
          tools: [],
        },
        agentName: "fixture",
        task: "tmux-custom-binary",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "tmux-custom-binary-run", owner: "test-suite" },
        executionMode: "tmux",
        extraEnv: {
          PI_DEBUG_SECRET: "super-secret-token-value",
        },
        tmuxPane: {
          sessionName: "pi-team-run-custom-binary",
          windowName: "workers",
          paneId: "%1",
          logFile,
          attachCommand: "tmux attach -t pi-team-run-custom-binary",
          tmuxBinary: customTmux,
        },
        makeDetails: (results) => ({ mode: "single", results }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.messages.at(-1)?.content?.[0]?.text).toContain("custom tmux binary done");
      const tmuxCalls = readFileSync(callsFile, "utf8");
      expect(tmuxCalls).toContain(`${customTmux} send-keys -t %1`);
      expect(tmuxCalls).not.toContain("super-secret-token-value");
      expect(result.terminal).toMatchObject({ backend: "tmux", tmuxBinary: customTmux });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("runs a worker command through a provided tmux pane log", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-tmux-"));
    tempDirs.push(tempDir);
    const fakeTmux = join(tempDir, "tmux");
    const logFile = join(tempDir, "pane.log");
    const runnerScript = join(tempDir, "runner.mjs");
    writeFileSync(runnerScript, [
      "const message = { role: 'assistant', content: [{ type: 'text', text: 'done from tmux' }] };",
      "console.log(JSON.stringify({ type: 'message_end', message }));",
      "console.log(JSON.stringify({ type: 'agent_end', messages: [message] }));",
    ].join("\n"));
    writeFileSync(fakeTmux, [
      "#!/usr/bin/env node",
      "const { spawnSync } = require('child_process');",
      "const { appendFileSync } = require('fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'send-keys') {",
      "  const command = args[args.length - 2];",
      "  const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8' });",
      `  appendFileSync(${JSON.stringify(logFile)}, (result.stdout || '') + (result.stderr || ''));`,
      "  process.exit(result.status ?? 0);",
      "}",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(fakeTmux, 0o755);

    process.argv = [process.execPath, runnerScript];
    const originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}:${originalPath || ""}`;
    try {
      const result = await runAgent({
        agent: {
          name: "fixture",
          description: "fixture agent",
          filePath: runnerScript,
          source: "project",
          systemPrompt: "",
          tools: [],
        },
        agentName: "fixture",
        task: "tmux-done",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "tmux-run", owner: "test-suite" },
        executionMode: "tmux",
        tmuxPane: {
          sessionName: "pi-team-run-1",
          windowName: "workers",
          paneId: "%1",
          logFile,
          attachCommand: "tmux attach -t pi-team-run-1",
        },
        makeDetails: (results) => ({ mode: "single", results }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.terminal).toMatchObject({
        backend: "tmux",
        sessionName: "pi-team-run-1",
        attachCommand: "tmux attach -t pi-team-run-1",
      });
      expect(result.messages.at(-1)?.content?.[0]?.text).toContain("done");
    } finally {
      process.env.PATH = originalPath;
    }
  });

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
    let sawSemanticOutput = false;

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
      onUpdate: (partial) => {
        sawSemanticOutput = partial.content.some((item) => item.type === "text" && item.text.includes("fixture complete"));
      },
      makeDetails: (results) => ({ mode: "single", results }),
    });

    await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
    await waitFor(() => sawSemanticOutput, 2000);
    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(0);
    expect(result.stopReason).not.toBe("aborted");
  });

  it("passes --fork and the parent session id when context fork is requested", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-fork-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");
    const originalForkSession = process.env.PI_SUBAGENT_FORK_SESSION;

    process.argv = [process.execPath, fixtureScript];
    process.env.PI_SUBAGENT_FORK_SESSION = "parent-session-123";

    try {
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
        ownership: { runId: "root-fork-run", owner: "test-suite" },
        extraEnv: {
          FIXTURE_STATE_FILE: stateFile,
        },
        contextMode: "fork",
        makeDetails: (results) => ({ mode: "single", results }),
      });

      await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
      const state = loadState(stateFile);
      trackedPids.add(state.parentPid);
      trackedPids.add(state.grandchildPid);

      expect(result.exitCode).toBe(0);
      expect(result.contextMode).toBe("fork");
      expect(state.contextMode).toBe("fork");
      expect(state.argv).toContain("--fork");
      expect(state.argv).toContain("parent-session-123");
      expect(state.argv).not.toContain("--no-session");
    } finally {
      if (originalForkSession === undefined) delete process.env.PI_SUBAGENT_FORK_SESSION;
      else process.env.PI_SUBAGENT_FORK_SESSION = originalForkSession;
    }
  });

  it("reads artifact output written by the child process", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-output-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");
    const originalArtifactRoot = process.env.PI_SUBAGENT_ARTIFACT_ROOT;

    process.argv = [process.execPath, fixtureScript];
    process.env.PI_SUBAGENT_ARTIFACT_ROOT = join(tempDir, ".runs");

    try {
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
        task: "write-output",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "root-output-run", rootRunId: "root-output-run", owner: "test-suite" },
        extraEnv: {
          FIXTURE_STATE_FILE: stateFile,
        },
        output: "final.md",
        makeDetails: (results) => ({ mode: "single", results }),
      });

      const state = loadState(stateFile);

      const artifactDir = result.artifacts?.artifactDir;

      expect(result.exitCode).toBe(0);
      expect(artifactDir).toBe(join(tempDir, ".runs", "root-output-run", "subagents", "fixture-root-output-run"));
      expect(result.artifacts?.outputFile).toBe(join(artifactDir!, "final.md"));
      expect(state.outputFile).toBe(result.artifacts?.outputFile);
      expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "artifact final answer" }]);
    } finally {
      if (originalArtifactRoot === undefined) delete process.env.PI_SUBAGENT_ARTIFACT_ROOT;
      else process.env.PI_SUBAGENT_ARTIFACT_ROOT = originalArtifactRoot;
    }
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
