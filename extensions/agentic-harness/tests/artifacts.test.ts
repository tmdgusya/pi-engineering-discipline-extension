import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createArtifactContext, readDeclaredFiles } from "../artifacts.js";

describe("artifact helpers", () => {
  let cwd: string;
  const originalRoot = process.env.PI_SUBAGENT_ARTIFACT_ROOT;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "pi-artifacts-test-"));
    process.env.PI_SUBAGENT_ARTIFACT_ROOT = join(cwd, ".runs");
  });

  afterEach(async () => {
    if (originalRoot === undefined) delete process.env.PI_SUBAGENT_ARTIFACT_ROOT;
    else process.env.PI_SUBAGENT_ARTIFACT_ROOT = originalRoot;
    await rm(cwd, { recursive: true, force: true });
  });

  it("creates stable run artifact paths", async () => {
    const ctx = await createArtifactContext({
      cwd,
      rootRunId: "root/id",
      runId: "run/id",
      agentName: "worker",
      output: "output.md",
      progress: "progress.md",
      reads: ["input.md"],
    });

    expect(ctx.runDir).toContain("worker-run-id");
    expect(ctx.outputFile).toBe(join(ctx.runDir, "output.md"));
    expect(ctx.progressFile).toBe(join(ctx.runDir, "progress.md"));
    expect(ctx.readFiles).toEqual([join(cwd, "input.md")]);
  });

  it("formats declared read files with truncation", async () => {
    const file = join(cwd, "input.md");
    await writeFile(file, "x".repeat(20), "utf-8");
    const text = await readDeclaredFiles([file], cwd, 10);
    expect(text).toContain("input.md");
    expect(text).toContain("[truncated read: 20 -> 10 bytes]");
  });

  it("rejects artifact paths and reads that escape their allowed roots", async () => {
    await expect(createArtifactContext({
      cwd,
      rootRunId: "root",
      runId: "run",
      agentName: "worker",
      output: "../escape.md",
    })).rejects.toThrow(/escapes the run directory/);

    await expect(createArtifactContext({
      cwd,
      rootRunId: "root",
      runId: "run",
      agentName: "worker",
      reads: ["../secret.txt"],
    })).rejects.toThrow(/escapes the workspace/);
  });
});
