# Autonomous Dev Engine Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Build an autonomous dev engine that polls GitHub issues, assesses ambiguity, runs the existing agentic pipeline, and creates PRs — all within a local pi session.

**Architecture:** New `extensions/autonomous-dev/` extension that wraps the existing agentic-harness pipeline. The orchestrator (TypeScript) handles deterministic scheduling and label-based locking. The `autonomous-dev-worker` agent (LLM) handles issue comprehension, ambiguity assessment, and code implementation. All GitHub operations use `gh` CLI — no external libraries.

**Tech Stack:** TypeScript, `gh` CLI (GitHub API), pi ExtensionAPI, `@sinclair/typebox` (parameter schemas), Vitest (testing)

**Work Scope:**
- **In scope:** Types + GitHub client, orchestrator with polling + label locking, pi tools for GitHub operations, worker agent definition, `/autonomous-dev` commands, tests
- **Out of scope:** Parallel issue processing, multi-repo support, confidence threshold tuning, CI/CD deployment, PR auto-merge

---

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npx vitest run extensions/autonomous-dev/tests/`
- **What it validates:** GitHub client correctly wraps gh CLI, orchestrator manages issue lifecycle with label-based locking, extension registers tools/commands without errors

---

### File Structure

```
extensions/autonomous-dev/
├── index.ts                    # Extension entry: tools + commands
├── github.ts                   # gh CLI wrappers (shared by orchestrator + tools)
├── orchestrator.ts             # Polling scheduler + worker spawning
├── types.ts                    # Shared types
├── agents/
│   └── autonomous-dev-worker.md  # Worker agent definition
├── skills/
│   └── autonomous-dev/
│       └── SKILL.md            # Skill definition
└── tests/
    ├── github.test.ts
    └── orchestrator.test.ts
```

---

### Task 1: Types + GitHub Client

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/autonomous-dev/types.ts`
- Create: `extensions/autonomous-dev/github.ts`
- Create: `extensions/autonomous-dev/tests/github.test.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// extensions/autonomous-dev/types.ts

/** GitHub issue with minimal fields needed by the orchestrator */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  createdAt: string;
}

/** A single comment on a GitHub issue */
export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  isFromBot: boolean;
}

/** Result of an issue read (issue + comments) */
export interface IssueContext {
  issue: GitHubIssue;
  comments: GitHubComment[];
}

/** Label protocol for autonomous dev */
export const AUTONOMOUS_LABELS = {
  READY: "autonomous-dev:ready",
  IN_PROGRESS: "autonomous-dev:in-progress",
  NEEDS_CLARIFICATION: "autonomous-dev:needs-clarification",
  REVIEW_REQUESTED: "autonomous-dev:review-requested",
  COMPLETED: "autonomous-dev:completed",
  FAILED: "autonomous-dev:failed",
} as const;

export type AutonomousLabel = typeof AUTONOMOUS_LABELS[keyof typeof AUTONOMOUS_LABELS];

/** Result returned by the worker agent */
export type WorkerResult =
  | { status: "completed"; prUrl: string; summary: string }
  | { status: "needs-clarification"; question: string }
  | { status: "failed"; error: string };

/** Configuration for the orchestrator */
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

/** Orchestrator state for a single issue being tracked */
export interface TrackedIssue {
  issueNumber: number;
  status: "waiting_clarification" | "processing";
  clarificationRound: number;
  lockedAt: Date;
}

/** Status returned by /autonomous-dev status command */
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
}

/** Error type for GitHub operations */
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
```

- [ ] **Step 2: Create github.ts**

