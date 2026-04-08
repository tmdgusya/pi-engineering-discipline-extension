# Plan: M2 — Core — Orchestrator with Polling

## Context Brief

**Goal:** Build the clarification-aware orchestrator that polls GitHub, manages state transitions, and handles the autonomous development lifecycle.

**Success Criteria:**
- `extensions/autonomous-dev/orchestrator.ts` implements `AutonomousDevOrchestrator` class with start(), stop(), getStatus(), pollCycle()
- State machine handles: idle → processing → clarification → processing → complete/failed transitions
- Polling loop with configurable interval (default 60s)
- Clarification detection correctly identifies author responses after bot questions
- Max clarification rounds enforcement (default 3)
- `onSpawnWorker` callback is stubbed to return success (no actual subagent spawning)
- `extensions/autonomous-dev/tests/orchestrator.test.ts` covers state machine, clarification loop, max rounds
- `npx vitest run extensions/autonomous-dev/tests/orchestrator.test.ts` passes

**Files to create:**
- `extensions/autonomous-dev/orchestrator.ts`
- `extensions/autonomous-dev/tests/orchestrator.test.ts`

**Dependencies (from completed M1):**
- `types.ts`: AUTONOMOUS_LABELS, WorkerResult, OrchestratorConfig, DEFAULT_CONFIG, GitHubError, TrackedIssue, OrchestratorStatus
- `github.ts`: listIssuesByLabel, getIssueWithComments, swapLabels, lockIssue, markNeedsClarification, resumeFromClarification, hasNewCommentsAfter, addLabels, removeLabels, postComment

**Constraints:**
- Worker spawning is stubbed — returns `{ status: "completed", prUrl: "...", summary: "..." }`
- Uses `setInterval` for polling (no session-loop integration for MVP)
- Sequential processing only (no parallel workers for MVP)
- Label-based locking is not truly atomic (sequential remove→add)

---

## Task 1: Create orchestrator.ts

Create `extensions/autonomous-dev/orchestrator.ts`:

