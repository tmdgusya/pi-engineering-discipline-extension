/**
 * GitHub issue with minimal fields needed by the orchestrator
 */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  createdAt: string;
}

export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  isFromBot: boolean;
}

export interface IssueContext {
  issue: GitHubIssue;
  comments: GitHubComment[];
}

/**
 * Label protocol for autonomous dev
 */
export const AUTONOMOUS_LABELS = {
  READY: "autonomous-dev:ready",
  IN_PROGRESS: "autonomous-dev:in-progress",
  NEEDS_CLARIFICATION: "autonomous-dev:needs-clarification",
  REVIEW_REQUESTED: "autonomous-dev:review-requested",
  COMPLETED: "autonomous-dev:completed",
  FAILED: "autonomous-dev:failed",
} as const;

export type AutonomousLabel = (typeof AUTONOMOUS_LABELS)[keyof typeof AUTONOMOUS_LABELS];

export interface ActivityEntry {
  text: string;
  timestamp: string;
}

export type WorkerActivityCallback = (activity: string) => void;

export type WorkerResult =
  | { status: "completed"; prUrl: string; summary: string }
  | { status: "needs-clarification"; question: string }
  | { status: "failed"; error: string };

export interface OrchestratorConfig {
  /** Repository in owner/repo format */
  repo: string;
  /** Polling interval in milliseconds (default: 60000 = 1m) */
  pollIntervalMs: number;
  /** Maximum clarification rounds before giving up (default: 3) */
  maxClarificationRounds: number;
  /** Branch prefix for autonomous dev branches (default: "autonomous/") */
  branchPrefix: string;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  repo: "",
  pollIntervalMs: 60_000,
  maxClarificationRounds: 3,
  branchPrefix: "autonomous/",
};

export interface TrackedIssue {
  issueNumber: number;
  title: string;
  status: "waiting_clarification" | "processing";
  clarificationRound: number;
  lockedAt: Date;
}

/**
 * Status returned by /autonomous-dev status command
 */
export interface OrchestratorStatus {
  isRunning: boolean;
  repo: string;
  pollIntervalMs: number;
  trackedIssues: TrackedIssue[];
  stats: {
    totalProcessed: number;
    totalCompleted: number;
    totalFailed: number;
    totalClarificationAsked: number;
  };
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  lastPollSucceededAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  currentActivity: string;
  currentIssueNumber: number | null;
  currentIssueTitle: string | null;
  recentActivities: ActivityEntry[];
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(message);
    this.name = "GitHubError";
  }
}