```typescript
// extensions/autonomous-dev/github.ts

import { execSync } from "child_process";
import { GitHubIssue, GitHubComment, IssueContext, AUTONOMOUS_LABELS, GitHubError } from "./types.js";

/**
 * Execute a gh CLI command and return parsed JSON output.
 * Throws GitHubError on failure.
 */
function execGhJson<T>(args: string): T {
  try {
    const result = execSync(`gh ${args} --json`, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result) as T;
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const exitCode = err.status ?? null;
    throw new GitHubError(
      `gh command failed: gh ${args}`,
      `gh ${args}`,
      exitCode,
      stderr
    );
  }
}

/**
 * Execute a gh CLI command and return raw stdout.
 * Throws GitHubError on failure.
 */
function execGhRaw(args: string): string {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const exitCode = err.status ?? null;
    throw new GitHubError(
      `gh command failed: gh ${args}`,
      `gh ${args}`,
      exitCode,
      stderr
    );
  }
}

// --- Issue operations ---

/** List issues with a specific label that do NOT have certain labels */
export async function listIssuesByLabel(
  repo: string,
  label: string,
  excludeLabels: string[] = []
): Promise<GitHubIssue[]> {
  const queryParts = [`repo:${repo}`, `label:${label}`, "state:open", "sort:created-asc"];
  for (const excl of excludeLabels) {
    queryParts.push(`-label:${excl}`);
  }
  const query = queryParts.join(" ");

  type GhIssue = {
    number: number;
    title: string;
    body: string;
    labels: { name: string }[];
    author: { login: string };
    createdAt: string;
  };

  const issues = execGhJson<GhIssue[]>(
    `issue list --search "${query}" --limit 50 --json number,title,body,labels,author,createdAt`
  );

  return issues.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body || "",
    labels: i.labels.map((l) => l.name),
    author: i.author?.login || "unknown",
    createdAt: i.createdAt,
  }));
}

/** Get a single issue with all comments */
export async function getIssueWithComments(
  repo: string,
  issueNumber: number
): Promise<IssueContext> {
  type GhIssue = {
    number: number;
    title: string;
    body: string;
    labels: { name: string }[];
    author: { login: string };
    createdAt: string;
  };

  type GhComment = {
    id: number;
    author: { login: string };
    body: string;
    createdAt: string;
    isBot: boolean;
  };

  const issue = execGhJson<GhIssue>(
    `issue view ${issueNumber} --repo ${repo} --json number,title,body,labels,author,createdAt`
  );

  let comments: GhComment[] = [];
  try {
    comments = execGhJson<GhComment[]>(
      `issue view ${issueNumber} --repo ${repo} --comments --json comments`
    ).comments || [];
  } catch {
    // Issue with no comments may error — that's fine
    comments = [];
  }

  return {
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body || "",
      labels: issue.labels.map((l) => l.name),
      author: issue.author?.login || "unknown",
      createdAt: issue.createdAt,
    },
    comments: comments.map((c) => ({
      id: c.id,
      author: c.author?.login || "unknown",
      body: c.body,
      createdAt: c.createdAt,
      isFromBot: c.isBot,
    })),
  };
}

// --- Comment operations ---

/** Post a comment on an issue. Returns the comment URL. */
export async function postComment(
  repo: string,
  issueNumber: number,
  body: string
): Promise<string> {
  // Write comment body to temp file to avoid shell escaping issues
  const { writeFileSync, unlinkSync, mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");

  const tmpDir = mkdtempSync(join(tmpdir(), "autonomous-dev-"));
  const tmpFile = join(tmpDir, "comment.md");
  writeFileSync(tmpFile, body, "utf-8");

  try {
    const result = execGhRaw(
      `issue comment ${issueNumber} --repo ${repo} --body-file "${tmpFile}"`
    );
    return result;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(tmpFile.replace("comment.md", "")); } catch {}
  }
}

// --- Label operations ---

/** Add labels to an issue */
export async function addLabels(
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const labelArgs = labels.map((l) => `"${l}"`).join(",");
  execGhRaw(
    `issue edit ${issueNumber} --repo ${repo} --add-label ${labelArgs}`
  );
}

/** Remove labels from an issue */
export async function removeLabels(
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  for (const label of labels) {
    try {
      execGhRaw(
        `issue edit ${issueNumber} --repo ${repo} --remove-label "${label}"`
      );
    } catch {
      // Label may not exist — ignore
    }
  }
}

/**
 * Atomically swap labels on an issue.
 * Removes `removeLabels` and adds `addLabels` in sequence.
 * This is NOT truly atomic (GitHub API doesn't support atomic label swap),
 * but sequential remove→add is safe because labels are additive.
 */
export async function swapLabels(
  repo: string,
  issueNumber: number,
  removeLabels: string[],
  addLabels: string[]
): Promise<void> {
  await removeLabels(repo, issueNumber, removeLabels);
  await addLabels(repo, issueNumber, addLabels);
}

/** Convenience: lock an issue for processing (ready → in-progress) */
export async function lockIssue(
  repo: string,
  issueNumber: number
): Promise<void> {
  await swapLabels(
    repo,
    issueNumber,
    [AUTONOMOUS_LABELS.READY],
    [AUTONOMOUS_LABELS.IN_PROGRESS]
  );
}

/** Convenience: mark issue as needing clarification (in-progress → needs-clarification) */
export async function markNeedsClarification(
  repo: string,
  issueNumber: number
): Promise<void> {
  await swapLabels(
    repo,
    issueNumber,
    [AUTONOMOUS_LABELS.IN_PROGRESS],
    [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION]
  );
}

/** Convenience: mark issue as in-progress after clarification resolved (needs-clarification → in-progress) */
export async function resumeFromClarification(
  repo: string,
  issueNumber: number
): Promise<void> {
  await swapLabels(
    repo,
    issueNumber,
    [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION],
    [AUTONOMOUS_LABELS.IN_PROGRESS]
  );
}

// --- PR operations ---

/** Create a pull request. Returns the PR URL. */
export async function createPullRequest(
  repo: string,
  title: string,
  body: string,
  headBranch: string,
  baseBranch: string = "main"
): Promise<string> {
  const { writeFileSync, unlinkSync, mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");

  const tmpDir = mkdtempSync(join(tmpdir(), "autonomous-dev-pr-"));
  const tmpFile = join(tmpDir, "pr-body.md");
  writeFileSync(tmpFile, body, "utf-8");

  try {
    return execGhRaw(
      `pr create --repo ${repo} --title "${title.replace(/"/g, '\\"')}" --body-file "${tmpFile}" --head "${headBranch}" --base "${baseBranch}"`
    );
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

