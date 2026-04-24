import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { captureWorktreeDiff, cleanupWorktree, createWorktree } from "../worktree.js";

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve();
    });
  });
}

describe("worktree helpers", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "pi-worktree-test-"));
    await git(["init"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await writeFile(join(repo, "README.md"), "hello\n", "utf-8");
    await git(["add", "README.md"], repo);
    await git(["commit", "-m", "init"], repo);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("creates, captures, and cleans up an isolated worktree", async () => {
    const ctx = await createWorktree(repo, "abc123");
    await writeFile(join(ctx.path, "README.md"), "changed\n", "utf-8");
    const artifactDir = join(repo, ".artifacts");
    await mkdir(artifactDir, { recursive: true });

    const diffFile = await captureWorktreeDiff(ctx, artifactDir);
    expect(diffFile).toBe(join(artifactDir, "worktree.diff.md"));
    expect(ctx.diffFile).toBe(diffFile);

    await cleanupWorktree(ctx);
    expect(ctx.cleanupStatus).toBe("removed");
  });
});
