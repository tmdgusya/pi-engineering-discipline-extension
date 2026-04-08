# Plan: M1 — Foundation — Types + GitHub Client

## Context Brief

**Goal:** Establish the type system and GitHub API client contract that all downstream components depend on.

**Scope:** Create `types.ts`, `github.ts`, and `tests/github.test.ts` for the autonomous-dev extension.

**Success Criteria:**
- `extensions/autonomous-dev/types.ts` exports `AUTONOMOUS_LABELS` constant with all 6 label values
- `extensions/autonomous-dev/types.ts` exports `WorkerResult` discriminated union
- `extensions/autonomous-dev/types.ts` exports `OrchestratorConfig`, `DEFAULT_CONFIG`, `GitHubError`
- `extensions/autonomous-dev/github.ts` implements all gh CLI wrappers
- `extensions/autonomous-dev/tests/github.test.ts` covers core operations with mocked execSync
- `npx vitest run extensions/autonomous-dev/tests/github.test.ts` passes

**Files to create:**
- `extensions/autonomous-dev/types.ts`
- `extensions/autonomous-dev/github.ts`
- `extensions/autonomous-dev/tests/github.test.ts`

**Constraints:**
- Use `gh` CLI only — no external GitHub API libraries
- All gh commands use `--json` flag for parsing
- Error handling via `GitHubError` class
- Tests use `vi.mock("child_process")` with `execSync` mocking

---

## Task 1: Create types.ts

Create `extensions/autonomous-dev/types.ts` with all shared types:

```typescript
// GitHub issue with minimal fields needed by the orchestrator
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  createdAt: string;
}

// A single comment on a GitHub issue
export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  isFromBot: boolean;
}

// Result of an issue read (issue + comments)
export interface IssueContext {
  issue: GitHubIssue;
  comments: GitHubComment[];
}

// Label protocol for autonomous dev
export const AUTONOMOUS_LABELS = {
  READY: "autonomous-dev:ready",
  IN_PROGRESS: "autonomous-dev:in-progress",
  NEEDS_CLARIFICATION: "autonomous-dev:needs-clarification",
  REVIEW_REQUESTED: "autonomous-dev:review-requested",
  COMPLETED: "autonomous-dev:completed",
  FAILED: "autonomous-dev:failed",
} as const;

export type AutonomousLabel = typeof AUTONOMOUS_LABELS[keyof typeof AUTONOMOUS_LABELS];

// Result returned by the worker agent
export type WorkerResult =
  | { status: "completed"; prUrl: string; summary: string }
  | { status: "needs-clarification"; question: string }
  | { status: "failed"; error: string };

// Configuration for the orchestrator
export interface OrchestratorConfig {
  repo: string;
  pollIntervalMs: number;
  maxClarificationRounds: number;
  branchPrefix: string;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  repo: "",
  pollIntervalMs: 60_000,
  maxClarificationRounds: 3,
  branchPrefix: "autonomous/",
};

// Orchestrator state for a single issue being tracked
export interface TrackedIssue {
  issueNumber: number;
  status: "waiting_clarification" | "processing";
  clarificationRound: number;
  lockedAt: Date;
}

// Status returned by /autonomous-dev status command
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

// Error type for GitHub operations
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

---

## Task 2: Create github.ts

Create `extensions/autonomous-dev/github.ts` with gh CLI wrappers:

```typescript
import { execSync } from "child_process";
import { GitHubIssue, GitHubComment, IssueContext, AUTONOMOUS_LABELS, GitHubError } from "./types.js";

/**
 * Execute a gh CLI command and return parsed JSON output.
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
    throw new GitHubError(`gh command failed: gh ${args}`, `gh ${args}`, exitCode, stderr);
  }
}

/**
 * Execute a gh CLI command and return raw stdout.
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
    throw new GitHubError(`gh command failed: gh ${args}`, `gh ${args}`, exitCode, stderr);
  }
}

// --- Issue operations ---

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

export async function postComment(
  repo: string,
  issueNumber: number,
  body: string
): Promise<string> {
  const { writeFileSync, unlinkSync, mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");

  const tmpDir = mkdtempSync(join(tmpdir(), "autonomous-dev-"));
  const tmpFile = join(tmpDir, "comment.md");
  writeFileSync(tmpFile, body, "utf-8");

  try {
    return execGhRaw(`issue comment ${issueNumber} --repo ${repo} --body-file "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// --- Label operations ---

export async function addLabels(
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const labelArgs = labels.map((l) => `"${l}"`).join(",");
  execGhRaw(`issue edit ${issueNumber} --repo ${repo} --add-label ${labelArgs}`);
}

export async function removeLabels(
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  for (const label of labels) {
    try {
      execGhRaw(`issue edit ${issueNumber} --repo ${repo} --remove-label "${label}"`);
    } catch {
      // Label may not exist — ignore
    }
  }
}

export async function swapLabels(
  repo: string,
  issueNumber: number,
  removeLabels: string[],
  addLabels: string[]
): Promise<void> {
  await removeLabels(repo, issueNumber, removeLabels);
  await addLabels(repo, issueNumber, addLabels);
}

export async function lockIssue(repo: string, issueNumber: number): Promise<void> {
  await swapLabels(repo, issueNumber, [AUTONOMOUS_LABELS.READY], [AUTONOMOUS_LABELS.IN_PROGRESS]);
}

export async function markNeedsClarification(repo: string, issueNumber: number): Promise<void> {
  await swapLabels(repo, issueNumber, [AUTONOMOUS_LABELS.IN_PROGRESS], [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION]);
}

export async function resumeFromClarification(repo: string, issueNumber: number): Promise<void> {
  await swapLabels(repo, issueNumber, [AUTONOMOUS_LABELS.NEEDS_CLARIFICATION], [AUTONOMOUS_LABELS.IN_PROGRESS]);
}

// --- PR operations ---

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

export async function detectRepo(cwd?: string): Promise<string | null> {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf-8",
      cwd,
      timeout: 5000,
    }).trim();
    const match = remoteUrl.match(/(?:github\.com[:/])([^/]+\/[^/\s]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function hasNewCommentsAfter(
  comments: GitHubComment[],
  afterTimestamp: string,
  excludeBot: boolean = true
): boolean {
  return comments.some(
    (c) => (!excludeBot || !c.isFromBot) && new Date(c.createdAt) > new Date(afterTimestamp)
  );
}
```

---

## Task 3: Create tests/github.test.ts

Create `extensions/autonomous-dev/tests/github.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listIssuesByLabel,
  getIssueWithComments,
  swapLabels,
  lockIssue,
  hasNewCommentsAfter,
  detectRepo,
} from "../github.js";
import { AUTONOMOUS_LABELS } from "../types.js";

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

---

## Task 4: Run tests

Execute: `npx vitest run extensions/autonomous-dev/tests/github.test.ts`

Expected: All tests pass

---

## Verification

- [ ] `extensions/autonomous-dev/types.ts` exports all required types and constants
- [ ] `extensions/autonomous-dev/github.ts` implements all gh CLI wrappers
- [ ] `extensions/autonomous-dev/tests/github.test.ts` covers core operations
- [ ] `npx vitest run extensions/autonomous-dev/tests/github.test.ts` passes
