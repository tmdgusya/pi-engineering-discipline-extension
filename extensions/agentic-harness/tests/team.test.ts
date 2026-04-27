import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PARALLEL_TASKS } from "../subagent.js";
import type { TmuxAvailability } from "../tmux.js";
import { emptyUsage, type SingleResult } from "../types.js";
const tmuxMock = vi.hoisted(() => ({
  detectTmux: vi.fn(async (): Promise<TmuxAvailability> => ({ available: false })),
  createWorkerPanes: vi.fn(),
  killTmuxSession: vi.fn(async () => undefined),
}));

vi.mock("../tmux.js", () => tmuxMock);

import {
  buildTeamWorkerPrompt,
  createDefaultTeamTasks,
  formatTeamRunSummary,
  runTeam,
  resolveTeamWorktreePolicy,
  synthesizeTeamRun,
  validateTeamTasks,
} from "../team.js";

afterEach(() => {
  tmuxMock.detectTmux.mockReset().mockResolvedValue({ available: false });
  tmuxMock.createWorkerPanes.mockReset();
  tmuxMock.killTmuxSession.mockReset().mockResolvedValue(undefined);
});

function fakeResult(agent: string, task: string, text: string, overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent,
    agentSource: "bundled",
    task,
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    ],
    stderr: "",
    usage: emptyUsage(),
    stopReason: "stop",
    ...overrides,
  };
}

describe("createDefaultTeamTasks", () => {
  it("creates stable dependency-free task records assigned to the selected agent", () => {
    const tasks = createDefaultTeamTasks("Add lightweight team mode", 3, "worker");

    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.id)).toEqual(["task-1", "task-2", "task-3"]);
    expect(tasks.map((task) => task.owner)).toEqual(["worker-1", "worker-2", "worker-3"]);
    expect(tasks.every((task) => task.agent === "worker")).toBe(true);
    expect(tasks.every((task) => task.status === "pending")).toBe(true);
    expect(tasks.every((task) => task.blockedBy.length === 0)).toBe(true);
  });

  it("clamps worker count to MAX_PARALLEL_TASKS", () => {
    const tasks = createDefaultTeamTasks("Large coordinated change", MAX_PARALLEL_TASKS + 5, "worker");

    expect(tasks).toHaveLength(MAX_PARALLEL_TASKS);
    expect(tasks.at(-1)?.id).toBe(`task-${MAX_PARALLEL_TASKS}`);
    expect(tasks.at(-1)?.owner).toBe(`worker-${MAX_PARALLEL_TASKS}`);
  });
});

describe("buildTeamWorkerPrompt", () => {
  it("codifies worker non-orchestration and reporting requirements", () => {
    const [task] = createDefaultTeamTasks("Implement native team mode", 1, "worker");
    const prompt = buildTeamWorkerPrompt(task, { goal: "Implement native team mode", workerCount: 1, agent: "worker" });

    expect(prompt).toContain("not the leader");
    expect(prompt).toContain("Do not spawn subagents");
    expect(prompt).toContain("team/ultrawork/autopilot/ralph");
    expect(prompt).toContain("changed files");
    expect(prompt).toContain("verification");
    expect(prompt).toContain("blockers");
  });
});

describe("validateTeamTasks", () => {
  it("rejects blockedBy dependencies in the MVP parallel-batch scheduler", () => {
    const [task] = createDefaultTeamTasks("Goal", 1, "worker");
    const invalid = [{ ...task, blockedBy: ["task-0"] }];

    expect(() => validateTeamTasks(invalid)).toThrow(/blockedBy|dependencies|parallel batch/i);
  });
});