/** Detect the current Git repository in owner/repo format */
export async function detectRepo(cwd?: string): Promise<string | null> {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf-8",
      cwd,
      timeout: 5000,
    }).trim();

    // Handle both HTTPS and SSH URLs
    const match = remoteUrl.match(/(?:github\.com[:/])([^/]+\/[^/\s]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Check if a comment was posted after a given timestamp */
export function hasNewCommentsAfter(
  comments: GitHubComment[],
  afterTimestamp: string,
  excludeBot: boolean = true
): boolean {
  return comments.some(
    (c) =>
      (!excludeBot || !c.isFromBot) &&
      new Date(c.createdAt) > new Date(afterTimestamp)
  );
}
```

- [ ] **Step 3: Create tests/github.test.ts**

```typescript
// extensions/autonomous-dev/tests/github.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listIssuesByLabel,
  getIssueWithComments,
  postComment,
  addLabels,
  removeLabels,
  swapLabels,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
  createPullRequest,
  detectRepo,
  hasNewCommentsAfter,
} from "../github.js";
import { AUTONOMOUS_LABELS } from "../types.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
const mockExec = execSync as unknown as ReturnType<typeof vi.fn>;

describe("github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listIssuesByLabel", () => {
    it("should list issues with the ready label", async () => {
      mockExec.mockReturnValue(
        JSON.stringify([
          {
            number: 42,
            title: "Add login page",
            body: "We need a login page",
            labels: [{ name: "autonomous-dev:ready" }],
            author: { login: "alice" },
            createdAt: "2026-04-01T00:00:00Z",
          },
        ])
      );

      const issues = await listIssuesByLabel("owner/repo", AUTONOMOUS_LABELS.READY);
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(42);
      expect(issues[0].title).toBe("Add login page");
      expect(issues[0].author).toBe("alice");
    });

    it("should exclude issues with specified labels", async () => {
      mockExec.mockReturnValue(JSON.stringify([]));
      await listIssuesByLabel("owner/repo", AUTONOMOUS_LABELS.READY, [
        AUTONOMOUS_LABELS.IN_PROGRESS,
      ]);
      expect(mockExec).toHaveBeenCalledTimes(1);
      const call = mockExec.mock.calls[0][0] as string;
      expect(call).toContain("-label:autonomous-dev:in-progress");
    });
  });

  describe("getIssueWithComments", () => {
    it("should return issue with comments", async () => {
      mockExec
        .mockReturnValueOnce(
          JSON.stringify({
            number: 42,
            title: "Test issue",
            body: "Body text",
            labels: [{ name: "autonomous-dev:ready" }],
            author: { login: "bob" },
            createdAt: "2026-04-01T00:00:00Z",
          })
        )
        .mockReturnValueOnce(
          JSON.stringify({
            comments: [
              {
                id: 1,
                author: { login: "alice" },
                body: "I think we should use OAuth",
                createdAt: "2026-04-02T00:00:00Z",
                isBot: false,
              },
            ],
          })
        );

      const ctx = await getIssueWithComments("owner/repo", 42);
      expect(ctx.issue.number).toBe(42);
      expect(ctx.comments).toHaveLength(1);
      expect(ctx.comments[0].author).toBe("alice");
    });
  });

  describe("swapLabels", () => {
    it("should remove old labels and add new ones", async () => {
      mockExec.mockReturnValue("");
      await swapLabels("owner/repo", 42, ["old-label"], ["new-label"]);

      // First call: remove, Second call: add
      expect(mockExec).toHaveBeenCalledTimes(2);
      expect((mockExec.mock.calls[0][0] as string)).toContain("--remove-label");
      expect((mockExec.mock.calls[1][0] as string)).toContain("--add-label");
    });
  });

  describe("lockIssue", () => {
    it("should swap ready → in-progress", async () => {
      mockExec.mockReturnValue("");
      await lockIssue("owner/repo", 42);

      expect(mockExec).toHaveBeenCalledTimes(2);
      const removeCall = mockExec.mock.calls[0][0] as string;
      const addCall = mockExec.mock.calls[1][0] as string;
      expect(removeCall).toContain(AUTONOMOUS_LABELS.READY);
      expect(addCall).toContain(AUTONOMOUS_LABELS.IN_PROGRESS);
    });
  });

  describe("hasNewCommentsAfter", () => {
    const comments = [
      { id: 1, author: "bot", body: "Question", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
      { id: 2, author: "alice", body: "Answer", createdAt: "2026-04-01T11:00:00Z", isFromBot: false },
      { id: 3, author: "bot", body: "Follow-up", createdAt: "2026-04-01T12:00:00Z", isFromBot: true },
    ];

    it("should detect new non-bot comments after timestamp", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T10:00:00Z")).toBe(true);
    });

    it("should return false when no new non-bot comments", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T12:00:00Z")).toBe(false);
    });

    it("should include bot comments when excludeBot is false", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T11:00:00Z", false)).toBe(true);
    });
  });

  describe("detectRepo", () => {
    it("should parse HTTPS remote URL", async () => {
      mockExec.mockReturnValue("https://github.com/owner/repo.git\n");
      const repo = await detectRepo();
      expect(repo).toBe("owner/repo");
    });

    it("should parse SSH remote URL", async () => {
      mockExec.mockReturnValue("git@github.com:owner/repo.git\n");
      const repo = await detectRepo();
      expect(repo).toBe("owner/repo");
    });

    it("should return null on failure", async () => {
      mockExec.mockImplementation(() => {
        throw new Error("no remote");
      });
      const repo = await detectRepo();
      expect(repo).toBeNull();
    });
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && npx vitest run extensions/autonomous-dev/tests/github.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add extensions/autonomous-dev/types.ts extensions/autonomous-dev/github.ts extensions/autonomous-dev/tests/github.test.ts
git commit -m "feat(autonomous-dev): add types and GitHub client"
```

---

### Task 2: Orchestrator

**Dependencies:** Runs after Task 1 completes
**Files:**
- Create: `extensions/autonomous-dev/orchestrator.ts`
- Create: `extensions/autonomous-dev/tests/orchestrator.test.ts`

- [ ] **Step 1: Create orchestrator.ts**

```typescript
// extensions/autonomous-dev/orchestrator.ts

import {
  OrchestratorConfig,
  DEFAULT_CONFIG,
  OrchestratorStatus,
  TrackedIssue,
  AUTONOMOUS_LABELS,
  WorkerResult,
} from "./types.js";
import {
  listIssuesByLabel,
  getIssueWithComments,
  postComment,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
  addLabels,
  hasNewCommentsAfter,
  detectRepo,
} from "./github.js";

export class AutonomousDevOrchestrator {
  private config: OrchestratorConfig;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private trackedIssues: Map<number, TrackedIssue> = new Map();
  private isRunning = false;
  private isExecuting = false;

  // Stats
  private totalProcessed = 0;
  private totalCompleted = 0;
  private totalFailed = 0;
  private totalClarificationAsked = 0;

  // Callbacks
  private onSpawnWorker: (issueNumber: number, issueContext: string, config: OrchestratorConfig) => Promise<WorkerResult>;
  private onStatusChange?: (status: OrchestratorStatus) => void;

  constructor(
    config: Partial<OrchestratorConfig> & { repo?: string },
    onSpawnWorker: (issueNumber: number, issueContext: string, config: OrchestratorConfig) => Promise<WorkerResult>,
    onStatusChange?: (status: OrchestratorStatus) => void
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onSpawnWorker = onSpawnWorker;
    this.onStatusChange = onStatusChange;
  }

  /** Start the polling loop */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // Auto-detect repo if not set
    if (!this.config.repo) {
      const detected = await detectRepo();
      if (!detected) {
        throw new Error("Cannot detect GitHub repository. Set repo in config or run inside a git repo with a GitHub remote.");
      }
      this.config.repo = detected;
    }

    this.isRunning = true;

    // Run first poll immediately
    await this.pollCycle();

    // Then set up interval
    this.timerId = setInterval(() => {
      this.pollCycle().catch((err) => {
        console.error("[autonomous-dev] Poll cycle error:", err);
      });
    }, this.config.pollIntervalMs);

    this.emitStatus();
  }

  /** Stop the polling loop */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isRunning = false;
    this.emitStatus();
  }

  /** Get current status */
  getStatus(): OrchestratorStatus {
    return {
      isRunning: this.isRunning,
      repo: this.config.repo,
      pollIntervalMs: this.config.pollIntervalMs,
      trackedIssues: Array.from(this.trackedIssues.values()),
      stats: {
        totalProcessed: this.totalProcessed,
        totalCompleted: this.totalCompleted,
        totalFailed: this.totalFailed,
        totalClarificationAsked: this.totalClarificationAsked,
      },
    };
  }

  /** Single poll cycle */
  async pollCycle(): Promise<void> {
    if (this.isExecuting) return;
    this.isExecuting = true;

    try {
      // Phase 1: Check issues awaiting clarification
      await this.checkClarificationIssues();

      // Phase 2: Pick up new ready issues
      await this.processReadyIssues();
    } catch (err) {
      console.error("[autonomous-dev] Poll cycle error:", err);
    } finally {
      this.isExecuting = false;
    }
  }

  /** Check issues in needs-clarification state for new author comments */
  private async checkClarificationIssues(): Promise<void> {
    const issues = await listIssuesByLabel(
      this.config.repo,
      AUTONOMOUS_LABELS.NEEDS_CLARIFICATION
    );

    for (const issue of issues) {
      const tracked = this.trackedIssues.get(issue.number);
      if (!tracked) {
        // Not tracked by us — skip (could be from another session)
        // But since it has the label, we should track it now
        this.trackedIssues.set(issue.number, {
          issueNumber: issue.number,
          status: "waiting_clarification",
          clarificationRound: 0,
          lockedAt: new Date(),
        });
        continue;
      }

      if (tracked.status !== "waiting_clarification") continue;

      // Get full context to check for new comments
      const ctx = await getIssueWithComments(this.config.repo, issue.number);

      // Check if there are bot comments (our questions)
      const botComments = ctx.comments.filter((c) => c.isFromBot);
      if (botComments.length === 0) continue;

      const lastBotComment = botComments[botComments.length - 1];

      // Check for new non-bot comments after our last question
      const hasNew = hasNewCommentsAfter(ctx.comments, lastBotComment.createdAt);
      if (!hasNew) continue;

      // Author responded — resume processing
      console.log(`[autonomous-dev] Issue #${issue.number}: Author responded, resuming...`);

      // Check clarification round limit
      tracked.clarificationRound++;
      if (tracked.clarificationRound > this.config.maxClarificationRounds) {
        await this.markFailed(issue.number, "Maximum clarification rounds exceeded. Human intervention needed.");
        continue;
      }

      await resumeFromClarification(this.config.repo, issue.number);
      tracked.status = "processing";

      const issueContext = this.buildIssueContext(ctx);
      const result = await this.onSpawnWorker(issue.number, issueContext, this.config);
      await this.handleWorkerResult(issue.number, result);
    }
  }

  /** Pick up issues with the ready label */
  private async processReadyIssues(): Promise<void> {
    const issues = await listIssuesByLabel(
      this.config.repo,
      AUTONOMOUS_LABELS.READY,
      [AUTONOMOUS_LABELS.IN_PROGRESS, AUTONOMOUS_LABELS.NEEDS_CLARIFICATION]
    );

    // Process one issue at a time (MVP: sequential)
    if (issues.length === 0) return;

    const issue = issues[0];
    console.log(`[autonomous-dev] Picking up issue #${issue.number}: ${issue.title}`);

    // Lock the issue
    try {
      await lockIssue(this.config.repo, issue.number);
    } catch (err) {
      console.error(`[autonomous-dev] Failed to lock issue #${issue.number}:`, err);
      return; // Another session may have grabbed it
    }

    this.trackedIssues.set(issue.number, {
      issueNumber: issue.number,
      status: "processing",
      clarificationRound: 0,
      lockedAt: new Date(),
    });

    // Get full context
    const ctx = await getIssueWithComments(this.config.repo, issue.number);
    const issueContext = this.buildIssueContext(ctx);

    const result = await this.onSpawnWorker(issue.number, issueContext, this.config);
    await this.handleWorkerResult(issue.number, result);
  }

  /** Handle the result from the worker agent */
  private async handleWorkerResult(issueNumber: number, result: WorkerResult): Promise<void> {
    this.totalProcessed++;

    switch (result.status) {
      case "completed":
        this.totalCompleted++;
        await addLabels(this.config.repo, issueNumber, [AUTONOMOUS_LABELS.COMPLETED]);
        console.log(`[autonomous-dev] Issue #${issueNumber} completed: ${result.prUrl}`);
        break;

      case "needs-clarification":
        this.totalClarificationAsked++;
        const tracked = this.trackedIssues.get(issueNumber);
        await markNeedsClarification(this.config.repo, issueNumber);
        await postComment(
          this.config.repo,
          issueNumber,
          `🤖 **Autonomous Dev needs clarification:**\n\n${result.question}\n\n---\n*This question was automatically generated. Please reply to this comment to resume processing.*`
        );
        if (tracked) tracked.status = "waiting_clarification";
        console.log(`[autonomous-dev] Issue #${issueNumber} needs clarification`);
        break;

      case "failed":
        this.totalFailed++;
        await this.markFailed(issueNumber, result.error);
        break;
    }

    this.emitStatus();
  }

  /** Mark an issue as failed */
  private async markFailed(issueNumber: number, reason: string): Promise<void> {
    try {
      await addLabels(this.config.repo, issueNumber, [AUTONOMOUS_LABELS.FAILED]);
      await postComment(
        this.config.repo,
        issueNumber,
        `🤖 **Autonomous Dev failed:** ${reason}\n\nHuman intervention needed.`
      );
    } catch (err) {
      console.error(`[autonomous-dev] Failed to mark issue #${issueNumber} as failed:`, err);
    }
    this.trackedIssues.delete(issueNumber);
  }

  /** Build the context string for the worker agent */
  private buildIssueContext(ctx: { issue: { number: number; title: string; body: string; author: string; labels: string[] }; comments: { author: string; body: string; createdAt: string; isFromBot: boolean }[] }): string {
    let context = `# GitHub Issue #${ctx.issue.number}\n\n`;
    context += `**Title:** ${ctx.issue.title}\n`;
    context += `**Author:** @${ctx.issue.author}\n`;
    context += `**Labels:** ${ctx.issue.labels.join(", ")}\n\n`;
    context += `## Description\n\n${ctx.issue.body}\n\n`;

    if (ctx.comments.length > 0) {
      context += `## Comments\n\n`;
      for (const comment of ctx.comments) {
        const prefix = comment.isFromBot ? "🤖" : `@${comment.author}`;
        context += `**${prefix}** (${comment.createdAt}):\n${comment.body}\n\n---\n\n`;
      }
    }

    return context;
  }

  private emitStatus(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatus());
    }
  }
}
```

- [ ] **Step 2: Create tests/orchestrator.test.ts**

```typescript
// extensions/autonomous-dev/tests/orchestrator.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutonomousDevOrchestrator } from "../orchestrator.js";
import { WorkerResult, AUTONOMOUS_LABELS } from "../types.js";

