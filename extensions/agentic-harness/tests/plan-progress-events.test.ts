import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanProgressTracker } from "../plan-progress.js";
import {
  completePlanSubagentTasks,
  extractPlanPathsFromArgs,
  getToolExecutionArgs,
  loadPlanFromToolResultEvent,
  reloadPlanFromSubagentArgs,
  startPlanSubagentTasks,
} from "../plan-progress-events.js";

const PLAN_PATH = "docs/engineering-discipline/plans/event-plan.md";

function samplePlan(goal: string, taskName = "Load event plan"): string {
  return [
    "# Event Plan",
    "",
    `**Goal:** ${goal}`,
    "",
    "**Verification Strategy:**",
    "- **Level:** test-suite",
    "- **Command:** `npx vitest run tests/plan-progress-events.test.ts`",
    "- **What it validates:** Event wiring loads real plan markdown",
    "",
    "---",
    "",
    `### Task 1: ${taskName}`,
    "",
    "**Dependencies:** None",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Load the plan**",
    "",
    "Run: `npx vitest run tests/plan-progress-events.test.ts`",
    "Expected: pass",
    "",
  ].join("\n");
}

function trackingPlan(): string {
  return [
    "# Tracking Plan",
    "",
    "**Goal:** Track subagent task execution",
    "",
    "**Verification Strategy:**",
    "- **Level:** test-suite",
    "- **Command:** `npx vitest run tests/plan-progress-events.test.ts`",
    "- **What it validates:** subagent tracking transitions",
    "",
    "---",
    "",
    "### Task 1: Wire single tracking",
    "",
    "**Dependencies:** None",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Track single mode**",
    "",
    "Run: `npx vitest run tests/plan-progress-events.test.ts`",
    "Expected: pass",
    "",
    "### Task 2: Wire parallel tracking",
    "",
    "**Dependencies:** Task 1",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Track parallel mode**",
    "",
    "Run: `npx vitest run tests/plan-progress-events.test.ts`",
    "Expected: pass",
    "",
    "### Task 3: Wire chain tracking",
    "",
    "**Dependencies:** Task 2",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Track chain mode**",
    "",
    "Run: `npx vitest run tests/plan-progress-events.test.ts`",
    "Expected: pass",
    "",
  ].join("\n");
}

async function createTempPlan(markdown: string): Promise<{ cwd: string; path: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "plan-progress-events-"));
  const planPath = join(cwd, PLAN_PATH);
  await mkdir(join(cwd, "docs/engineering-discipline/plans"), { recursive: true });
  await writeFile(planPath, markdown, "utf-8");
  tempRoots.push(cwd);
  return { cwd, path: PLAN_PATH };
}

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    await rm(root, { recursive: true, force: true });
  }
});

function loadTrackingPlan(): PlanProgressTracker {
  const tracker = new PlanProgressTracker();
  tracker.loadPlan(trackingPlan());
  return tracker;
}

describe("plan progress event loading", () => {
  it("loads write events from input.content plan markdown", async () => {
    const tracker = new PlanProgressTracker();

    const loaded = await loadPlanFromToolResultEvent(tracker, {
      toolName: "write",
      input: { path: PLAN_PATH, content: samplePlan("Loaded from write input") },
      content: [{ type: "text", text: "Wrote file" }],
    });

    expect(loaded).toBe(true);
    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Loaded from write input");
  });

  it("does not wipe an existing plan when a write event only has a confirmation result", async () => {
    const tracker = new PlanProgressTracker();
    tracker.loadPlan(samplePlan("Existing valid plan"));

    const loaded = await loadPlanFromToolResultEvent(tracker, {
      toolName: "write",
      input: { path: PLAN_PATH },
      content: [{ type: "text", text: "Wrote file" }],
    });

    expect(loaded).toBe(false);
    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Existing valid plan");
  });

  it("loads read events from result text", async () => {
    const tracker = new PlanProgressTracker();

    const loaded = await loadPlanFromToolResultEvent(tracker, {
      toolName: "read",
      input: { path: PLAN_PATH },
      content: [{ type: "text", text: samplePlan("Loaded from read result") }],
    });

    expect(loaded).toBe(true);
    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Loaded from read result");
  });

  it("resolves relative read and write plan paths against cwd for disk fallback", async () => {
    const markdown = samplePlan("Loaded from disk fallback");
    const { cwd, path } = await createTempPlan(markdown);

    const readTracker = new PlanProgressTracker();
    const readLoaded = await loadPlanFromToolResultEvent(readTracker, {
      toolName: "read",
      input: { path },
      content: [{ type: "text", text: "not plan markdown" }],
    }, cwd);

    const writeTracker = new PlanProgressTracker();
    const writeLoaded = await loadPlanFromToolResultEvent(writeTracker, {
      toolName: "write",
      input: { path },
      content: [{ type: "text", text: "Wrote file" }],
    }, cwd);

    expect(readLoaded).toBe(true);
    expect(readTracker.getGoal()).toBe("Loaded from disk fallback");
    expect(writeLoaded).toBe(true);
    expect(writeTracker.getGoal()).toBe("Loaded from disk fallback");
  });

  it("reloads subagent single-mode args from planFile before task tracking starts", async () => {
    const { cwd, path } = await createTempPlan(samplePlan("Loaded from planFile", "Run Task 1"));
    const tracker = new PlanProgressTracker();

    const loaded = await reloadPlanFromSubagentArgs(tracker, {
      agent: "plan-worker",
      task: "Task 1",
      planFile: path,
    }, cwd);

    expect(loaded).toBe(true);
    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Loaded from planFile");
    expect(tracker.startTaskByMatch("Task 1")).toBe(1);
  });

  it("reloads subagent args from reads", async () => {
    const { cwd, path } = await createTempPlan(samplePlan("Loaded from reads"));
    const tracker = new PlanProgressTracker();

    const loaded = await reloadPlanFromSubagentArgs(tracker, {
      agent: "plan-worker",
      task: "Task 1",
      reads: [path],
    }, cwd);

    expect(loaded).toBe(true);
    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Loaded from reads");
  });

  it("reloads subagent args from a task text plan path", async () => {
    const { cwd, path } = await createTempPlan(samplePlan("Loaded from task text"));
    const tracker = new PlanProgressTracker();

    const loaded = await reloadPlanFromSubagentArgs(tracker, {
      agent: "plan-worker",
      task: `Execute ${path} Task 1`,
    }, cwd);

    expect(loaded).toBe(true);
    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Loaded from task text");
  });

  it("extracts nested parallel and chain plan paths from subagent args", () => {
    expect(extractPlanPathsFromArgs({
      tasks: [{ task: "parallel", reads: [PLAN_PATH] }],
      chain: [{ task: `chain reads ${PLAN_PATH}` }],
    })).toEqual([PLAN_PATH]);
  });
});

