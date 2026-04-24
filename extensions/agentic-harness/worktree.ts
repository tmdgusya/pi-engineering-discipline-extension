import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export interface WorktreeContext {
  path: string;
  gitRoot: string;
  diffFile?: string;
  cleanupStatus: "not-needed" | "removed" | "failed" | "kept";
  error?: string;
}

const MAX_DIFF_BUFFER = 1024 * 1024;

function execGit(args: string[], cwd: string, maxBuffer = MAX_DIFF_BUFFER): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        const message = (stderr || stdout || error.message).trim();
        reject(new Error(message.includes("stdout maxBuffer") ? `${message}\n[truncated: diff exceeded ${maxBuffer} bytes]` : message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function createWorktree(cwd: string, runId: string): Promise<WorktreeContext> {
  const gitRoot = await execGit(["rev-parse", "--show-toplevel"], cwd);
  const path = await mkdtemp(join(tmpdir(), `pi-subagent-worktree-${runId}-`));
  try {
    await execGit(["worktree", "add", "--detach", path, "HEAD"], gitRoot);
    return { path, gitRoot, cleanupStatus: "not-needed" };
  } catch (error) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function captureWorktreeDiff(ctx: WorktreeContext, artifactDir: string): Promise<string | undefined> {
  try {
    const status = await execGit(["status", "--short"], ctx.path).catch((error) => `[status failed] ${error.message}`);
    const stat = await execGit(["diff", "--stat"], ctx.path).catch((error) => `[diff stat failed] ${error.message}`);
    const unstaged = await execGit(["diff"], ctx.path).catch((error) => `[diff failed] ${error.message}`);
    const staged = await execGit(["diff", "--cached"], ctx.path).catch((error) => `[cached diff failed] ${error.message}`);
    const content = [
      "# Worktree Diff",
      "",
      `Worktree: ${ctx.path}`,
      `Git root: ${ctx.gitRoot}`,
      `Max captured diff buffer: ${MAX_DIFF_BUFFER} bytes`,
      "",
      "## Status",
      "```",
      status,
      "```",
      "",
      "## Diff Stat",
      "```",
      stat,
      "```",
      "",
      "## Unstaged Diff",
      "```diff",
      unstaged,
      "```",
      "",
      "## Staged Diff",
      "```diff",
      staged,
      "```",
      "",
    ].join("\n");
    const file = join(artifactDir, "worktree.diff.md");
    await writeFile(file, content, "utf-8");
    ctx.diffFile = file;
    return file;
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : String(error);
    return undefined;
  }
}

export async function cleanupWorktree(ctx: WorktreeContext): Promise<void> {
  try {
    await execGit(["worktree", "remove", "--force", ctx.path], ctx.gitRoot);
    ctx.cleanupStatus = "removed";
  } catch (error) {
    ctx.cleanupStatus = "failed";
    ctx.error = error instanceof Error ? error.message : String(error);
  }
}