// Mock the github module
vi.mock("../github.js", () => ({
  listIssuesByLabel: vi.fn(),
  getIssueWithComments: vi.fn(),
  postComment: vi.fn(),
  lockIssue: vi.fn(),
  markNeedsClarification: vi.fn(),
  resumeFromClarification: vi.fn(),
  addLabels: vi.fn(),
  removeLabels: vi.fn(),
  hasNewCommentsAfter: vi.fn(),
  detectRepo: vi.fn(),
}));

import {
  listIssuesByLabel,
  getIssueWithComments,
  postComment,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
  addLabels,
  hasNewCommentsAfter,
  detectRepo,
} from "../github.js";

describe("AutonomousDevOrchestrator", () => {
  let workerResults: Map<number, WorkerResult> = new Map();
  let statusChanges: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    workerResults.clear();
    statusChanges = [];

    (detectRepo as any).mockResolvedValue("owner/repo");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createOrchestrator(config: Record<string, any> = {}) {
    return new AutonomousDevOrchestrator(
      { repo: "owner/repo", pollIntervalMs: 1000, ...config },
      async (issueNumber, _context, _config) => {
        return workerResults.get(issueNumber) || { status: "completed", prUrl: "https://github.com/owner/repo/pull/1", summary: "done" };
      },
      (status) => statusChanges.push(status)
    );
  }

  describe("start/stop", () => {
    it("should start polling and detect repo if not set", async () => {
      const orch = createOrchestrator({ repo: undefined });
      (listIssuesByLabel as any).mockResolvedValue([]);

      await orch.start();
      expect(orch.getStatus().isRunning).toBe(true);

      orch.stop();
      expect(orch.getStatus().isRunning).toBe(false);
    });

    it("should throw if repo cannot be detected", async () => {
      (detectRepo as any).mockResolvedValue(null);
      const orch = createOrchestrator({ repo: undefined });

      await expect(orch.start()).rejects.toThrow("Cannot detect GitHub repository");
    });
  });

  describe("pollCycle — ready issue", () => {
    it("should pick up a ready issue, lock it, and spawn worker", async () => {
      const orch = createOrchestrator();

      (listIssuesByLabel as any)
        // First call: check clarification issues (empty)
        .mockResolvedValueOnce([])
        // Second call: ready issues
        .mockResolvedValueOnce([
          { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.READY], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        ]);

      (lockIssue as any).mockResolvedValue(undefined);
      (getIssueWithComments as any).mockResolvedValue({
        issue: { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.READY], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        comments: [],
      });
      (addLabels as any).mockResolvedValue(undefined);

      workerResults.set(42, { status: "completed", prUrl: "https://github.com/owner/repo/pull/1", summary: "done" });

      await orch.pollCycle();

      expect(lockIssue).toHaveBeenCalledWith("owner/repo", 42);
      expect(addLabels).toHaveBeenCalledWith("owner/repo", 42, [AUTONOMOUS_LABELS.COMPLETED]);
      expect(orch.getStatus().stats.totalCompleted).toBe(1);
    });
  });

  describe("pollCycle — needs-clarification", () => {
    it("should post question and wait when worker returns needs-clarification", async () => {
      const orch = createOrchestrator();

      (listIssuesByLabel as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.READY], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        ]);

      (lockIssue as any).mockResolvedValue(undefined);
      (getIssueWithComments as any).mockResolvedValue({
        issue: { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.IN_PROGRESS], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        comments: [],
      });
      (markNeedsClarification as any).mockResolvedValue(undefined);
      (postComment as any).mockResolvedValue("comment-url");

      workerResults.set(42, { status: "needs-clarification", question: "Which auth provider?" });

      await orch.pollCycle();

      expect(markNeedsClarification).toHaveBeenCalledWith("owner/repo", 42);
      expect(postComment).toHaveBeenCalledWith("owner/repo", 42, expect.stringContaining("Which auth provider?"));
      expect(orch.getStatus().stats.totalClarificationAsked).toBe(1);
    });
  });

  describe("pollCycle — author responds to clarification", () => {
    it("should resume processing when author comments after bot question", async () => {
      const orch = createOrchestrator();

      // First: set up tracked issue
      (listIssuesByLabel as any)
        // First poll: check clarification issues
        .mockResolvedValueOnce([
          { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        ])
        // First poll: ready issues (empty)
        .mockResolvedValueOnce([]);

      (getIssueWithComments as any).mockResolvedValue({
        issue: { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        comments: [
          { id: 1, author: "bot", body: "Which auth?", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
          { id: 2, author: "alice", body: "Use Google OAuth", createdAt: "2026-04-01T11:00:00Z", isFromBot: false },
        ],
      });

      (hasNewCommentsAfter as any).mockReturnValue(true);
      (resumeFromClarification as any).mockResolvedValue(undefined);
      (addLabels as any).mockResolvedValue(undefined);

      workerResults.set(42, { status: "completed", prUrl: "https://github.com/owner/repo/pull/2", summary: "done" });

      await orch.pollCycle();

      expect(resumeFromClarification).toHaveBeenCalledWith("owner/repo", 42);
      expect(addLabels).toHaveBeenCalledWith("owner/repo", 42, [AUTONOMOUS_LABELS.COMPLETED]);
    });
  });

  describe("pollCycle — max clarification rounds", () => {
    it("should mark as failed when max rounds exceeded", async () => {
      const orch = createOrchestrator({ maxClarificationRounds: 1 });

      (listIssuesByLabel as any)
        .mockResolvedValueOnce([
          { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        ])
        .mockResolvedValueOnce([]);

      (getIssueWithComments as any).mockResolvedValue({
        issue: { number: 42, title: "Add login", body: "We need login", labels: [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION], author: "alice", createdAt: "2026-04-01T00:00:00Z" },
        comments: [
          { id: 1, author: "bot", body: "Which auth?", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
          { id: 2, author: "alice", body: "Use Google", createdAt: "2026-04-01T11:00:00Z", isFromBot: false },
        ],
      });

      (hasNewCommentsAfter as any).mockReturnValue(true);
      (addLabels as any).mockResolvedValue(undefined);
      (postComment as any).mockResolvedValue("comment-url");

      await orch.pollCycle();

      expect(addLabels).toHaveBeenCalledWith("owner/repo", 42, [AUTONOMOUS_LABELS.FAILED]);
      expect(postComment).toHaveBeenCalledWith("owner/repo", 42, expect.stringContaining("Maximum clarification rounds"));
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && npx vitest run extensions/autonomous-dev/tests/orchestrator.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add extensions/autonomous-dev/orchestrator.ts extensions/autonomous-dev/tests/orchestrator.test.ts
git commit -m "feat(autonomous-dev): add orchestrator with polling and clarification loop"
```

---

### Task 3: Extension Entry + Agent + Skill

**Dependencies:** Runs after Task 2 completes
**Files:**
- Create: `extensions/autonomous-dev/index.ts`
- Create: `extensions/autonomous-dev/agents/autonomous-dev-worker.md`
- Create: `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md`

- [ ] **Step 1: Create agents/autonomous-dev-worker.md**

```markdown
---
name: autonomous-dev-worker
description: Processes a single GitHub issue end-to-end: assesses ambiguity, writes code, creates PR
tools: read,bash,write,edit,find,grep,webfetch
---

You are an autonomous development agent processing a GitHub issue. You work independently — no human is watching.

## Your Mission
Process the assigned GitHub issue completely. Either deliver a working PR or identify what's blocking you.

## Workflow

### Step 1: Understand the Issue
Read the issue context carefully. Understand:
- What is being requested
- What the acceptance criteria are (explicit or implied)
- What parts of the codebase are affected

### Step 2: Assess Ambiguity
Determine if you can proceed with confidence:
- **Clear enough to proceed**: You understand WHAT to build, WHERE to put it, and HOW it should behave
- **Needs clarification**: You're missing critical information that would lead to wrong implementation (e.g., "Which API?", "What format?", "Which behavior when X?")

**Threshold**: If the missing information could cause you to build the WRONG thing (not just a suboptimal thing), ask. If you can make a reasonable choice and document it, proceed.

### Step 3: If Clarification Needed
Output EXACTLY this format (nothing else):
```
STATUS: needs-clarification
QUESTION: [Your specific question for the issue author]
```
Then stop. Do NOT write any code.

### Step 4: If Clear — Implement
1. Explore the codebase to understand the relevant files
2. Create a feature branch: `git checkout -b autonomous/issue-{number}`
3. Write the code changes
4. Run existing tests to verify nothing is broken
5. Commit with message: `feat: {brief description} (closes #{number})`
6. Push the branch
7. Create a PR using `gh pr create`

### Step 5: Report Result
When done, output EXACTLY one of these formats:

**On success:**
```
STATUS: completed
PR_URL: [the PR URL]
SUMMARY: [what was implemented]
```

**On failure:**
```
STATUS: failed
ERROR: [what went wrong]
```

## Important Rules
- ALWAYS create a new branch for your work
- ALWAYS run tests before committing
- If you encounter unexpected complexity mid-implementation, don't ask for clarification — solve it and document your decision in the PR
- Keep changes minimal and focused on the issue
- Follow existing code patterns and conventions in the repo
```

- [ ] **Step 2: Create skills/autonomous-dev/SKILL.md**

```markdown
---
name: autonomous-dev
description: Autonomous development engine that processes GitHub issues end-to-end. Polls for issues labeled `autonomous-dev:ready`, assesses ambiguity, implements changes, and creates PRs. Use when the user says "start autonomous dev", "process issues", "auto-dev", or "run autonomous".
---

# Autonomous Dev Engine

Polls GitHub issues and processes them autonomously using the agentic pipeline.

## How It Works

1. **Poll**: Scans for issues labeled `autonomous-dev:ready`
2. **Lock**: Atomically sets `autonomous-dev:in-progress` label
3. **Assess**: Worker agent reads the issue and evaluates clarity
4. **Clarify** (if needed): Posts question as issue comment, waits for response
5. **Implement**: Worker writes code, creates branch, commits, pushes
6. **PR**: Creates pull request referencing the issue
7. **Label**: Sets `autonomous-dev:completed` or `autonomous-dev:review-requested`

## Label Protocol

| Label | Meaning |
|-------|---------|
| `autonomous-dev:ready` | Eligible for processing |
| `autonomous-dev:in-progress` | Currently being processed |
| `autonomous-dev:needs-clarification` | Waiting for author response |
| `autonomous-dev:completed` | PR created successfully |
| `autonomous-dev:failed` | Processing failed, needs human |

## Commands

- `/autonomous-dev start [interval]` — Start polling (default: 1m)
- `/autonomous-dev stop` — Stop polling
- `/autonomous-dev status` — Show current status

## Setup

1. Create labels in your GitHub repo:
   ```bash
   for label in ready in-progress needs-clarification completed failed; do
     gh label create "autonomous-dev:$label" --color "#0075ca" --description "Autonomous dev: $label" || true
   done
   ```
2. Add `autonomous-dev:ready` label to issues you want processed
3. Run `/autonomous-dev start` in your pi session
```

- [ ] **Step 3: Create index.ts**

```typescript
// extensions/autonomous-dev/index.ts

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { AutonomousDevOrchestrator } from "./orchestrator.js";
import { OrchestratorConfig, WorkerResult, AUTONOMOUS_LABELS } from "./types.js";
import {
  listIssuesByLabel,
  getIssueWithComments,
  postComment,
  addLabels,
  removeLabels,
  swapLabels,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
  createPullRequest,
  detectRepo,
  hasNewCommentsAfter,
} from "./github.js";
import { discoverAgents } from "../agentic-harness/agents.js";
import { runAgent, resolveDepthConfig } from "../agentic-harness/subagent.js";

export default function autonomousDevExtension(pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const BUNDLED_SKILLS_DIR = join(__dirname, "skills");
  const BUNDLED_AGENTS_DIR = join(__dirname, "agents");

  let orchestrator: AutonomousDevOrchestrator | null = null;

  // --- GitHub Tools (for use by the worker agent and other skills) ---

  pi.registerTool({
    name: "gh_issue_list",
    label: "List GitHub Issues",
    description:
      "List GitHub issues with a specific label. Used by the autonomous dev engine to find work items.",
    promptSnippet: "List GitHub issues by label",
    promptGuidelines: [
      "Use to find issues ready for autonomous processing.",
      "Default label is 'autonomous-dev:ready'.",
    ],
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "Repository in owner/repo format. Auto-detected if omitted." })),
      label: Type.String({ description: "Label to filter by", default: "autonomous-dev:ready" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const repo = params.repo || (await detectRepo(ctx.cwd)) || "";
      if (!repo) {
        return { content: [{ type: "text", text: "Error: Could not detect repository. Provide 'repo' parameter." }], isError: true };
      }
      try {
        const issues = await listIssuesByLabel(repo, params.label);
        if (issues.length === 0) {
          return { content: [{ type: "text", text: `No issues found with label "${params.label}" in ${repo}.` }] };
        }
        const list = issues.map((i) => `#${i.number}: ${i.title} (by @${i.author})`).join("\n");
        return { content: [{ type: "text", text: `Found ${issues.length} issue(s) in ${repo}:\n${list}` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "gh_issue_read",
    label: "Read GitHub Issue",
    description:
      "Read a GitHub issue with all its comments. Returns the full issue context.",
    promptSnippet: "Read a GitHub issue with comments",
    promptGuidelines: [
      "Use to get full context of an issue before processing.",
      "Returns issue body and all comments.",
    ],
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "Repository in owner/repo format. Auto-detected if omitted." })),
      issueNumber: Type.Number({ description: "Issue number to read" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const repo = params.repo || (await detectRepo(ctx.cwd)) || "";
      if (!repo) {
        return { content: [{ type: "text", text: "Error: Could not detect repository." }], isError: true };
      }
      try {
        const issueCtx = await getIssueWithComments(repo, params.issueNumber);
        let text = `# Issue #${issueCtx.issue.number}: ${issueCtx.issue.title}\n`;
        text += `Author: @${issueCtx.issue.author} | Labels: ${issueCtx.issue.labels.join(", ")}\n\n`;
        text += `${issueCtx.issue.body}\n\n`;
        if (issueCtx.comments.length > 0) {
          text += `## Comments (${issueCtx.comments.length})\n\n`;
          for (const c of issueCtx.comments) {
            text += `**${c.isFromBot ? "🤖" : "@" + c.author}** (${c.createdAt}):\n${c.body}\n\n---\n\n`;
          }
        }
        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "gh_issue_comment",
    label: "Comment on GitHub Issue",
    description:
      "Post a comment on a GitHub issue. Used to ask clarification questions or provide status updates.",
    promptSnippet: "Post a comment on a GitHub issue",
    promptGuidelines: [
      "Use to ask clarification questions on issues.",
      "Use to provide status updates during processing.",
    ],
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "Repository in owner/repo format. Auto-detected if omitted." })),
      issueNumber: Type.Number({ description: "Issue number to comment on" }),
      body: Type.String({ description: "Comment body in Markdown" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const repo = params.repo || (await detectRepo(ctx.cwd)) || "";
      if (!repo) {
        return { content: [{ type: "text", text: "Error: Could not detect repository." }], isError: true };
      }
      try {
        await postComment(repo, params.issueNumber, params.body);
        return { content: [{ type: "text", text: `Comment posted on issue #${params.issueNumber}.` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "gh_label",
    label: "Manage Issue Labels",
    description:
      "Add or remove labels on a GitHub issue. Used for the autonomous dev label protocol.",
    promptSnippet: "Manage GitHub issue labels",
    promptGuidelines: [
      "Use to manage the autonomous dev label protocol.",
      "Always remove previous state labels before adding new ones.",
    ],
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "Repository in owner/repo format. Auto-detected if omitted." })),
      issueNumber: Type.Number({ description: "Issue number" }),
      addLabels: Type.Optional(Type.Array(Type.String(), { description: "Labels to add" })),
      removeLabels: Type.Optional(Type.Array(Type.String(), { description: "Labels to remove" })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const repo = params.repo || (await detectRepo(ctx.cwd)) || "";
      if (!repo) {
        return { content: [{ type: "text", text: "Error: Could not detect repository." }], isError: true };
      }
      try {
        if (params.removeLabels && params.removeLabels.length > 0) {
          await removeLabels(repo, params.issueNumber, params.removeLabels);
        }
        if (params.addLabels && params.addLabels.length > 0) {
          await addLabels(repo, params.issueNumber, params.addLabels);
        }
        return { content: [{ type: "text", text: `Labels updated on issue #${params.issueNumber}.` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "gh_pr_create",
    label: "Create Pull Request",
    description:
      "Create a GitHub pull request. Used by the autonomous dev engine after code changes are committed and pushed.",
    promptSnippet: "Create a GitHub pull request",
    promptGuidelines: [
      "Use after committing and pushing code to create a PR.",
      "Include issue reference in the PR body (e.g., 'Closes #42').",
    ],
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "Repository in owner/repo format. Auto-detected if omitted." })),
      title: Type.String({ description: "PR title" }),
      body: Type.String({ description: "PR body in Markdown" }),
      headBranch: Type.String({ description: "Head branch (your feature branch)" }),
      baseBranch: Type.Optional(Type.String({ description: "Base branch (default: main)" })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const repo = params.repo || (await detectRepo(ctx.cwd)) || "";
      if (!repo) {
        return { content: [{ type: "text", text: "Error: Could not detect repository." }], isError: true };
      }
      try {
        const prUrl = await createPullRequest(
          repo,
          params.title,
          params.body,
          params.headBranch,
          params.baseBranch || "main"
        );
        return { content: [{ type: "text", text: `PR created: ${prUrl}` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });

  // --- Commands ---

  pi.registerCommand("autonomous-dev", {
    description: "Autonomous dev engine: start/stop/status for automatic GitHub issue processing",
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0] || "";
      const rest = args.trim().split(/\s+/).slice(1).join(" ");

      switch (subcommand) {
        case "start": {
          if (orchestrator) {
            ctx.ui.notify("Autonomous dev is already running. Use /autonomous-dev stop first.", "warning");
            return;
          }

          // Parse interval from args
          let intervalMs = 60_000;
          const intervalMatch = rest.match(/^(\d+)\s*([smhd])?$/);
          if (intervalMatch) {
            const value = parseInt(intervalMatch[1], 10);
            const unit = intervalMatch[2] || "s";
            const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
            intervalMs = value * (multipliers[unit] || 1000);
          }

          const depthConfig = resolveDepthConfig();

          orchestrator = new AutonomousDevOrchestrator(
            {
              repo: "", // auto-detect
              pollIntervalMs: intervalMs,
            },
            async (issueNumber, issueContext, config) => {
              // Spawn the autonomous-dev-worker agent via subagent system
              const agents = await discoverAgents(ctx.cwd || ".", "user", join(dirname(fileURLToPath(import.meta.url)), "..", "agentic-harness", "agents"));

              // Also include our own agents
              const ownAgents = await discoverAgents(ctx.cwd || ".", "user", BUNDLED_AGENTS_DIR);
              const allAgents = [...agents, ...ownAgents];

              const workerAgent = allAgents.find((a) => a.name === "autonomous-dev-worker");
              if (!workerAgent) {
                return { status: "failed", error: "autonomous-dev-worker agent not found" };
              }

              const task = `Process the following GitHub issue for repo ${config.repo}:\n\n${issueContext}\n\nRepository: ${config.repo}\nBranch prefix: ${config.branchPrefix}`;

              const result = await runAgent({
                agent: workerAgent,
                agentName: "autonomous-dev-worker",
                task,
                cwd: ctx.cwd || ".",
                depthConfig,
                signal: new AbortController().signal,
                onUpdate: undefined,
                makeDetails: (mode: "single") => (results: any[]) => ({ mode, results }),
              });

              // Parse worker output for STATUS markers
              const output = result.messages
                ?.filter((m: any) => m.role === "assistant")
                ?.map((m: any) => m.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join(""))
                ?.join("\n") || "";

              if (output.includes("STATUS: needs-clarification")) {
                const questionMatch = output.match(/QUESTION:\s*(.+?)(?:\n|$)/s);
                return {
                  status: "needs-clarification",
                  question: questionMatch?.[1]?.trim() || "Please provide more details about this issue.",
                };
              }

              if (output.includes("STATUS: failed")) {
                const errorMatch = output.match(/ERROR:\s*(.+?)(?:\n|$)/s);
                return {
                  status: "failed",
                  error: errorMatch?.[1]?.trim() || "Unknown error during processing.",
                };
              }

              // Default: completed
              const prMatch = output.match(/PR_URL:\s*(.+?)(?:\n|$)/s);
              const summaryMatch = output.match(/SUMMARY:\s*(.+?)(?:\n|$)/s);
              return {
                status: "completed",
                prUrl: prMatch?.[1]?.trim() || "",
                summary: summaryMatch?.[1]?.trim() || "Implementation completed.",
              };
            },
            (status) => {
              console.log("[autonomous-dev] Status:", JSON.stringify(status.stats));
            }
          );

          try {
            await orchestrator.start();
            const intervalStr = intervalMs >= 60_000 ? `${intervalMs / 60_000}m` : `${intervalMs / 1000}s`;
            ctx.ui.notify(`Autonomous dev started — polling ${orchestrator.getStatus().repo} every ${intervalStr}`, "info");
          } catch (err: any) {
            orchestrator = null;
            ctx.ui.notify(`Error: ${err.message}`, "error");
          }
          break;
        }

        case "stop": {
          if (!orchestrator) {
            ctx.ui.notify("Autonomous dev is not running.", "warning");
            return;
          }
          orchestrator.stop();
          const stats = orchestrator.getStatus().stats;
          ctx.ui.notify(
            `Autonomous dev stopped. Processed: ${stats.totalProcessed}, Completed: ${stats.totalCompleted}, Failed: ${stats.totalFailed}`,
            "info"
          );
          orchestrator = null;
          break;
        }

        case "status": {
          if (!orchestrator) {
            ctx.ui.notify("Autonomous dev is not running. Use /autonomous-dev start to begin.", "info");
            return;
          }
          const status = orchestrator.getStatus();
          console.log("\nAutonomous Dev Status");
          console.log("=".repeat(40));
          console.log(`Running: ${status.isRunning}`);
          console.log(`Repo: ${status.repo}`);
          console.log(`Poll interval: ${status.pollIntervalMs}ms`);
          console.log(`Tracked issues: ${status.trackedIssues.length}`);
          for (const tracked of status.trackedIssues) {
            console.log(`  #${tracked.issueNumber}: ${tracked.status} (round ${tracked.clarificationRound})`);
          }
          console.log(`Stats: ${status.stats.totalProcessed} processed, ${status.stats.totalCompleted} completed, ${status.stats.totalFailed} failed`);
          console.log("=".repeat(40));
          ctx.ui.notify(`Autonomous dev: ${status.trackedIssues.length} tracked, ${status.stats.totalCompleted} completed`, "info");
          break;
        }

        default: {
          ctx.ui.notify(
            "Usage: /autonomous-dev start [interval] | stop | status\n\nExamples:\n  /autonomous-dev start 1m\n  /autonomous-dev start 30s\n  /autonomous-dev stop\n  /autonomous-dev status",
            "info"
          );
          break;
        }
      }
    },
  });

  // Register skill discovery
  pi.on("resources_discover", async () => {
    return { skillPaths: [BUNDLED_SKILLS_DIR] };
  });

  // Clean up on session shutdown
  pi.on("session_shutdown", async () => {
    if (orchestrator) {
      orchestrator.stop();
      console.log("[autonomous-dev] Cleaned up on session shutdown");
    }
  });

  console.log("Extension loaded: /autonomous-dev (start|stop|status)");
}
```

- [ ] **Step 4: Register the extension in package.json**

Add `"extensions/autonomous-dev/index.ts"` to the `pi.extensions` array in `package.json`:

```json
"pi": {
  "extensions": [
    "extensions/agentic-harness/index.ts",
    "extensions/hud-dashboard/src/index.ts",
    "extensions/session-loop/index.ts",
    "extensions/autonomous-dev/index.ts"
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add extensions/autonomous-dev/index.ts extensions/autonomous-dev/agents/autonomous-dev-worker.md extensions/autonomous-dev/skills/autonomous-dev/SKILL.md package.json
git commit -m "feat(autonomous-dev): add extension entry, worker agent, and skill"
```

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && npx vitest run`
Expected: ALL PASS — both existing tests and new autonomous-dev tests

- [ ] **Step 2: Verify plan success criteria**

- [ ] GitHub client (`github.ts`) wraps all required `gh` CLI operations (list, read, comment, label, PR)
- [ ] Orchestrator (`orchestrator.ts`) implements the full clarification loop with label-based locking
- [ ] Extension (`index.ts`) registers 5 GitHub tools and `/autonomous-dev` command
- [ ] Worker agent (`autonomous-dev-worker.md`) has clear STATUS output protocol
- [ ] Skill (`SKILL.md`) documents the label protocol and commands
- [ ] package.json includes the new extension entry
- [ ] No regressions in existing tests

- [ ] **Step 3: Run full test suite for regressions**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && npx vitest run`
Expected: No regressions — all pre-existing tests still pass