describe("runTeam", () => {
  it("dispatches fake workers and returns successful synthesis with evidence", async () => {
    const calls: Array<{ taskId: string; prompt: string; extraEnv?: Record<string, string> }> = [];

    const summary = await runTeam(
      { goal: "Ship lightweight native team mode", workerCount: 2, agent: "worker", maxOutput: 1_000 },
      {
        runTask: async ({ task, prompt, extraEnv }) => {
          calls.push({ taskId: task.id, prompt, extraEnv });
          return fakeResult(task.agent, prompt, `${task.id} done`, {
            artifacts: { outputFile: `.pi/team/${task.id}.md` },
            worktree: { worktreePath: `/tmp/${task.id}`, worktreeDiffFile: `.pi/team/${task.id}.diff` },
          });
        },
      },
    );

    expect(calls.map((call) => call.taskId)).toEqual(["task-1", "task-2"]);
    expect(calls.every((call) => call.extraEnv?.PI_TEAM_WORKER === "1")).toBe(true);
    expect(summary.ok).toBe(true);
    expect(summary.backendRequested).toBe("auto");
    expect(summary.backendUsed).toBe("native");
    expect(summary.tasks[0].terminal).toMatchObject({
      backend: "native",
    });
    expect(summary.completedCount).toBe(2);
    expect(summary.failedCount).toBe(0);
    expect(summary.tasks.map((task) => task.status)).toEqual(["completed", "completed"]);
    expect(summary.finalSynthesis).toContain("task-1 done");
    expect(summary.finalSynthesis).toContain("task-2 done");
    expect(summary.verificationEvidence.checksRun.length).toBeGreaterThan(0);
    expect(summary.verificationEvidence.passed).toBe(true);
    expect(summary.verificationEvidence.failed).toBe(false);
    expect(summary.verificationEvidence.artifactRefs).toEqual([".pi/team/task-1.md", ".pi/team/task-2.md"]);
    expect(summary.verificationEvidence.worktreeRefs).toEqual(["/tmp/task-1", "/tmp/task-2"]);
  });

  it("uses tmux automatically when available and includes attach metadata in summaries", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "pi-team-run-1",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-team-run-1",
        logFile: "/tmp/team-run-1/task-1.log",
      },
      {
        sessionName: "pi-team-run-1",
        windowName: "workers",
        paneId: "%2",
        attachCommand: "tmux attach -t pi-team-run-1",
        logFile: "/tmp/team-run-1/task-2.log",
      },
    ]);

    const summary = await runTeam(
      { goal: "Run tmux workers", workerCount: 2, agent: "worker", runId: "team-run-1" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, `${task.id} done`, { terminal: task.terminal }),
      },
    );

    expect(summary.backendRequested).toBe("auto");
    expect(summary.backendUsed).toBe("tmux");
    expect(summary.tasks.every((task) => task.terminal?.backend === "tmux")).toBe(true);
    expect(summary.tasks[0].terminal).toMatchObject({
      sessionName: "pi-team-run-1",
      paneId: "%1",
      attachCommand: "tmux attach -t pi-team-run-1",
    });
    expect(summary.finalSynthesis).toContain("tmux attach -t");
    expect(summary.success).toBe(true);
  });

  it("propagates detected tmux binary metadata to panes, workers, and cleanup", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/opt/custom/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "pi-custom-binary",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-custom-binary",
        logFile: "/tmp/custom-binary/task-1.log",
      },
    ]);
    const terminals: any[] = [];

    const summary = await runTeam(
      { goal: "Use custom tmux", workerCount: 1, agent: "worker", runId: "custom-binary" },
      {
        runTask: async ({ task, prompt }) => {
          terminals.push(task.terminal);
          return fakeResult(task.agent, prompt, "custom tmux done", { terminal: task.terminal });
        },
      },
    );

    expect(summary.success).toBe(true);
    expect(tmuxMock.createWorkerPanes).toHaveBeenCalledWith(expect.objectContaining({ binary: "/opt/custom/tmux" }));
    expect(terminals[0]).toMatchObject({ backend: "tmux", tmuxBinary: "/opt/custom/tmux" });
    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-custom-binary", undefined, "/opt/custom/tmux");
  });

  it("converts tmux pane setup failures into persisted failed summaries", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/opt/custom/tmux" });
    tmuxMock.createWorkerPanes.mockRejectedValue(new Error("tmux setup exploded"));
    const records: any[] = [];

    const summary = await runTeam(
      { goal: "Fail setup cleanly", workerCount: 2, agent: "worker", runId: "setup-failure" },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-27T00:10:0${tick++}.000Z`;
        })(),
        persistRun: (record) => {
          records.push(JSON.parse(JSON.stringify(record)));
        },
        runTask: async () => {
          throw new Error("workers must not run after tmux setup failure");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(false);
    expect(summary.failedCount).toBe(2);
    expect(summary.tasks.map((task) => task.status)).toEqual(["failed", "failed"]);
    expect(summary.tasks.every((task) => task.errorMessage === "tmux setup exploded")).toBe(true);
    expect(finalRecord.status).toBe("failed");
    expect(finalRecord.summary.success).toBe(false);
    expect(finalRecord.events.filter((event: any) => event.type === "task_failed")).toHaveLength(2);
    expect(finalRecord.events.at(-1).type).toBe("run_failed");
  });

  it("falls back to native when tmux is unavailable in auto mode", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: false });

    const summary = await runTeam(
      { goal: "Fallback workers", workerCount: 1, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "fallback done", { terminal: task.terminal }),
      },
    );

    expect(summary.backendRequested).toBe("auto");
    expect(summary.backendUsed).toBe("native");
    expect(summary.tasks[0].terminal).toMatchObject({ backend: "native" });
    expect(summary.success).toBe(true);
    expect(summary.finalSynthesis).toContain("fallback done");
  });

  it("persists lifecycle records plus inbox/outbox messages when persistence is enabled", async () => {
    const records: any[] = [];

    const summary = await runTeam(
      { goal: "Persist lifecycle", workerCount: 1, agent: "worker", runId: "team-persist-test", heartbeatMs: 0 },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-27T00:00:0${tick++}.000Z`;
        })(),
        persistRun: (record) => {
          records.push(JSON.parse(JSON.stringify(record)));
        },
        runTask: async ({ task, prompt, worktree }) => {
          expect(worktree).toBe(false);
          return fakeResult(task.agent, prompt, "persisted worker done");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(true);
    expect(records.length).toBeGreaterThan(2);
    expect(finalRecord.status).toBe("completed");
    expect(finalRecord.runId).toBe("team-persist-test");
    expect(finalRecord.events.map((event: any) => event.type)).toEqual(expect.arrayContaining([
      "run_created",
      "task_created",
      "task_started",
      "message_recorded",
      "task_completed",
      "run_completed",
    ]));
    expect(finalRecord.messages.map((message: any) => message.kind)).toEqual(["inbox", "outbox"]);
  });

  it("resumes stale in-progress records conservatively without reporting success", async () => {
    const [task] = createDefaultTeamTasks("Resume interrupted run", 1, "worker");
    task.status = "in_progress";
    task.startedAt = "2026-04-27T00:00:00.000Z";
    task.updatedAt = "2026-04-27T00:00:00.000Z";
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-resume-loaded",
      goal: "Resume interrupted run",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
      status: "running",
      options: { goal: "Resume interrupted run" },
      tasks: [task],
      events: [],
      messages: [],
    };

    const summary = await runTeam(
      {
        goal: "Resume interrupted run",
        resumeRunId: "team-resume-loaded",
        staleTaskMs: 1_000,
        resumeMode: "mark-interrupted",
      },
      {
        now: () => "2026-04-27T00:01:00.000Z",
        loadRun: async () => loadedRecord,
        runTask: async () => {
          throw new Error("interrupted resume tasks must not run without retry-stale");
        },
      },
    );

    expect(summary.success).toBe(false);
    expect(summary.tasks[0].status).toBe("interrupted");
    expect(summary.verificationEvidence.failed).toBe(true);
  });

  it("keeps the public run summary JSON-serializable with stable task and evidence fields", async () => {
    const summary = await runTeam(
      { goal: "Document the team mode contract", workerCount: 1, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "contract locked", {
          artifacts: {
            artifactDir: ".pi/team/run-1",
            outputFile: ".pi/team/run-1/task-1.md",
            progressFile: ".pi/team/run-1/task-1.progress.md",
            readFiles: ["README.md"],
          },
          worktree: { worktreePath: "/tmp/team-task-1" },
        }),
      },
    );

    const reparsed = JSON.parse(JSON.stringify(summary));

    expect(reparsed).toMatchObject({
      goal: "Document the team mode contract",
      taskCount: 1,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      success: true,
      ok: true,
      tasks: [
        {
          id: "task-1",
          owner: "worker-1",
          agent: "worker",
          status: "completed",
          artifactRefs: [
            ".pi/team/run-1",
            ".pi/team/run-1/task-1.md",
            ".pi/team/run-1/task-1.progress.md",
            "README.md",
          ],
          worktreeRefs: ["/tmp/team-task-1"],
        },
      ],
      verificationEvidence: {
        checksRun: ["task-1: pi worker execution"],
        passed: true,
        failed: false,
        passedChecks: ["task-1: worker completed"],
        failedChecks: [],
      },
    });
  });

  it("marks the run failed when any worker fails", async () => {
    const summary = await runTeam(
      { goal: "Ship lightweight native team mode", workerCount: 2, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => {
          if (task.id === "task-2") {
            return fakeResult(task.agent, prompt, "worker failed", {
              exitCode: 1,
              stopReason: "error",
              stderr: "boom",
              errorMessage: "boom",
            });
          }
          return fakeResult(task.agent, prompt, "worker succeeded");
        },
      },
    );

    expect(summary.ok).toBe(false);
    expect(summary.completedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.tasks.map((task) => task.status)).toEqual(["completed", "failed"]);
    expect(summary.finalSynthesis).toContain("worker succeeded");
    expect(summary.finalSynthesis).toContain("boom");
    expect(summary.verificationEvidence.passed).toBe(false);
    expect(summary.verificationEvidence.failed).toBe(true);
  });

  it("formats structured verification evidence without dropping refs or failure details", () => {
    const [task] = createDefaultTeamTasks("Summarize partial run", 1, "worker");
    task.status = "failed";
    task.resultSummary = "worker reported incomplete verification";
    task.errorMessage = "verification failed";
    task.artifactRefs = [".pi/team/task-1.md"];
    task.worktreeRefs = ["/tmp/team-task-1"];

    const summary = synthesizeTeamRun("Summarize partial run", task ? [task] : [], [
      fakeResult("worker", "prompt", "worker reported incomplete verification", {
        exitCode: 1,
        errorMessage: "verification failed",
      }),
    ]);

    const formatted = formatTeamRunSummary(summary);

    expect(formatted).toContain("Team finished with failures");
    expect(formatted).toContain("checksRun: task-1: pi worker execution");
    expect(formatted).toContain("passed: false (none)");
    expect(formatted).toContain("failed: true (task-1: verification failed)");
    expect(formatted).toContain("artifactRefs: .pi/team/task-1.md");
    expect(formatted).toContain("worktreeRefs: /tmp/team-task-1");
    expect(formatted).toContain("MVP team mode uses dependency-free parallel-batch task records");
  });
});

describe("resolveTeamWorktreePolicy", () => {
  it("keeps the legacy boolean behavior while exposing explicit policy names", () => {
    expect(resolveTeamWorktreePolicy({ worktree: true })).toBe(true);
    expect(resolveTeamWorktreePolicy({ worktree: false })).toBe(false);
    expect(resolveTeamWorktreePolicy({ worktree: false, worktreePolicy: "on" })).toBe(true);
    expect(resolveTeamWorktreePolicy({ worktree: true, worktreePolicy: "off" })).toBe(false);
    expect(resolveTeamWorktreePolicy({ worktree: true, worktreePolicy: "auto" })).toBe(true);
    expect(resolveTeamWorktreePolicy({ worktree: false, worktreePolicy: "auto" })).toBe(false);
  });
});
