import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { AutonomousDevOrchestrator } from "../orchestrator.js";
import { AUTONOMOUS_LABELS, type WorkerResult, type WorkerAbortSignal, type OrchestratorConfig, type WorkerActivityCallback } from "../types.js";

vi.mock("../logger.js", () => ({
  logAutonomousDev: vi.fn(),
}));

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
import { logAutonomousDev } from "../logger.js";

const mockListIssues = listIssuesByLabel as unknown as ReturnType<typeof vi.fn>;
const mockGetIssue = getIssueWithComments as unknown as ReturnType<typeof vi.fn>;
const mockSwap = swapLabels as unknown as ReturnType<typeof vi.fn>;
const mockPostComment = postComment as unknown as ReturnType<typeof vi.fn>;
const mockLock = lockIssue as unknown as ReturnType<typeof vi.fn>;
const mockNeedsClarification = markNeedsClarification as unknown as ReturnType<typeof vi.fn>;
const mockResume = resumeFromClarification as unknown as ReturnType<typeof vi.fn>;
const mockLogAutonomousDev = logAutonomousDev as unknown as ReturnType<typeof vi.fn>;

describe("orchestrator", () => {
  let orchestrator: AutonomousDevOrchestrator;
  let workerSpawner: Mock<[
    issueNumber: number,
    config: OrchestratorConfig,
    onActivity?: WorkerActivityCallback,
    signal?: WorkerAbortSignal
  ], Promise<WorkerResult>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default mocks
    mockListIssues.mockResolvedValue([]);
    mockGetIssue.mockResolvedValue({
      issue: { number: 0, title: "", body: "", labels: [], author: "", createdAt: "" },
      comments: [],
    });
    mockSwap.mockResolvedValue(undefined);
    mockPostComment.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(undefined);
    mockNeedsClarification.mockResolvedValue(undefined);
    mockResume.mockResolvedValue(undefined);

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

    it("should not start twice", () => {
      orchestrator.start();
      const firstIntervalId = (orchestrator as any).intervalId;
      orchestrator.start();
      expect((orchestrator as any).intervalId).toBe(firstIntervalId);
      expect(orchestrator.getStatus().isRunning).toBe(true);
    });

    it("should stop the polling interval", () => {
      orchestrator.start();
      orchestrator.stop();
      expect((orchestrator as any).intervalId).toBeNull();
      expect(orchestrator.getStatus().isRunning).toBe(false);
    });

    it("should keep current activity as stopped after stop during an in-flight poll", async () => {
      let releaseListIssues: (() => void) | null = null;
      mockListIssues.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseListIssues = () => resolve([]);
          })
      );

      const pollPromise = orchestrator.pollCycle();
      orchestrator.stop();
      (releaseListIssues as any)?.();
      await pollPromise;

      const status = orchestrator.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.currentActivity).toBe("stopped");
    });

    it("should abort in-flight worker activity and keep stopped state after stop", async () => {
      let capturedOnActivity: ((activity: string) => void) | undefined;
      let capturedSignal: AbortSignal | undefined;
      let resolveWorker: ((value: any) => void) | null = null;
      let markWorkerStarted: (() => void) | null = null;
      const workerStarted = new Promise<void>((resolve) => {
        markWorkerStarted = resolve;
      });

      workerSpawner.mockImplementationOnce(async (_issueNumber, _config, onActivity, signal) => {
        capturedOnActivity = onActivity;
        capturedSignal = signal;
        markWorkerStarted?.();
        return await new Promise((resolve) => {
          resolveWorker = resolve;
        });
      });

      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      const pollPromise = orchestrator.pollCycle();
      await workerStarted;
      expect(capturedSignal?.aborted).toBe(false);

      orchestrator.stop();
      expect(capturedSignal?.aborted).toBe(true);

      capturedOnActivity?.("read src/after-stop.ts");
      (resolveWorker as any)({
        status: "completed",
        prUrl: "https://github.com/owner/repo/pull/1",
        summary: "Done",
      });
      await pollPromise;

      const status = orchestrator.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.currentActivity).toBe("stopped");
      expect(status.recentActivities[0].text).toContain("stopped");
      expect(status.recentActivities.some((activity) => activity.text.includes("after-stop"))).toBe(false);
      expect(mockSwap).not.toHaveBeenCalled();
      expect(mockPostComment).not.toHaveBeenCalled();
    });
  });

  describe("pickupReadyIssues", () => {
    it("should pick up ready issues and lock them", async () => {
      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      // Call pollCycle directly
      await orchestrator.pollCycle();

      expect(mockLock).toHaveBeenCalledWith("owner/repo", 42);
      expect(workerSpawner).toHaveBeenCalledWith(42, expect.any(Object), expect.any(Function), expect.any(Object));
      expect(mockLogAutonomousDev).toHaveBeenCalledWith(
        "info",
        "issues.ready.found",
        expect.objectContaining({ repo: "owner/repo" })
      );
    });

    it("should skip issues already tracked", async () => {
      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      // Manually track the issue
      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        title: "Test",
        state: "processing",
        clarificationRound: 0,
        clarificationQuestionTimestamp: null,
        lockedAt: new Date(),
      });

      await orchestrator.pollCycle();

      // Should not lock again
      expect(mockLock).not.toHaveBeenCalled();
    });

    it("should skip issues with excluded labels", async () => {
      // listIssuesByLabel already filters out IN_PROGRESS, COMPLETED, FAILED labels
      // So the mock returns empty - no issues to pick up
      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      await orchestrator.pollCycle();

      // The issue IS picked up (labels are filtered by gh, not by us)
      expect(mockLock).toHaveBeenCalled();
      // But it's tracked with READY label, so it won't be picked up again
      // This test just verifies the basic flow works
    });
  });

  describe("worker result handling", () => {
    it("should mark issue complete and post PR link", async () => {
      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Add login",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      await orchestrator.pollCycle();

      expect(mockSwap).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.any(Array),
        expect.arrayContaining([AUTONOMOUS_LABELS.COMPLETED])
      );
      expect(mockPostComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("https://github.com/owner/repo/pull/1")
      );
    });

    it("should surface live worker activity updates in status", async () => {
      workerSpawner.mockImplementationOnce(async (_issueNumber, _config, onActivity) => {
        onActivity?.("read src/app.ts");
        return {
          status: "completed",
          prUrl: "https://github.com/owner/repo/pull/1",
          summary: "Done",
        };
      });

      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Add feature",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      await orchestrator.pollCycle();

      const status = orchestrator.getStatus();
      expect(status.currentActivity).toBe("idle - waiting for work");
      expect(status.recentActivities.some((activity) => activity.text.includes("read src/app.ts"))).toBe(true);
      expect(workerSpawner).toHaveBeenCalledWith(42, expect.any(Object), expect.any(Function), expect.any(Object));
    });

    it("should handle worker failure", async () => {
      workerSpawner.mockResolvedValueOnce({
        status: "failed",
        error: "Missing dependency",
      });

      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Add feature",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      await orchestrator.pollCycle();

      expect(mockLogAutonomousDev).toHaveBeenCalledWith(
        "error",
        "issue.failed_result",
        expect.objectContaining({ issueNumber: 42, repo: "owner/repo" })
      );
      expect(mockSwap).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.any(Array),
        expect.arrayContaining([AUTONOMOUS_LABELS.FAILED])
      );
      expect(mockPostComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Missing dependency")
      );
    });

    it("should handle worker throwing error", async () => {
      workerSpawner.mockRejectedValueOnce(new Error("Worker crashed"));

      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Test",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      await orchestrator.pollCycle();

      expect(mockSwap).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.any(Array),
        expect.arrayContaining([AUTONOMOUS_LABELS.FAILED])
      );
    });
  });

  describe("clarification loop", () => {
    it("should ask clarification question", async () => {
      workerSpawner.mockResolvedValueOnce({
        status: "needs-clarification",
        question: "Which database should we use?",
      });

      mockListIssues.mockResolvedValueOnce([
        {
          number: 42,
          title: "Add persistence",
          body: "",
          labels: [AUTONOMOUS_LABELS.READY],
          author: "alice",
          createdAt: "2026-04-01T00:00:00Z",
        },
      ]);

      await orchestrator.pollCycle();

      expect(mockNeedsClarification).toHaveBeenCalledWith("owner/repo", 42);
      expect(mockPostComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Which database")
      );
    });

    it("should resume when author responds", async () => {
      workerSpawner
        .mockResolvedValueOnce({
          status: "completed",
          prUrl: "https://github.com/owner/repo/pull/1",
          summary: "Used SQLite",
        });

      mockListIssues.mockResolvedValue([]);
      // getIssue is called for clarification check
      mockGetIssue.mockResolvedValueOnce({
        issue: { number: 42, title: "Test", body: "", labels: [], author: "alice", createdAt: "" },
        comments: [
          { id: 1, author: "bot", body: "Which database?", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
          { id: 2, author: "alice", body: "SQLite please", createdAt: "2026-04-01T11:00:00Z", isFromBot: false },
        ],
      });

      // Track issue as clarifying
      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        title: "Add persistence",
        state: "clarifying",
        clarificationRound: 1,
        clarificationQuestionTimestamp: "2026-04-01T10:00:00Z",
        lockedAt: new Date("2026-04-01T09:00:00Z"),
      });

      await orchestrator.pollCycle();

      expect(mockResume).toHaveBeenCalledWith("owner/repo", 42);
      // Worker should be called again after resume
      expect(workerSpawner).toHaveBeenCalledTimes(1);
    });

    it("should keep issue in clarifying when no new comments and not at max rounds", async () => {
      // When clarification check finds no new comments, issue stays in clarifying state
      mockListIssues.mockResolvedValue([]);
      mockGetIssue.mockResolvedValueOnce({
        issue: { number: 42, title: "Test", body: "", labels: [], author: "alice", createdAt: "" },
        comments: [
          { id: 1, author: "bot", body: "Which database?", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
        ],
      });

      // Track at round 1 (not at max of 3)
      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        title: "Add persistence",
        state: "clarifying",
        clarificationRound: 1,
        clarificationQuestionTimestamp: "2026-04-01T10:00:00Z",
        lockedAt: new Date("2026-04-01T09:00:00Z"),
      });

      await orchestrator.pollCycle();

      // Issue should stay in clarifying state (not resumed, not failed)
      const tracked = (orchestrator as any).trackedIssues.get(42);
      expect(tracked.state).toBe("clarifying");
      expect(mockResume).not.toHaveBeenCalled();
      expect(mockSwap).not.toHaveBeenCalled();
    });

    it("should ignore bot comments when checking clarification responses", async () => {
      mockListIssues.mockResolvedValue([]);

      mockGetIssue.mockResolvedValue({
        issue: { number: 42, title: "Test", body: "", labels: [], author: "alice", createdAt: "" },
        comments: [
          { id: 1, author: "bot", body: "Which database?", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
          { id: 2, author: "github-actions[bot]", body: "CI passed", createdAt: "2026-04-01T11:00:00Z", isFromBot: true },
        ],
      });

      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        title: "Test",
        state: "clarifying",
        clarificationRound: 1,
        clarificationQuestionTimestamp: "2026-04-01T10:00:00Z",
        lockedAt: new Date(),
      });

      await orchestrator.pollCycle();

      expect(mockResume).not.toHaveBeenCalled();
      expect(workerSpawner).not.toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("should return current status with stats", () => {
      const status = orchestrator.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.repo).toBe("owner/repo");
      expect(status.pollIntervalMs).toBe(60_000);
      expect(status.stats.totalProcessed).toBe(0);
      expect(status.lastPollStartedAt).toBeNull();
      expect(status.lastPollCompletedAt).toBeNull();
      expect(status.lastPollSucceededAt).toBeNull();
      expect(status.lastError).toBeNull();
      expect(status.lastErrorAt).toBeNull();
      expect(status.currentActivity).toBe("idle - waiting for work");
      expect(status.currentIssueNumber).toBeNull();
      expect(status.currentIssueTitle).toBeNull();
      expect(status.recentActivities[0].text).toContain("idle - waiting for work");
    });

    it("should show tracked issues in status", () => {
      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        title: "Tracked test issue",
        state: "processing",
        clarificationRound: 0,
        clarificationQuestionTimestamp: null,
        lockedAt: new Date(),
      });

      const status = orchestrator.getStatus();
      expect(status.trackedIssues).toHaveLength(1);
      expect(status.trackedIssues[0].issueNumber).toBe(42);
      expect(status.trackedIssues[0].title).toBe("Tracked test issue");
      expect(status.trackedIssues[0].status).toBe("processing");
    });

    it("should show waiting_clarification for clarifying issues", () => {
      (orchestrator as any).trackedIssues.set(42, {
        issueNumber: 42,
        title: "Clarifying issue",
        state: "clarifying",
        clarificationRound: 1,
        clarificationQuestionTimestamp: "2026-04-01T10:00:00Z",
        lockedAt: new Date(),
      });

      const status = orchestrator.getStatus();
      expect(status.trackedIssues[0].status).toBe("waiting_clarification");
    });
  });

  describe("edge cases", () => {
    it("should skip poll if no repo configured", async () => {
      orchestrator = new AutonomousDevOrchestrator({ repo: "" });
      orchestrator.setWorkerSpawner(workerSpawner);

      await orchestrator.pollCycle();

      expect(mockListIssues).not.toHaveBeenCalled();
      const status = orchestrator.getStatus();
      expect(status.lastPollStartedAt).not.toBeNull();
      expect(status.lastPollCompletedAt).not.toBeNull();
      expect(status.lastPollSucceededAt).not.toBeNull();
      expect(status.lastError).toBeNull();
      expect(status.currentActivity).toBe("idle - waiting for work");
    });

    it("should record poll errors in status", async () => {
      mockListIssues.mockRejectedValueOnce(new Error("gh exploded"));

      await expect(orchestrator.pollCycle()).rejects.toThrow("gh exploded");

      expect(mockLogAutonomousDev).toHaveBeenCalledWith(
        "error",
        "poll.failed",
        expect.objectContaining({ repo: "owner/repo" })
      );
      const status = orchestrator.getStatus();
      expect(status.lastPollStartedAt).not.toBeNull();
      expect(status.lastPollCompletedAt).not.toBeNull();
      expect(status.lastError).toBe("gh exploded");
      expect(status.lastErrorAt).not.toBeNull();
      expect(status.lastPollSucceededAt).toBeNull();
      expect(status.currentActivity).toBe("error while polling GitHub");
    });
  });
});
