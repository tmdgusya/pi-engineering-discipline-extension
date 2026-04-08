import {
  OrchestratorConfig,
  DEFAULT_CONFIG,
  OrchestratorStatus,
  WorkerResult,
  WorkerActivityCallback,
  AUTONOMOUS_LABELS,
} from "./types.js";
import {
  listIssuesByLabel,
  getIssueWithComments,
  swapLabels,
  postComment,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
} from "./github.js";

/**
 * States in the issue processing lifecycle
 */
type IssueState =
  | "ready" // Issue has autonomous-dev:ready label, not yet locked
  | "processing" // Locked, worker spawned, awaiting result
  | "clarifying" // Worker returned needs-clarification, waiting for author response
  | "complete" // Worker returned completed
  | "failed"; // Worker returned failed, or max clarification rounds reached

interface TrackedIssueState {
  issueNumber: number;
  title: string;
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
  _config: OrchestratorConfig,
  _onActivity?: WorkerActivityCallback
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
  private workerSpawner: (
    issueNumber: number,
    config: OrchestratorConfig,
    onActivity?: WorkerActivityCallback
  ) => Promise<WorkerResult> = stubWorkerSpawn;

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
      lastPollStartedAt: null,
      lastPollCompletedAt: null,
      lastPollSucceededAt: null,
      lastError: null,
      lastErrorAt: null,
      currentActivity: "idle - waiting for work",
      currentIssueNumber: null,
      currentIssueTitle: null,
      recentActivities: [],
    };
    this.updateActivity("idle - waiting for work");
  }

  private updateActivity(activity: string, issueNumber: number | null = null, issueTitle: string | null = null): void {
    this.status.currentActivity = activity;
    this.status.currentIssueNumber = issueNumber;
    this.status.currentIssueTitle = issueTitle;

    const issueLabel = issueNumber !== null
      ? issueTitle
        ? ` (#${issueNumber}: ${issueTitle})`
        : ` (#${issueNumber})`
      : "";
    const entry = `${activity}${issueLabel}`;
    const timestamp = new Date().toISOString();
    const recent = this.status.recentActivities.filter((item) => item.text !== entry);
    recent.unshift({ text: entry, timestamp });
    this.status.recentActivities = recent.slice(0, 3);
  }

  /**
   * Start the polling loop
   */
  start(): void {
    if (this.status.isRunning) return;
    this.status.isRunning = true;
    this.updateActivity("starting engine");
    void this.runPollCycle(); // Run immediately, then on interval
    this.intervalId = setInterval(
      () => {
        void this.runPollCycle();
      },
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
    this.updateActivity("stopped");
    this.trackedIssues.clear();
  }

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    this.status.trackedIssues = Array.from(this.trackedIssues.values()).map(
      (t) => ({
        issueNumber: t.issueNumber,
        title: t.title,
        status:
          t.state === "clarifying"
            ? ("waiting_clarification" as const)
            : ("processing" as const),
        clarificationRound: t.clarificationRound,
        lockedAt: t.lockedAt,
      })
    );
    return {
      ...this.status,
      recentActivities: this.status.recentActivities.map((item) => ({ ...item })),
    };
  }

  /**
   * Set the worker spawn function (used in M4 to wire real agent)
   */
  setWorkerSpawner(
    spawner: (
      issueNumber: number,
      config: OrchestratorConfig,
      onActivity?: WorkerActivityCallback
    ) => Promise<WorkerResult>
  ): void {
    this.workerSpawner = spawner;
  }

  /**
   * One poll cycle — check for new work and process clarification responses
   */
  async pollCycle(): Promise<void> {
    await this.runPollCycle();
  }

  private async runPollCycle(): Promise<void> {
    this.status.lastPollStartedAt = new Date().toISOString();
    this.updateActivity("polling GitHub issues");

    try {
      if (!this.config.repo) {
        console.warn("[autonomous-dev] No repo configured, skipping poll");
        this.status.lastPollCompletedAt = new Date().toISOString();
        this.status.lastPollSucceededAt = this.status.lastPollCompletedAt;
        this.status.lastError = null;
        this.status.lastErrorAt = null;
        this.updateActivity("idle - waiting for work");
        return;
      }

      // 1. Pick up new ready issues
      await this.pickupReadyIssues();

      // 2. Check clarification responses
      await this.checkClarificationResponses();

      this.status.lastPollCompletedAt = new Date().toISOString();
      this.status.lastPollSucceededAt = this.status.lastPollCompletedAt;
      this.status.lastError = null;
      this.status.lastErrorAt = null;
      this.updateActivity(this.trackedIssues.size > 0 ? "tracking active issues" : "idle - waiting for work");
    } catch (error) {
      this.status.lastPollCompletedAt = new Date().toISOString();
      this.status.lastError = error instanceof Error ? error.message : String(error);
      this.status.lastErrorAt = this.status.lastPollCompletedAt;
      this.updateActivity("error while polling GitHub");
      throw error;
    }
  }

  private async pickupReadyIssues(): Promise<void> {
    const issues = await listIssuesByLabel(
      this.config.repo,
      AUTONOMOUS_LABELS.READY,
      [
        AUTONOMOUS_LABELS.IN_PROGRESS,
        AUTONOMOUS_LABELS.NEEDS_CLARIFICATION,
        AUTONOMOUS_LABELS.COMPLETED,
        AUTONOMOUS_LABELS.FAILED,
      ]
    );

    for (const issue of issues) {
      // Skip already tracked
      if (this.trackedIssues.has(issue.number)) continue;

      this.updateActivity("locking GitHub issue", issue.number, issue.title);

      // Lock the issue
      await lockIssue(this.config.repo, issue.number);

      // Track it
      this.trackedIssues.set(issue.number, {
        issueNumber: issue.number,
        title: issue.title,
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
      const trackedTitle = tracked.title;
      this.updateActivity("processing issue", issueNumber, trackedTitle);
      const result = await this.workerSpawner(issueNumber, this.config, (activity) => {
        this.updateActivity(activity, issueNumber, trackedTitle);
      });
      await this.handleWorkerResult(issueNumber, result);
    } catch (err) {
      console.error(
        `[autonomous-dev] Worker failed for #${issueNumber}:`,
        err
      );
      tracked.state = "failed";
      this.status.stats.totalFailed++;
      this.status.stats.totalProcessed++;
      await this.handleFailure(issueNumber);
    }
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
      if (
        tracked.clarificationRound >= this.config.maxClarificationRounds
      ) {
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
        this.updateActivity("waiting for clarification", issueNumber, tracked.title);
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
          new Date(c.createdAt) >
            new Date(tracked.clarificationQuestionTimestamp!)
      );

      if (hasNewComment) {
        // Resume processing
        this.updateActivity("resuming issue", tracked.issueNumber, tracked.title);
        tracked.state = "processing";
        tracked.clarificationQuestionTimestamp = null;
        await resumeFromClarification(this.config.repo, tracked.issueNumber);
        await this.spawnWorkerForIssue(tracked.issueNumber);
      }
    }
  }

  private async handleCompletion(
    _issueNumber: number,
    prUrl: string,
    summary: string
  ): Promise<void> {
    const tracked = this.trackedIssues.get(_issueNumber);
    this.updateActivity("completing issue", _issueNumber, tracked?.title ?? null);
    await swapLabels(
      this.config.repo,
      _issueNumber,
      [
        AUTONOMOUS_LABELS.IN_PROGRESS,
        AUTONOMOUS_LABELS.NEEDS_CLARIFICATION,
      ],
      [AUTONOMOUS_LABELS.COMPLETED]
    );
    await postComment(
      this.config.repo,
      _issueNumber,
      `✅ **Autonomous implementation complete!**\n\n${summary}\n\nPR: ${prUrl}`
    );
    this.trackedIssues.delete(_issueNumber);
    this.updateActivity(this.trackedIssues.size > 0 ? "tracking active issues" : "idle - waiting for work");
  }

  private async handleFailure(issueNumber: number): Promise<void> {
    const tracked = this.trackedIssues.get(issueNumber);
    this.updateActivity("failing issue", issueNumber, tracked?.title ?? null);
    await swapLabels(
      this.config.repo,
      issueNumber,
      [
        AUTONOMOUS_LABELS.IN_PROGRESS,
        AUTONOMOUS_LABELS.NEEDS_CLARIFICATION,
      ],
      [AUTONOMOUS_LABELS.FAILED]
    );
    this.trackedIssues.delete(issueNumber);
    this.updateActivity(this.trackedIssues.size > 0 ? "tracking active issues" : "idle - waiting for work");
  }
}