describe("plan progress subagent task tracking", () => {
  it("starts and completes one task for single-mode plan-worker args", () => {
    const tracker = loadTrackingPlan();

    const matchedIds = startPlanSubagentTasks(tracker, {
      agent: "plan-worker",
      task: "Execute Task 1 from the plan",
    });

    expect(matchedIds).toEqual([1]);
    expect(tracker.getProgress()).toMatchObject({ running: 1, pending: 2 });

    const completedIds = completePlanSubagentTasks(tracker, {
      agent: "plan-worker",
      task: "final output wording differs from the task name",
    }, true, matchedIds);

    expect(completedIds).toEqual([1]);
    expect(tracker.getProgress()).toMatchObject({ completed: 1, running: 0, pending: 2 });
  });

  it("uses tool_execution_start event args when no prior tool_call input was stored", () => {
    const tracker = loadTrackingPlan();
    const eventArgs = getToolExecutionArgs({
      args: { agent: "plan-worker", task: "Execute Task 2 from the plan" },
    }, undefined);

    const matchedIds = startPlanSubagentTasks(tracker, eventArgs);

    expect(matchedIds).toEqual([2]);
    expect(tracker.getProgress()).toMatchObject({ running: 1, pending: 2 });
  });

  it("falls back to stored tool_call input when execution event args are absent", () => {
    const storedArgs = { agent: "plan-worker", task: "Execute Task 3 from the plan" };

    expect(getToolExecutionArgs({}, storedArgs)).toBe(storedArgs);
  });

  it("starts and completes matched parallel tasks", () => {
    const tracker = loadTrackingPlan();
    const args = {
      tasks: [
        { agent: "plan-worker", task: "Task 1" },
        { agent: "plan-worker", task: "Task 2" },
      ],
    };

    const matchedIds = startPlanSubagentTasks(tracker, args);

    expect(matchedIds).toEqual([1, 2]);
    expect(tracker.getProgress()).toMatchObject({ running: 2, pending: 1 });

    completePlanSubagentTasks(tracker, { tasks: [{ agent: "plan-worker", task: "done" }] }, true, matchedIds);
    expect(tracker.getProgress()).toMatchObject({ completed: 2, running: 0, pending: 1 });
  });

  it("starts and completes matched chain tasks", () => {
    const tracker = loadTrackingPlan();
    const args = {
      chain: [
        { agent: "plan-worker", task: "Task 1" },
        { agent: "plan-worker", task: "Task 3" },
      ],
    };

    const matchedIds = startPlanSubagentTasks(tracker, args);

    expect(matchedIds).toEqual([1, 3]);
    expect(tracker.getProgress()).toMatchObject({ running: 2, pending: 1 });

    completePlanSubagentTasks(tracker, { chain: [{ agent: "plan-worker", task: "done" }] }, true, matchedIds);
    expect(tracker.getProgress()).toMatchObject({ completed: 2, running: 0, pending: 1 });
  });

  it("does not alter progress for non-plan agents unless task text clearly matches", () => {
    const tracker = loadTrackingPlan();

    expect(startPlanSubagentTasks(tracker, {
      agent: "worker",
      task: "Investigate an unrelated issue",
    })).toEqual([]);
    expect(tracker.getProgress()).toMatchObject({ running: 0, pending: 3 });

    expect(startPlanSubagentTasks(tracker, {
      agent: "worker",
      task: "Task 3",
    })).toEqual([3]);
    expect(tracker.getProgress()).toMatchObject({ running: 1, pending: 2 });
  });

  it("marks stored running tasks failed when the subagent tool execution fails", () => {
    const tracker = loadTrackingPlan();
    const matchedIds = startPlanSubagentTasks(tracker, {
      agent: "plan-worker",
      task: "Task 2",
    });

    expect(matchedIds).toEqual([2]);

    completePlanSubagentTasks(tracker, {
      agent: "plan-worker",
      task: "failure output did not mention the task",
    }, false, matchedIds);

    expect(tracker.getProgress()).toMatchObject({ failed: 1, running: 0, pending: 2 });
  });
});
