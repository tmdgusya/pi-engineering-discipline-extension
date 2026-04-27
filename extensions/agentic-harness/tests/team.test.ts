import { describe, expect, it } from "vitest";
import { MAX_PARALLEL_TASKS } from "../subagent.js";
import { emptyUsage, type SingleResult } from "../types.js";
import {
  buildTeamWorkerPrompt,
  createDefaultTeamTasks,
  runTeam,
  validateTeamTasks,
} from "../team.js";

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
});