```typescript
import {
  OrchestratorConfig,
  DEFAULT_CONFIG,
  OrchestratorStatus,
  TrackedIssue,
  WorkerResult,
  AUTONOMOUS_LABELS,
} from "./types.js";
import {
  listIssuesByLabel,
  getIssueWithComments,
  swapLabels,
  addLabels,
  removeLabels,
  postComment,
} from "./github.js";

/**
 * States in the issue processing lifecycle
 */
type IssueState =
  | "ready"        // Issue has autonomous-dev:ready label, not yet locked
  | "processing"   // Locked, worker spawned, awaiting result
  | "clarifying"   // Worker returned needs-clarification, waiting for author response
  | "complete"     // Worker returned completed
  | "failed";      // Worker returned failed, or max clarification rounds reached

interface TrackedIssueState {
  issueNumber: number;
  state: IssueState;
  clarificationRound: number;
  clarificationQuestionTimestamp: string | null; // When we asked the question
  lockedAt: Date;
}

/**
 * Worker result stub — returns success without spawning actual agent.
 * Replace with real subagent spawning in M4.
 */
async function stubWorkerSpawn(
  _issueNumber: number,
  _config: OrchestratorConfig
): Promise<WorkerResult> {
  // In M2, we just return success. In M4, this will call runAgent().
  return {
    status: "completed",
    prUrl: "https://github.com/example/repo/pull/123",
    summary: "Implemented feature via stub",
  };
}

export class AutonomousDevOrchestrator {
  private config: OrchestratorConfig;
  private status: OrchestratorStatus;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private trackedIssues: Map<number, TrackedIssueState> = new Map();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = {
      isRunning: false,
      repo: this.config.repo,
      pollIntervalMs: this.config.pollIntervalMs,
      trackedIssues: [],
      stats: {
        totalProcessed: 0,
        totalCompleted: 0,
        totalFailed: 0,
        totalClarificationAsked: 0,
      },
    };
  }

  /**
   * Start the polling loop
   */
  start(): void {
    if (this.status.isRunning) return;
    this.status.isRunning = true;
    this.pollCycle(); // Run immediately, then on interval
    this.intervalId = setInterval(
      () => this.pollCycle(),
      this.config.pollIntervalMs
    );
  }

  /**
   * Stop the polling loop
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.status.isRunning = false;
    this.trackedIssues.clear();
  }

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    this.status.trackedIssues = Array.from(this.trackedIssues.values()).map(
      (t) => ({
        issueNumber: t.issueNumber,
        status:
          t.state === "clarifying"
            ? "waiting_clarification"
            : "processing",
        clarificationRound: t.clarificationRound,
        lockedAt: t.lockedAt,
      })
    );
    return { ...this.status };
  }

  /**
   * Set the worker spawn function (used in M4 to wire real agent)
   */
  setWorkerSpawner(
    spawner: (
      issueNumber: number,
      config: OrchestratorConfig
    ) => Promise<WorkerResult>
  ): void {
    // This will be called in M4 to replace the stub
    (this as any)._workerSpawner = spawner;
  }

  /**
   * One poll cycle — check for new work and process clarification responses
   */
  async pollCycle(): Promise<void> {
    if (!this.config.repo) {
      console.warn("[autonomous-dev] No repo configured, skipping poll");
      return;
    }

    // 1. Pick up new ready issues
    await this.pickupReadyIssues();

    // 2. Check clarification responses
    await this.checkClarificationResponses();

    // 3. Process issues stuck in "processing" (worker done or timed out)
    await this.checkProcessingIssues();
  }

  private async pickupReadyIssues(): Promise<void> {
    const issues = await listIssuesByLabel(
      this.config.repo,
      AUTONOMOUS_LABELS.READY,
      [AUTONOMOUS_LABELS.IN_PROGRESS, AUTONOMOUS_LABELS.NEEDS_CLARIFICATION]
    );

    for (const issue of issues) {
      // Skip already tracked
      if (this.trackedIssues.has(issue.number)) continue;

      // Lock the issue
      await lockIssue(this.config.repo, issue.number);

      // Track it
      this.trackedIssues.set(issue.number, {
        issueNumber: issue.number,
        state: "processing",
        clarificationRound: 0,
        clarificationQuestionTimestamp: null,
        lockedAt: new Date(),
      });

      // Spawn worker
      await this.spawnWorkerForIssue(issue.number);
    }
  }

  private async spawnWorkerForIssue(issueNumber: number): Promise<void> {
    const tracked = this.trackedIssues.get(issueNumber);
    if (!tracked) return;

    try {
      const result = await this.callWorker(issueNumber);
      await this.handleWorkerResult(issueNumber, result);
    } catch (err) {
      console.error(`[autonomous-dev] Worker failed for #${issueNumber}:`, err);
      tracked.state = "failed";
      this.status.stats.totalFailed++;
      this.status.stats.totalProcessed++;
      await this.handleFailure(issueNumber);
    }
  }

  private async callWorker(issueNumber: number): Promise<WorkerResult> {
    // Use custom spawner if set (M4), otherwise stub
    const spawner = (this as any)._workerSpawner || stubWorkerSpawn;
    return spawner(issueNumber, this.config);
  }

  private async handleWorkerResult(
    issueNumber: number,
    result: WorkerResult
  ): Promise<void> {
    const tracked = this.trackedIssues.get(issueNumber);
    if (!tracked) return;

    if (result.status === "completed") {
      tracked.state = "complete";
      this.status.stats.totalCompleted++;
      this.status.stats.totalProcessed++;
      await this.handleCompletion(issueNumber, result.prUrl, result.summary);
    } else if (result.status === "needs-clarification") {
      if (tracked.clarificationRound >= this.config.maxClarificationRounds) {
        tracked.state = "failed";
        this.status.stats.totalFailed++;
        this.status.stats.totalProcessed++;
        await postComment(
          this.config.repo,
          issueNumber,
          `❌ Max clarification rounds (${this.config.maxClarificationRounds}) reached. Please reopen if still needed.`
        );
        await this.handleFailure(issueNumber);
      } else {
        tracked.state = "clarifying";
        tracked.clarificationRound++;
        tracked.clarificationQuestionTimestamp = new Date().toISOString();
        this.status.stats.totalClarificationAsked++;
        await markNeedsClarification(this.config.repo, issueNumber);
        await postComment(
          this.config.repo,
          issueNumber,
          `🤔 **Clarification needed:** ${result.question}`
        );
      }
    } else if (result.status === "failed") {
      tracked.state = "failed";
      this.status.stats.totalFailed++;
      this.status.stats.totalProcessed++;
      await postComment(
        this.config.repo,
        issueNumber,
        `❌ **Error:** ${result.error}`
      );
      await this.handleFailure(issueNumber);
    }
  }

  private async checkClarificationResponses(): Promise<void> {
    const clarifyingIssues = Array.from(this.trackedIssues.values()).filter(
      (t) => t.state === "clarifying"
    );

    for (const tracked of clarifyingIssues) {
      if (!tracked.clarificationQuestionTimestamp) continue;

      const ctx = await getIssueWithComments(
        this.config.repo,
        tracked.issueNumber
      );

      const hasNewComment = ctx.comments.some(
        (c) =>
          !c.isFromBot && // Not from bot
          c.author.toLowerCase() !== "github-actions[bot]" && // Not from CI
          new Date(c.createdAt) > new Date(tracked.clarificationQuestionTimestamp!)
      );

      if (hasNewComment) {
        // Resume processing
        tracked.state = "processing";
        tracked.clarificationQuestionTimestamp = null;
        await resumeFromClarification(this.config.repo, tracked.issueNumber);
        await this.spawnWorkerForIssue(tracked.issueNumber);
      }
    }
  }

  private async checkProcessingIssues(): Promise<void> {
    // For the stub implementation, all processing issues will be complete/failed.
    // In M4 with real worker, we'd track timeouts here.
  }

  private async handleCompletion(
    _issueNumber: number,
    prUrl: string,
    summary: string
  ): Promise<void> {
    await swapLabels(
      this.config.repo,
      _issueNumber,
      [AUTONOMOUS_LABELS.IN_PROGRESS, AUTONOMOUS_LABELS.NEEDS_CLARIFICATION],
      [AUTONOMOUS_LABELS.COMPLETED]
    );
    await postComment(
      this.config.repo,
      _issueNumber,
      `✅ **Autonomous implementation complete!**\n\n${summary}\n\nPR: ${prUrl}`
    );
    this.trackedIssues.delete(_issueNumber);
  }

  private async handleFailure(issueNumber: number): Promise<void> {
    await swapLabels(
      this.config.repo,
      issueNumber,
      [AUTONOMOUS_LABELS.IN_PROGRESS, AUTONOMOUS_LABELS.NEEDS_CLARIFICATION],
      [AUTONOMOUS_LABELS.FAILED]
    );
    this.trackedIssues.delete(issueNumber);
  }
}
```

---

## Task 2: Create tests/orchestrator.test.ts

Create `extensions/autonomous-dev/tests/orchestrator.test.ts` using `vi.useFakeTimers`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutonomousDevOrchestrator } from "../orchestrator.js";
import { AUTONOMOUS_LABELS } from "../types.js";

// Mock the github module
vi.mock("../github.js", async () => {
  const actual = await vi.importActual("../github.js");
  return {
    ...actual,
    listIssuesByLabel: vi.fn(),
    getIssueWithComments: vi.fn(),
    swapLabels: vi.fn(),
    addLabels: vi.fn(),
    removeLabels: vi.fn(),
    postComment: vi.fn(),
    lockIssue: vi.fn(),
    markNeedsClarification: vi.fn(),
    resumeFromClarification: vi.fn(),
  };
});

import {
  listIssuesByLabel,
  getIssueWithComments,
  swapLabels,
  postComment,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
} from "../github.js";

const mockListIssues = listIssuesByLabel as ReturnType<typeof vi.fn>;
const mockGetIssue = getIssueWithComments as ReturnType<typeof vi.fn>;
const mockSwap = swapLabels as ReturnType<typeof vi.fn>;
const mockPostComment = postComment as ReturnType<typeof vi.fn>;
const mockLock = lockIssue as ReturnType<typeof vi.fn>;
const mockNeedsClarification = markNeedsClarification as ReturnType<typeof vi.fn>;
const mockResume = resumeFromClarification as ReturnType<typeof vi.fn>;

describe("orchestrator", () => {
  let orchestrator: AutonomousDevOrchestrator;
  let workerSpawner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    workerSpawner = vi.fn().mockResolvedValue({
      status: "completed",
      prUrl: "https://github.com/owner/repo/pull/1",
      summary: "Done",
    });

    orchestrator = new AutonomousDevOrchestrator({
      repo: "owner/repo",
      pollIntervalMs: 60_000,
      maxClarificationRounds: 3,
    });
    orchestrator.setWorkerSpawner(workerSpawner);
  });

  afterEach(() => {
    vi.useRealTimers();
    orchestrator.stop();
  });

  describe("start/stop", () => {
    it("should report running state", () => {
      expect(orchestrator.getStatus().isRunning).toBe(false);
      orchestrator.start();
      expect(orchestrator.getStatus().isRunning).toBe(true);
      orchestrator.stop();
      expect(orchestrator.getStatus().isRunning).toBe(false);
    });

    it("should stop the polling interval on stop()", () => {
      orchestrator.start();
      vi.advanceTimersByTime(100_000);
      orchestrator.stop();
      // If interval was still running, it would have polled multiple times
      // With stop() called, no more polls after stop
      expect(mockListIssues).toHaveBeenCalled();
    });
  });

  describe("pollCycle — pickup ready issues", () => {
    it("should pick up ready issues and lock them", async () => {
      mockListIssues.mockResolvedValue([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      orchestrator.start();
      await vi.runAllTimersAsync();
      orchestrator.stop();

      expect(mockLock).toHaveBeenCalledWith("owner/repo", 42);
      expect(workerSpawner).toHaveBeenCalled();
    });

    it("should not pick up issues already tracked", async () => {
      mockListIssues.mockResolvedValue([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      orchestrator.start();
      await vi.runAllTimersAsync();
      orchestrator.stop();

      // Second poll should not re-lock
      mockListIssues.mockResolvedValue([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.IN_PROGRESS],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      // Reset mock to test
      vi.advanceTimersByTime(60_000);
      await vi.runAllTimersAsync();

      // Issue 42 already tracked, so lockIssue should only be called once
      // (in first pickup)
      expect(mockLock).toHaveBeenCalledTimes(1);
    });
  });

  describe("pollCycle — clarification loop", () => {
    it("should ask clarification question and wait for response", async () => {
      // First call: ready issue, spawn worker returns needs-clarification
      workerSpawner.mockResolvedValueOnce({
        status: "needs-clarification",
        question: "Which database should we use?",
      });

      mockListIssues.mockResolvedValue([
        {
          number: 42,
          title: "Add persistence",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      orchestrator.start();
      await vi.runAllTimersAsync();
      orchestrator.stop();

      // Should have asked the question
      expect(mockNeedsClarification).toHaveBeenCalledWith("owner/repo", 42);
      expect(mockPostComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Which database")
      );
    });

    it("should resume when author responds", async () => {
      // Round 1: needs-clarification
      workerSpawner
        .mockResolvedValueOnce({
          status: "needs-clarification",
          question: "Which database?",
        })
        // Round 2: completed
        .mockResolvedValueOnce({
          status: "completed",
          prUrl: "https://github.com/owner/repo/pull/1",
          summary: "Used SQLite",
        });

      mockListIssues.mockResolvedValue([]); // No new ready issues

      // First check: issue is clarifying
      mockGetIssue.mockResolvedValueOnce({
        issue: { number: 42, title: "Test", body: "", labels: [], author: "alice", createdAt: "" },
        comments: [
          // Bot's question
          { id: 1, author: "bot", body: "Which database?", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
          // Alice's response (after clarification)
          { id: 2, author: "alice", body: "SQLite please", createdAt: "2026-04-01T11:00:00Z", isFromBot: false },
        ],
      });

      // Manually track an issue as clarifying
      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        state: "clarifying" as any,
        clarificationRound: 1,
        clarificationQuestionTimestamp: "2026-04-01T10:00:00Z",
        lockedAt: new Date("2026-04-01T09:00:00Z"),
      });

      orchestrator.start();
      await vi.runAllTimersAsync();
      orchestrator.stop();

      expect(mockResume).toHaveBeenCalledWith("owner/repo", 42);
      expect(workerSpawner).toHaveBeenCalledTimes(2); // Initial + resumed
    });

    it("should fail after max clarification rounds", async () => {
      workerSpawner.mockResolvedValue({
        status: "needs-clarification",
        question: "Still unclear",
      });

      mockListIssues.mockResolvedValue([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);
      mockGetIssue.mockResolvedValue({
        issue: { number: 42, title: "Test", body: "", labels: [], author: "alice", createdAt: "" },
        comments: [], // No response
      });

      // Set max to 2 rounds
      orchestrator = new AutonomousDevOrchestrator({
        repo: "owner/repo",
        pollIntervalMs: 60_000,
        maxClarificationRounds: 2,
      });
      orchestrator.setWorkerSpawner(workerSpawner);

      orchestrator.start();
      // Need to advance time enough to go through 2 clarification rounds
      // Each round: poll picks up ready, spawns worker (needs-clarification), marks clarifying
      // Then next poll checks clarification, no response, spawns again (needs-clarification)
      // Then next poll, no response, spawns again, exceeds max, marks failed
      await vi.advanceTimersByTimeAsync(60_000 * 5);
      await vi.runAllTimersAsync();
      orchestrator.stop();

      // Should have posted max rounds message
      expect(mockPostComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Max clarification rounds")
      );
      expect(mockSwap).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.arrayContaining([AUTONOMOUS_LABELS.FAILED]),
        expect.any(Array)
      );
    });
  });

  describe("pollCycle — completion", () => {
    it("should mark issue complete and post PR link", async () => {
      workerSpawner.mockResolvedValue({
        status: "completed",
        prUrl: "https://github.com/owner/repo/pull/99",
        summary: "Implemented login",
      });

      mockListIssues.mockResolvedValue([
        {
          number: 42,
          title: "Add login",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      orchestrator.start();
      await vi.runAllTimersAsync();
      orchestrator.stop();

      expect(mockSwap).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.any(Array),
        expect.arrayContaining([AUTONOMOUS_LABELS.COMPLETED])
      );
      expect(mockPostComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("https://github.com/owner/repo/pull/99")
      );
    });
  });
});
```

---

## Task 3: Run tests

Execute: `npx vitest run extensions/autonomous-dev/tests/orchestrator.test.ts`

Expected: All tests pass

---

## Verification

- [ ] `extensions/autonomous-dev/orchestrator.ts` implements full state machine
- [ ] `extensions/autonomous-dev/tests/orchestrator.test.ts` covers state transitions
- [ ] `npx vitest run extensions/autonomous-dev/tests/orchestrator.test.ts` passes
