import { afterEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import { RoachFooter } from "../footer.js";
import { PlanProgressTracker } from "../plan-progress.js";

const stubTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

const SAMPLE_PLAN = `# Tracker QA Plan

**Goal:** Keep plan progress visible during execution

**Verification Strategy:**
- **Level:** test-suite
- **Command:** \`npx vitest run tests/plan-progress.test.ts\`
- **What it validates:** Tracker state and rendering behavior

---

### Task 1: Load sample plan

**Dependencies:** None
**Files:**
- Modify: \`extensions/agentic-harness/plan-progress.ts\`

- [ ] **Step 1: Parse the fixture**

Run: \`npx vitest run tests/plan-progress.test.ts\`
Expected: tracker loads three tasks

### Task 2: Create tracker

**Dependencies:** Task 1
**Files:**
- Create: \`extensions/agentic-harness/tests/plan-progress.test.ts\`

- [ ] **Step 1: Add lifecycle assertions**

Run: \`npx vitest run tests/plan-progress.test.ts\`
Expected: tracker lifecycle is covered

### Task 3: Render progress panel

**Dependencies:** Task 2
**Files:**
- Modify: \`extensions/agentic-harness/footer.ts\`

- [ ] **Step 1: Render the panel**

Run: \`npx vitest run tests/plan-progress.test.ts\`
Expected: task icons and summary are visible
`;

const LONG_GOAL =
  "Make the Plan Progress TUI panel persist from plan creation into plan execution, " +
  "show task state transitions reliably (`○` → `◐ ◓ ◑ ◒` → `✓` / `✗`), and add tests " +
  "that verify the tracker lifecycle, rendering, and event wiring.";

type TaskSnapshot = {
  id: number;
  name: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
};

function tasksOf(tracker: PlanProgressTracker): TaskSnapshot[] {
  return (tracker as unknown as { tasks: TaskSnapshot[] }).tasks;
}

function taskOf(tracker: PlanProgressTracker, taskId: number): TaskSnapshot {
  const task = tasksOf(tracker).find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  return task;
}

function loadSamplePlan(): PlanProgressTracker {
  const tracker = new PlanProgressTracker();
  tracker.loadPlan(SAMPLE_PLAN);
  return tracker;
}

function planMarkdown(goal: string, taskName = "Wire something up"): string {
  return [
    "# Test Plan",
    "",
    `**Goal:** ${goal}`,
    "",
    "**Verification Strategy:**",
    "- **Level:** test-suite",
    "- **Command:** `npx vitest --run`",
    "- **What it validates:** All tests pass",
    "",
    "---",
    "",
    `### Task 1: ${taskName} — Shared Types`,
    "",
    "**Dependencies:** None (can run in parallel)",
    "**Files:**",
    "- Create: `src/types.ts`",
    "",
    "- [ ] **Step 1: Write the test**",
    "",
    "Run: `npx vitest --run tests/types.test.ts`",
    "Expected: PASS",
    "",
  ].join("\n");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PlanProgressTracker lifecycle", () => {
  it("loads a plan and reports initial completed/running/failed/pending/total counts", () => {
    const tracker = loadSamplePlan();

    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Keep plan progress visible during execution");
    expect(tracker.getProgress()).toEqual({
      completed: 0,
      running: 0,
      failed: 0,
      pending: 3,
      total: 3,
    });
  });

  it("transitions tasks from pending to running, completed, and failed only after running", () => {
    const tracker = loadSamplePlan();

    tracker.startTask(1);
    expect(taskOf(tracker, 1).status).toBe("running");
    expect(taskOf(tracker, 2).status).toBe("pending");
    expect(taskOf(tracker, 3).status).toBe("pending");

    tracker.completeTask(1, true);
    expect(taskOf(tracker, 1).status).toBe("completed");

    tracker.startTask(2);
    tracker.completeTask(2, false);
    expect(taskOf(tracker, 2).status).toBe("failed");
    expect(tracker.getProgress()).toEqual({
      completed: 1,
      running: 0,
      failed: 1,
      pending: 1,
      total: 3,
    });
  });

  it("guards against restarting running, completed, or failed tasks until loadPlan resets them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const tracker = loadSamplePlan();

    tracker.startTask(1);
    const firstStartedAt = taskOf(tracker, 1).startedAt;

    vi.setSystemTime(2_000);
    tracker.startTask(1);
    expect(taskOf(tracker, 1).status).toBe("running");
    expect(taskOf(tracker, 1).startedAt).toBe(firstStartedAt);

    tracker.completeTask(1, true);
    vi.setSystemTime(3_000);
    tracker.startTask(1);
    expect(taskOf(tracker, 1).status).toBe("completed");
    expect(taskOf(tracker, 1).startedAt).toBe(firstStartedAt);

    tracker.startTask(2);
    tracker.completeTask(2, false);
    const failedStartedAt = taskOf(tracker, 2).startedAt;
    vi.setSystemTime(4_000);
    tracker.startTask(2);
    expect(taskOf(tracker, 2).status).toBe("failed");
    expect(taskOf(tracker, 2).startedAt).toBe(failedStartedAt);

    tracker.loadPlan(SAMPLE_PLAN);
    expect(tasksOf(tracker).map((task) => task.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("notifies subscribers when plan-visible state changes", () => {
    const tracker = new PlanProgressTracker();
    const onChange = vi.fn();

    tracker.setOnChange(onChange);
    tracker.loadPlan(SAMPLE_PLAN);
    tracker.startTask(1);
    tracker.completeTask(1, true);
    tracker.clear();

    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("does not notify subscribers for ignored duplicate transitions", () => {
    const tracker = loadSamplePlan();
    const onChange = vi.fn();

    tracker.setOnChange(onChange);
    tracker.startTask(1);
    tracker.startTask(1);
    tracker.completeTask(2, true);
    tracker.completeTask(1, true);
    tracker.completeTask(1, false);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(taskOf(tracker, 1).status).toBe("completed");
    expect(taskOf(tracker, 2).status).toBe("pending");
  });
});

describe("PlanProgressTracker fuzzy task matching", () => {
  it("matches exact task text", () => {
    const tracker = loadSamplePlan();

    expect(tracker.startTaskByMatch("Create tracker")).toBe(2);
    expect(taskOf(tracker, 2).status).toBe("running");
  });

  it("matches Task N references", () => {
    const tracker = loadSamplePlan();

    expect(tracker.startTaskByMatch("Task 2")).toBe(2);
    expect(taskOf(tracker, 2).status).toBe("running");
  });

  it("matches significant word overlap against a currently running task", () => {
    const tracker = loadSamplePlan();

    tracker.startTask(2);
    expect(tracker.completeTaskByMatch("finished the tracker", true)).toBe(2);
    expect(taskOf(tracker, 2).status).toBe("completed");
  });

  it("does not match stop words alone", () => {
    const tracker = loadSamplePlan();

    expect(tracker.startTaskByMatch("the and for")).toBeNull();
    expect(tasksOf(tracker).map((task) => task.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
  });
});

describe("RoachFooter plan progress hosting", () => {
  it("renders active plan lines above the normal footer", () => {
    const tracker = loadSamplePlan();
    const width = 60;
    const border = "─".repeat(width);
    const planLines = tracker.render(stubTheme, width - 4);
    const footer = new RoachFooter(
      stubTheme,
      { getGitBranch: () => "main" } as any,
      {
        cwd: "/tmp/project",
        getModelName: () => "test-model",
        getContextUsage: () => ({ tokens: 1_000, contextWindow: 100_000, percent: 1 }),
      },
      { totalInput: 10, totalCacheRead: 0 },
      { running: new Map() },
      tracker,
    );

    const lines = footer.render(width);

    expect(lines[0]).toBe(border);
    expect(lines.slice(1, 1 + planLines.length)).toEqual(planLines);
    expect(lines[1 + planLines.length]).toBe(border);
    expect(lines[2 + planLines.length]).toContain("project");
    expect(lines[2 + planLines.length]).toContain("main");
    expect(lines[2 + planLines.length]).toContain("test-model");
    expect(lines[3 + planLines.length]).toContain("ctx");
    expect(lines[3 + planLines.length]).toContain("cache 0%");
  });
});

describe("PlanProgressTracker.render", () => {
  it("renders pending, running, completed, and failed task indicators", () => {
    const tracker = loadSamplePlan();

    expect(tracker.render(stubTheme, 100).join("\n")).toContain("○");

    tracker.startTask(1);
    tracker.completeTask(1, true);
    tracker.startTask(2);
    tracker.startTask(3);
    tracker.completeTask(3, false);

    const text = tracker.render(stubTheme, 100).join("\n");
    expect(text).toContain("✓");
    expect(text).toMatch(/[◐◓◑◒]/);
    expect(text).toContain("✗");
  });

  it("renders progress as completed over total while showing running count separately", () => {
    const tracker = loadSamplePlan();

    tracker.startTask(2);
    const text = tracker.render(stubTheme, 100).join("\n");

    expect(text).toContain("0/3");
    expect(text).toContain("1 running");
  });

  it("never produces a line wider than maxWidth, even with a long goal", () => {
    const tracker = new PlanProgressTracker();
    tracker.loadPlan(planMarkdown(LONG_GOAL));

    const maxWidth = 176;
    const lines = tracker.render(stubTheme, maxWidth);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxWidth);
    }
  });

  it("preserves short goals verbatim", () => {
    const tracker = new PlanProgressTracker();
    tracker.loadPlan(planMarkdown("Build a feature"));

    const lines = tracker.render(stubTheme, 80);
    expect(lines[0]).toContain("Build a feature");
  });
});
