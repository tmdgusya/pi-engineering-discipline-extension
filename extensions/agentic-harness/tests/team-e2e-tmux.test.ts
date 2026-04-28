import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../agents.js";
import { resolveDepthConfig, runAgent } from "../subagent.js";
import type { TeamRunRecord } from "../team-state.js";
import { runTeam } from "../team.js";

describe.runIf(process.platform !== "win32")("team mode tmux e2e", () => {
  it("runs team backend=tmux end-to-end without leaking env values in send-keys payload", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "team-e2e-tmux-"));
    const runnerScript = join(tempDir, "runner.mjs");
    const fakeTmux = join(tempDir, "tmux");
    const callsFile = join(tempDir, "tmux-calls.log");
    const argvFile = join(tempDir, "runner-argv.log");
    const tmuxStateFile = join(tempDir, "tmux-state.json");

    writeFileSync(runnerScript, [
      "import { appendFileSync, mkdirSync, writeFileSync } from 'fs';",
      "import { dirname } from 'path';",
      `const argvFile = ${JSON.stringify(argvFile)};`,
      "appendFileSync(argvFile, process.argv.slice(2).join(' ') + '\\n---RUN---\\n');",
      "if (process.argv.includes('--mode') || process.argv.includes('json') || process.argv.includes('-p')) {",
      "  console.error('unexpected non-cli worker args: ' + process.argv.slice(2).join(' '));",
      "  process.exit(9);",
      "}",
      "console.log('normal pi cli pane output');",
      "if (process.env.PI_SUBAGENT_OUTPUT_FILE) {",
      "  mkdirSync(dirname(process.env.PI_SUBAGENT_OUTPUT_FILE), { recursive: true });",
      "  writeFileSync(process.env.PI_SUBAGENT_OUTPUT_FILE, 'team worker done from artifact', 'utf8');",
      "}",
    ].join("\n"));

    writeFileSync(fakeTmux, [
      `#!${process.execPath}`,
      "const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('fs');",
      "const { spawnSync } = require('child_process');",
      "const args = process.argv.slice(2);",
      `const callsFile = ${JSON.stringify(callsFile)};`,
      `const stateFile = ${JSON.stringify(tmuxStateFile)};`,
      "const load = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { nextPane: 1, paneLogs: {} };",
      "const save = (state) => writeFileSync(stateFile, JSON.stringify(state), 'utf8');",
      "appendFileSync(callsFile, process.argv[1] + ' ' + args.join(' ') + '\\n');",
      "if (args[0] === 'new-session') {",
      "  const state = load();",
      "  const pane = `%${state.nextPane++}`;",
      "  save(state);",
      "  process.stdout.write(`${pane}\\n`);",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'split-window') {",
      "  const state = load();",
      "  const pane = `%${state.nextPane++}`;",
      "  save(state);",
      "  process.stdout.write(`${pane}\\n`);",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'pipe-pane') {",
      "  const state = load();",
      "  const pane = args[args.indexOf('-t') + 1];",
      "  const cmd = args[args.length - 1] || '';",
      "  const match = cmd.match(/cat\\s*>>\\s*(.+)$/);",
      "  let logFile = match ? match[1].trim() : '';",
      "  if ((logFile.startsWith(\"'\") && logFile.endsWith(\"'\")) || (logFile.startsWith('\"') && logFile.endsWith('\"'))) logFile = logFile.slice(1, -1);",
      "  state.paneLogs[pane] = logFile;",
      "  save(state);",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'send-keys') {",
      "  const state = load();",
      "  const pane = args[args.indexOf('-t') + 1];",
      "  const command = args[args.length - 2];",
      "  const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8' });",
      "  const logFile = state.paneLogs[pane];",
      "  if (logFile) appendFileSync(logFile, (result.stdout || '') + (result.stderr || ''));",
      "  process.exit(result.status ?? 0);",
      "}",
      "if (args[0] === 'select-layout' || args[0] === 'kill-session' || args[0] === 'kill-pane') process.exit(0);",
      "process.exit(0);",
    ].join("\n"));
    chmodSync(fakeTmux, 0o755);

    const fixtureAgent: AgentConfig = {
      name: "worker",
      description: "fixture worker",
      source: "project",
      filePath: runnerScript,
      systemPrompt: "",
      tools: [],
    };

    const originalPath = process.env.PATH;
    const originalArgv = process.argv;
    const originalTmux = process.env.TMUX;
    const originalTmuxPane = process.env.TMUX_PANE;
    process.env.PATH = `${tempDir}:${originalPath || ""}`;
    delete process.env.TMUX;
    delete process.env.TMUX_PANE;
    process.argv = [process.execPath, runnerScript];
    const records: TeamRunRecord[] = [];
    const latestRecord = (runId: string): TeamRunRecord | undefined => {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index].runId === runId) return records[index];
      }
      return undefined;
    };
    const runtime = {
      findAgent: () => fixtureAgent,
      persistRun: (record: TeamRunRecord) => { records.push(JSON.parse(JSON.stringify(record))); },
      loadRun: async (runId: string) => {
        const record = latestRecord(runId);
        if (!record) throw new Error(`missing persisted run: ${runId}`);
        return JSON.parse(JSON.stringify(record));
      },
      runTask: (input: any) => runAgent({
        agent: input.agent,
        agentName: input.agentName,
        task: input.prompt,
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: `team-e2e-worker-${records.length}`, owner: "test-suite" },
        executionMode: input.task.terminal?.backend === "tmux" ? "tmux" : "native",
        tmuxPane: input.task.terminal?.backend === "tmux"
          ? {
            sessionName: input.task.terminal.sessionName!,
            windowName: input.task.terminal.windowName!,
            paneId: input.task.terminal.paneId!,
            logFile: input.task.terminal.logFile!,
            eventLogFile: input.task.terminal.eventLogFile,
            attachCommand: input.task.terminal.attachCommand!,
            tmuxBinary: input.task.terminal.tmuxBinary,
            sessionAttempt: input.task.terminal.sessionAttempt,
          }
          : undefined,
        extraEnv: {
          ...input.extraEnv,
          PI_DEBUG_SECRET: "super-secret-token-value",
        },
        makeDetails: (results) => ({ mode: "single", results }),
      }),
    };

    try {
      const summary = await runTeam(
        {
          goal: "verify tmux team e2e",
          workerCount: 1,
          agent: "worker",
          backend: "tmux",
          runId: "team-e2e-tmux",
        },
        runtime,
      );

      expect(summary.success).toBe(true);
      expect(summary.backendUsed).toBe("tmux");
      expect(summary.tasks).toHaveLength(1);
      expect(summary.tasks[0].status).toBe("completed");
      expect(summary.finalSynthesis).toContain("tmux attach -t");

      expect(summary.tasks[0].resultSummary).toContain("team worker done from artifact");

      const followUp = await runTeam(
        {
          resumeRunId: "team-e2e-tmux",
          commandTarget: "worker-1",
          commandMessage: "follow-up command through durable inbox",
          backend: "tmux",
        },
        runtime,
      );

      expect(followUp.success).toBe(true);
      expect(followUp.tasks).toHaveLength(1);
      expect(followUp.tasks[0].status).toBe("completed");
      expect(followUp.tasks[0].resultSummary).toContain("team worker done from artifact");

      const finalRecord = latestRecord("team-e2e-tmux");
      expect(finalRecord?.commands.at(-1)).toMatchObject({
        owner: "worker-1",
        body: "follow-up command through durable inbox",
        status: "completed",
      });
      expect(finalRecord?.events.map((event: any) => event.type)).toEqual(expect.arrayContaining([
        "command_enqueued",
        "command_acknowledged",
        "command_started",
        "command_completed",
      ]));

      const calls = readFileSync(callsFile, "utf8");
      const runnerArgv = readFileSync(argvFile, "utf8");
      expect(calls).toContain("send-keys -t");
      expect((calls.match(/send-keys -t/g) || []).length).toBeGreaterThanOrEqual(2);
      expect(calls).not.toContain("--mode json");
      expect(calls).not.toContain(" -p ");
      expect(calls).not.toContain("PI_TMUX_RENDERER");
      expect(calls).not.toContain("super-secret-token-value");
      expect(runnerArgv).toContain("follow-up command through durable inbox");
      expect(runnerArgv).not.toContain("--mode json");
      expect(runnerArgv).not.toContain(" -p ");
    } finally {
      process.env.PATH = originalPath;
      if (originalTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = originalTmux;
      if (originalTmuxPane === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = originalTmuxPane;
      process.argv = originalArgv;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
