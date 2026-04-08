import { execSync } from "child_process";
import { GitHubIssue, GitHubComment, IssueContext, AUTONOMOUS_LABELS, GitHubError } from "./types.js";

/** Throws GitHubError on failure. */
function execGhJson<T>(args: string): T {
  try {
    const result = execSync(`gh ${args}`, {
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

/** Throws GitHubError on failure. */
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
    return execGhRaw(
      `issue comment ${issueNumber} --repo ${repo} --body-file "${tmpFile}"`
    );
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// --- Label operations ---

/**
 * Swap labels on an issue: remove then add.
 * NOT truly atomic, but sequential remove→add is safe because labels are additive.
 */
export async function swapLabels(
  repo: string,
  issueNumber: number,
  removeLabels: string[],
  addLabels: string[]
): Promise<void> {
  for (const label of removeLabels) {
    try {
      execGhRaw(`issue edit ${issueNumber} --repo ${repo} --remove-label "${label}"`);
    } catch {
      // Label may not exist
    }
  }
  const labelArgs = addLabels.map((l) => `"${l}"`).join(",");
  if (labelArgs) {
    execGhRaw(`issue edit ${issueNumber} --repo ${repo} --add-label ${labelArgs}`);
  }
}

/** ready → in-progress */
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

/** in-progress → needs-clarification */
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

/** needs-clarification → in-progress */
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
    (c) =>
      (!excludeBot || !c.isFromBot) &&
      new Date(c.createdAt) > new Date(afterTimestamp)
  );
}
