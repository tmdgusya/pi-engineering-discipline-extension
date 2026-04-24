import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseFrontmatter, loadAgentsFromDir } from "../agents.js";

describe("parseFrontmatter", () => {
  it("should parse valid frontmatter with body", () => {
    const content = [
      "---",
      "name: scout",
      "description: Fast recon agent",
      "model: haiku",
      "tools: read,glob,grep",
      "---",
      "You are a scout agent.",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("scout");
    expect(result.frontmatter.description).toBe("Fast recon agent");
    expect(result.frontmatter.model).toBe("haiku");
    expect(result.frontmatter.tools).toBe("read,glob,grep");
    expect(result.body).toBe("You are a scout agent.");
  });

  it("should return empty frontmatter when no delimiters", () => {
    const content = "Just a plain file with no frontmatter.";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it("should handle empty body after frontmatter", () => {
    const content = "---\nname: test\ndescription: desc\n---\n";
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("test");
    expect(result.body).toBe("");
  });

  it("should handle colons in values", () => {
    const content = "---\nname: my-agent\ndescription: Agent for http://example.com tasks\n---\nBody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter.description).toBe("Agent for http://example.com tasks");
  });

  it("should strip quotes and comments without treating hashes inside quotes as comments", () => {
    const content = [
      "---",
      "name: \"quoted-agent\" # inline comment",
      "description: 'Uses # tags safely'",
      "maxOutput: 1000",
      "worktree: true",
      "---",
      "Body",
    ].join("\n");
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("quoted-agent");
    expect(result.frontmatter.description).toBe("Uses # tags safely");
    expect(result.frontmatter.maxOutput).toBe("1000");
    expect(result.frontmatter.worktree).toBe("true");
  });
});

describe("loadAgentsFromDir", () => {
  const testDir = join(tmpdir(), `pi-agents-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should load agents from .md files with valid frontmatter", async () => {
    await writeFile(
      join(testDir, "scout.md"),
      "---\nname: scout\ndescription: Fast recon\nmodel: haiku\ntools: read,glob\n---\nYou are a scout.",
    );
    await writeFile(
      join(testDir, "worker.md"),
      "---\nname: worker\ndescription: General worker\n---\nYou are a worker.",
    );

    const agents = await loadAgentsFromDir(testDir, "user");
    expect(agents).toHaveLength(2);

    const scout = agents.find((a) => a.name === "scout")!;
    expect(scout.description).toBe("Fast recon");
    expect(scout.model).toBe("haiku");
    expect(scout.tools).toEqual(["read", "glob"]);
    expect(scout.systemPrompt).toBe("You are a scout.");
    expect(scout.source).toBe("user");

    const worker = agents.find((a) => a.name === "worker")!;
    expect(worker.tools).toBeUndefined();
    expect(worker.model).toBeUndefined();
  });

  it("should skip files without required frontmatter fields", async () => {
    await writeFile(join(testDir, "invalid.md"), "---\nname: no-desc\n---\nBody");
    await writeFile(join(testDir, "valid.md"), "---\nname: ok\ndescription: valid\n---\nBody");

    const agents = await loadAgentsFromDir(testDir, "project");
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("ok");
    expect(agents[0].source).toBe("project");
  });

  it("should skip non-.md files", async () => {
    await writeFile(join(testDir, "readme.txt"), "not an agent");
    await writeFile(join(testDir, "agent.md"), "---\nname: agent\ndescription: test\n---\nBody");

    const agents = await loadAgentsFromDir(testDir, "user");
    expect(agents).toHaveLength(1);
  });

  it("should load extended dependency-free config fields", async () => {
    await writeFile(
      join(testDir, "extended.md"),
      [
        "---",
        "name: extended",
        "description: Extended config",
        "tools: [read, grep]",
        "maxOutput: 4096",
        "maxSubagentDepth: 2",
        "output: final.md",
        "defaultReads: [README.md, docs/spec.md]",
        "defaultProgress: progress.md",
        "context: fork",
        "worktree: true",
        "---",
        "Prompt.",
      ].join("\n"),
    );

    const agents = await loadAgentsFromDir(testDir, "project");
    const extended = agents.find((a) => a.name === "extended")!;
    expect(extended.tools).toEqual(["read", "grep"]);
    expect(extended.maxOutput).toBe(4096);
    expect(extended.maxSubagentDepth).toBe(2);
    expect(extended.output).toBe("final.md");
    expect(extended.defaultReads).toEqual(["README.md", "docs/spec.md"]);
    expect(extended.defaultProgress).toBe("progress.md");
    expect(extended.context).toBe("fork");
    expect(extended.worktree).toBe(true);
  });

  it("should ignore invalid extended frontmatter values", async () => {
    await writeFile(
      join(testDir, "invalid-extended.md"),
      "---\nname: invalid-extended\ndescription: Invalid extended\nmaxOutput: 0\nmaxSubagentDepth: -1\ncontext: reuse\nworktree: maybe\n---\nPrompt.",
    );

    const agents = await loadAgentsFromDir(testDir, "project");
    const agent = agents.find((a) => a.name === "invalid-extended")!;
    expect(agent.maxOutput).toBeUndefined();
    expect(agent.maxSubagentDepth).toBeUndefined();
    expect(agent.context).toBeUndefined();
    expect(agent.worktree).toBeUndefined();
  });

  it("should return empty array for non-existent directory", async () => {
    const agents = await loadAgentsFromDir("/tmp/nonexistent-dir-xyz", "user");
    expect(agents).toEqual([]);
  });
});
