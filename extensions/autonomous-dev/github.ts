import { execFile } from "child_process";
import { GitHubIssue, GitHubComment, IssueContext, AUTONOMOUS_LABELS, GitHubError } from "./types.js";

function formatCommand(command: string, args: string[]): string {
  const escapedArgs = args.map((arg) => (/\s|"/.test(arg) ? JSON.stringify(arg) : arg));
  return [command, ...escapedArgs].join(" ");
}

function execCommand(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf-8",
        timeout: 30_000,
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          (error as any).stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function execJson<T>(command: string, args: string[], cwd?: string): Promise<T> {
  try {
    const stdout = await execCommand(command, args, cwd);
    return JSON.parse(stdout) as T;
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const exitCode = err.code ?? err.status ?? null;
    throw new GitHubError(
      `command failed: ${formatCommand(command, args)}`,
      formatCommand(command, args),
      typeof exitCode === "number" ? exitCode : null,
      stderr
    );
  }
}

async function execRaw(command: string, args: string[], cwd?: string): Promise<string> {
  try {
    const stdout = await execCommand(command, args, cwd);
    return stdout.trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const exitCode = err.code ?? err.status ?? null;
    throw new GitHubError(
      `command failed: ${formatCommand(command, args)}`,
      formatCommand(command, args),
      typeof exitCode === "number" ? exitCode : null,
      stderr
    );
  }
}

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

  const issues = await execJson<GhIssue[]>("gh", [
    "issue",
    "list",
    "--search",
    query,
    "--limit",
    "50",
    "--json",
    "number,title,body,labels,author,createdAt",
  ]);

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

  const issue = await execJson<GhIssue>("gh", [
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "number,title,body,labels,author,createdAt",
  ]);

  let comments: GhComment[] = [];
  try {
    const response = await execJson<{ comments?: GhComment[] }>("gh", [
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      repo,
      "--comments",
      "--json",
      "comments",
    ]);
    comments = response.comments || [];
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
    return await execRaw("gh", [
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      repo,
      "--body-file",
      tmpFile,
    ]);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export async function swapLabels(
  repo: string,
  issueNumber: number,
  removeLabels: string[],
  addLabels: string[]
): Promise<void> {
  for (const label of removeLabels) {
    try {
      await execRaw("gh", [
        "issue",
        "edit",
        String(issueNumber),
        "--repo",
        repo,
        "--remove-label",
        label,
      ]);
    } catch {
      // Label may not exist
    }
  }
  if (addLabels.length > 0) {
    await execRaw("gh", [
      "issue",
      "edit",
      String(issueNumber),
      "--repo",
      repo,
      "--add-label",
      addLabels.join(","),
    ]);
  }
}

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
    return await execRaw("gh", [
      "pr",
      "create",
      "--repo",
      repo,
      "--title",
      title,
      "--body-file",
      tmpFile,
      "--head",
      headBranch,
      "--base",
      baseBranch,
    ]);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export async function detectRepo(cwd?: string): Promise<string | null> {
  try {
    const remoteUrl = await execRaw("git", ["remote", "get-url", "origin"], cwd);
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
