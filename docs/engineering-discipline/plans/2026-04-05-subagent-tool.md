# Subagent Tool Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Implement a `subagent` tool in the agentic-harness extension that spawns `pi` CLI subprocesses to enable single, parallel, and chain agent dispatch — making the engineering discipline skills' subagent requirements actually executable.

**Architecture:** Three-module design. `agents.ts` handles filesystem-based agent discovery (`.md` files with YAML frontmatter from `~/.pi/agent/agents/` and `.pi/agents/`). `subagent.ts` provides the core execution engine — process spawning via `child_process.spawn`, JSON stream parsing of `pi --mode json` output, worker-pool concurrency control, and chain mode with `{previous}` placeholder substitution. `index.ts` registers the `subagent` tool with a TypeBox schema and updates `PHASE_GUIDANCE` to reference the actual tool.

**Tech Stack:** TypeScript, `@sinclair/typebox`, `@mariozechner/pi-ai` (StringEnum), Node.js `child_process`, vitest

**Work Scope:**
- **In scope:** `subagent` tool (single/parallel/chain modes), agent config discovery, JSON stream parsing, concurrency control, PHASE_GUIDANCE updates, unit tests
- **Out of scope:** Custom TUI rendering for subagent progress, engineering-discipline SKILL file modifications, root README update, streaming `onUpdate` progress (deferred to future iteration)

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test && npx tsc --noEmit`
- **What it validates:** All tests pass (existing + new), TypeScript compiles clean with no type errors

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `extensions/agentic-harness/agents.ts` | Create | AgentConfig type, YAML frontmatter parsing, filesystem agent discovery |
| `extensions/agentic-harness/subagent.ts` | Create | Pi process spawn, JSON output parsing, concurrency-limited parallel execution, chain execution |
| `extensions/agentic-harness/index.ts` | Modify | Register `subagent` tool, update PHASE_GUIDANCE to reference `subagent` tool |
| `extensions/agentic-harness/package.json` | Modify | Add `@mariozechner/pi-ai` dependency |
| `extensions/agentic-harness/tests/agents.test.ts` | Create | Tests for parseFrontmatter, loadAgentsFromDir |
| `extensions/agentic-harness/tests/subagent.test.ts` | Create | Tests for extractFinalOutput, mapWithConcurrencyLimit, getPiInvocation |
| `extensions/agentic-harness/tests/extension.test.ts` | Modify | Add subagent tool registration test, update PHASE_GUIDANCE test |

---

## Task Dependency Graph

```
Task 1 (agents.ts) ──┬──> Task 3 (agents.test.ts)
                      │
                      ├──> Task 2 (subagent.ts) ──┬──> Task 4 (subagent.test.ts)
                      │                           │
                      └───────────────────────────>├──> Task 5 (index.ts + package.json)
                                                   │         │
                                                   │         └──> Task 6 (extension.test.ts)
                                                   │                    │
                                                   └────────────────────└──> Task 7 (Final Verification)
```

Parallelizable after Task 1: Tasks 2 and 3.
Parallelizable after Task 2: Tasks 4 and 5.

---

### Task 1: Create agents.ts — Agent Discovery Module

**Dependencies:** None (can start immediately)
**Files:**
- Create: `extensions/agentic-harness/agents.ts`

- [ ] **Step 1: Create agents.ts with full implementation**

```typescript
import { readdir, readFile } from "fs/promises";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

export async function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
): Promise<AgentConfig[]> {
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(dir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      if (!frontmatter.name || !frontmatter.description) continue;

      agents.push({
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter.tools
          ? frontmatter.tools.split(",").map((t) => t.trim())
          : undefined,
        model: frontmatter.model || undefined,
        systemPrompt: body,
        source,
        filePath,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return agents;
}

export async function discoverAgents(
  cwd: string,
  scope: "user" | "project" | "both" = "user",
): Promise<AgentConfig[]> {
  const agents = new Map<string, AgentConfig>();

  if (scope === "user" || scope === "both") {
    const userDir = join(homedir(), ".pi", "agent", "agents");
    for (const agent of await loadAgentsFromDir(userDir, "user")) {
      agents.set(agent.name, agent);
    }
  }

  if (scope === "project" || scope === "both") {
    let dir = cwd;
    while (true) {
      const projectDir = join(dir, ".pi", "agents");
      if (existsSync(projectDir)) {
        for (const agent of await loadAgentsFromDir(projectDir, "project")) {
          agents.set(agent.name, agent); // project overrides user
        }
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return Array.from(agents.values());
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npx tsc --noEmit agents.ts`
Expected: Clean compile, no errors

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/agents.ts
git commit -m "feat: add agent discovery module (agents.ts)

Implements AgentConfig type, YAML frontmatter parsing, and filesystem-based
agent discovery from ~/.pi/agent/agents/ (user) and .pi/agents/ (project)."
```

---

### Task 2: Create subagent.ts — Core Execution Engine

**Dependencies:** Runs after Task 1 completes (imports AgentConfig from agents.ts)
**Files:**
- Create: `extensions/agentic-harness/subagent.ts`

- [ ] **Step 1: Create subagent.ts with full implementation**

```typescript
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename } from "path";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import type { AgentConfig } from "./agents.js";

// ============================================================
// Types
// ============================================================

export interface SubagentResult {
  output: string;
  exitCode: number;
  error?: string;
}

// ============================================================
// Constants
// ============================================================

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
const KILL_TIMEOUT_MS = 5000;

// ============================================================
// Helpers (exported for testing)
// ============================================================

export function getPiInvocation(): { command: string; args: string[] } {
  const mainScript = process.argv[1];
  if (mainScript && existsSync(mainScript)) {
    const execName = basename(process.execPath).toLowerCase();
    if (
      execName === "node" ||
      execName === "bun" ||
      execName.startsWith("node.") ||
      execName.startsWith("bun.")
    ) {
      return { command: process.execPath, args: [mainScript] };
    }
    return { command: process.execPath, args: [] };
  }
  return { command: "pi", args: [] };
}

export function extractFinalOutput(stdout: string): string {
  const lines = stdout.split("\n");
  const messages: any[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "message_end" && event.message) {
        messages.push(event.message);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        if (msg.content[j].type === "text" && msg.content[j].text?.trim()) {
          return msg.content[j].text;
        }
      }
    }
  }

  return "";
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

// ============================================================
// Core Execution
// ============================================================

async function writeTempSystemPrompt(content: string): Promise<string> {
  const filename = `pi-subagent-${randomBytes(8).toString("hex")}.md`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

export async function runSingleAgent(
  agent: AgentConfig | undefined,
  task: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  const invocation = getPiInvocation();
  const args = [...invocation.args, "--mode", "json", "-p", "--no-session"];

  if (agent?.model) args.push("--model", agent.model);
  if (agent?.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  let tmpPromptPath: string | undefined;

  try {
    if (agent?.systemPrompt) {
      tmpPromptPath = await writeTempSystemPrompt(agent.systemPrompt);
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);

    return await new Promise<SubagentResult>((resolve) => {
      const proc = spawn(invocation.command, args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let wasAborted = false;

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, KILL_TIMEOUT_MS);
        };
        if (signal.aborted) {
          killProc();
        } else {
          signal.addEventListener("abort", killProc, { once: true });
        }
      }

      proc.on("close", (code) => {
        if (wasAborted) {
          resolve({
            output: "",
            exitCode: code ?? 1,
            error: "Subagent was aborted",
          });
          return;
        }
        const output = extractFinalOutput(stdout);
        resolve({
          output,
          exitCode: code ?? 0,
          error: code !== 0 ? stderr.trim() || undefined : undefined,
        });
      });

      proc.on("error", (err) => {
        resolve({ output: "", exitCode: 1, error: err.message });
      });
    });
  } finally {
    if (tmpPromptPath) {
      await unlink(tmpPromptPath).catch(() => {});
    }
  }
}

export async function runParallel(
  tasks: { agent: AgentConfig | undefined; task: string; cwd?: string }[],
  defaultCwd: string,
  signal?: AbortSignal,
): Promise<SubagentResult[]> {
  if (tasks.length > MAX_PARALLEL_TASKS) {
    throw new Error(
      `Maximum ${MAX_PARALLEL_TASKS} parallel tasks allowed, got ${tasks.length}`,
    );
  }

  return mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (item) => {
    return runSingleAgent(
      item.agent,
      item.task,
      item.cwd || defaultCwd,
      signal,
    );
  });
}

export async function runChain(
  steps: { agent: AgentConfig | undefined; task: string; cwd?: string }[],
  defaultCwd: string,
  signal?: AbortSignal,
): Promise<{ finalResult: SubagentResult; allResults: SubagentResult[] }> {
  const allResults: SubagentResult[] = [];
  let previousOutput = "";

  for (const step of steps) {
    const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
    const result = await runSingleAgent(
      step.agent,
      taskWithContext,
      step.cwd || defaultCwd,
      signal,
    );
    allResults.push(result);

    if (result.exitCode !== 0) {
      return { finalResult: result, allResults };
    }

    previousOutput = result.output;
  }

  return {
    finalResult: allResults[allResults.length - 1],
    allResults,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npx tsc --noEmit`
Expected: Clean compile, no errors

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/subagent.ts
git commit -m "feat: add subagent execution engine (subagent.ts)

Implements pi CLI subprocess spawning with JSON stream parsing,
worker-pool concurrency control (max 4 concurrent, 8 total),
chain mode with {previous} placeholder, and AbortSignal handling."
```

---

### Task 3: Create tests/agents.test.ts

**Dependencies:** Runs after Task 1 completes (can run in parallel with Task 2)
**Files:**
- Create: `extensions/agentic-harness/tests/agents.test.ts`

- [ ] **Step 1: Create agents.test.ts**

```typescript
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

  it("should return empty array for non-existent directory", async () => {
    const agents = await loadAgentsFromDir("/tmp/nonexistent-dir-xyz", "user");
    expect(agents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npx vitest run tests/agents.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/tests/agents.test.ts
git commit -m "test: add agent discovery tests (parseFrontmatter, loadAgentsFromDir)"
```

---

### Task 4: Create tests/subagent.test.ts

**Dependencies:** Runs after Task 2 completes
**Files:**
- Create: `extensions/agentic-harness/tests/subagent.test.ts`

- [ ] **Step 1: Create subagent.test.ts testing helper functions**

```typescript
import { describe, it, expect } from "vitest";
import {
  extractFinalOutput,
  mapWithConcurrencyLimit,
  getPiInvocation,
  MAX_PARALLEL_TASKS,
  MAX_CONCURRENCY,
} from "../subagent.js";

describe("extractFinalOutput", () => {
  it("should extract last assistant text from JSON output", () => {
    const stdout = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "First response" }],
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final response" }],
        },
      }),
    ].join("\n");

    expect(extractFinalOutput(stdout)).toBe("Final response");
  });

  it("should return empty string when no assistant messages", () => {
    const stdout = JSON.stringify({ type: "tool_result_end", message: {} });
    expect(extractFinalOutput(stdout)).toBe("");
  });

  it("should skip non-JSON lines gracefully", () => {
    const stdout = [
      "some debug output",
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Result" }],
        },
      }),
      "another non-json line",
    ].join("\n");

    expect(extractFinalOutput(stdout)).toBe("Result");
  });

  it("should return empty string for empty input", () => {
    expect(extractFinalOutput("")).toBe("");
    expect(extractFinalOutput("\n\n")).toBe("");
  });

  it("should skip assistant messages with only whitespace text", () => {
    const stdout = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Real content" }],
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "   " }],
        },
      }),
    ].join("\n");

    expect(extractFinalOutput(stdout)).toBe("Real content");
  });
});

describe("mapWithConcurrencyLimit", () => {
  it("should process all items and return results in order", async () => {
    const results = await mapWithConcurrencyLimit(
      [1, 2, 3, 4, 5],
      3,
      async (item) => item * 2,
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("should respect concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;

    await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6], 2, async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return item;
    });

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("should handle empty array", async () => {
    const results = await mapWithConcurrencyLimit([], 4, async (item) => item);
    expect(results).toEqual([]);
  });

  it("should handle concurrency greater than items", async () => {
    const results = await mapWithConcurrencyLimit(
      [1, 2],
      10,
      async (item) => item * 3,
    );
    expect(results).toEqual([3, 6]);
  });
});

describe("getPiInvocation", () => {
  it("should return a valid invocation object", () => {
    const invocation = getPiInvocation();
    expect(invocation).toHaveProperty("command");
    expect(invocation).toHaveProperty("args");
    expect(typeof invocation.command).toBe("string");
    expect(Array.isArray(invocation.args)).toBe(true);
  });
});

describe("Constants", () => {
  it("should have correct limits", () => {
    expect(MAX_PARALLEL_TASKS).toBe(8);
    expect(MAX_CONCURRENCY).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npx vitest run tests/subagent.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/tests/subagent.test.ts
git commit -m "test: add subagent execution engine tests (extractFinalOutput, concurrency, helpers)"
```

---

### Task 5: Modify index.ts and package.json — Register Subagent Tool + Update PHASE_GUIDANCE

**Dependencies:** Runs after Task 1 and Task 2 complete
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/package.json`

- [ ] **Step 1: Add `@mariozechner/pi-ai` to package.json dependencies**

In `extensions/agentic-harness/package.json`, add `"@mariozechner/pi-ai": "latest"` to the `dependencies` object:

```json
{
  "dependencies": {
    "@mariozechner/pi-ai": "latest",
    "@mariozechner/pi-coding-agent": "latest",
    "@mariozechner/pi-tui": "latest",
    "@sinclair/typebox": "^0.32.14"
  }
}
```

- [ ] **Step 2: Add imports to index.ts**

Add the following imports at the top of `extensions/agentic-harness/index.ts`, after the existing imports:

```typescript
import { StringEnum } from "@mariozechner/pi-ai";
import { discoverAgents } from "./agents.js";
import { runSingleAgent, runParallel, runChain } from "./subagent.js";
```

The full import section becomes:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { homedir } from "os";
import { join } from "path";
import { discoverAgents } from "./agents.js";
import { runSingleAgent, runParallel, runChain } from "./subagent.js";
```

- [ ] **Step 3: Add subagent tool registration after ask_user_question registration**

Insert the following block after the `pi.registerTool({ name: "ask_user_question", ... })` closing `});` (after line 103) and before the `// resources_discover` section comment:

```typescript
  // ============================================================
  // subagent Tool
  // ============================================================
  // Delegates tasks to specialized agents running as separate
  // pi processes. Supports single, parallel, and chain modes.
  // ============================================================

  const TaskItem = Type.Object({
    agent: Type.String({
      description: "Name of the agent to invoke",
    }),
    task: Type.String({
      description: "Task to delegate to the agent",
    }),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory for the agent process",
      })
    ),
  });

  const ChainItem = Type.Object({
    agent: Type.String({
      description: "Name of the agent to invoke",
    }),
    task: Type.String({
      description:
        "Task with optional {previous} placeholder for prior step output",
    }),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory for the agent process",
      })
    ),
  });

  const SubagentParams = Type.Object({
    agent: Type.Optional(
      Type.String({
        description: "Agent name for single mode execution",
      })
    ),
    task: Type.Optional(
      Type.String({
        description: "Task description for single mode execution",
      })
    ),
    tasks: Type.Optional(
      Type.Array(TaskItem, {
        description:
          "Array of {agent, task} objects for parallel execution (max 8)",
      })
    ),
    chain: Type.Optional(
      Type.Array(ChainItem, {
        description:
          "Array of {agent, task} objects for sequential chaining. Use {previous} in task to reference prior output.",
      })
    ),
    agentScope: Type.Optional(
      StringEnum(["user", "project", "both"] as const, {
        description:
          'Which agent directories to search. "user" = ~/.pi/agent/agents/, "project" = .pi/agents/ in project root. Default: "user".',
        default: "user",
      })
    ),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory for single mode",
      })
    ),
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to specialized agents running as separate pi processes. Supports single, parallel, and chain execution modes.",
    promptSnippet:
      "Delegate tasks to specialized agents (single, parallel, or chain mode)",
    promptGuidelines: [
      "Use single mode (agent + task) for one-off investigation or exploration tasks.",
      "Use parallel mode (tasks array) to dispatch multiple independent agents concurrently, e.g. codebase reviewers.",
      "Use chain mode (chain array) for sequential pipelines where each step uses {previous} to reference prior output.",
      "Agents are .md files with YAML frontmatter (name, description, tools, model) in ~/.pi/agent/agents/ (user) or .pi/agents/ (project).",
      "If the specified agent is not found, the task runs with default pi settings.",
      "Max 8 parallel tasks with 4 concurrent. Chain mode stops on first error.",
    ],
    parameters: SubagentParams,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const { agent, task, tasks, chain, agentScope, cwd } = params;
      const defaultCwd = ctx.cwd;
      const agents = await discoverAgents(defaultCwd, agentScope || "user");
      const findAgent = (name: string) =>
        agents.find((a) => a.name === name);

      // Chain mode
      if (chain && chain.length > 0) {
        const steps = chain.map((s) => ({
          agent: findAgent(s.agent),
          task: s.task,
          cwd: s.cwd,
        }));
        const { finalResult, allResults } = await runChain(
          steps,
          defaultCwd,
          signal,
        );

        const summary = allResults
          .map(
            (r, i) =>
              `## Step ${i + 1}: ${chain[i].agent}\n**Status:** ${r.exitCode === 0 ? "Success" : "Failed"}\n\n${r.output}`,
          )
          .join("\n\n---\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: finalResult.error
                ? `Chain failed: ${finalResult.error}\n\n${summary}`
                : summary,
            },
          ],
          details: undefined,
        };
      }

      // Parallel mode
      if (tasks && tasks.length > 0) {
        const taskItems = tasks.map((t) => ({
          agent: findAgent(t.agent),
          task: t.task,
          cwd: t.cwd,
        }));
        const results = await runParallel(taskItems, defaultCwd, signal);

        const summary = results
          .map(
            (r, i) =>
              `## Agent: ${tasks[i].agent}\n**Task:** ${tasks[i].task}\n**Status:** ${r.exitCode === 0 ? "Success" : "Failed"}\n\n${r.output}`,
          )
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: summary }],
          details: undefined,
        };
      }

      // Single mode
      if (agent && task) {
        const agentConfig = findAgent(agent);
        const result = await runSingleAgent(
          agentConfig,
          task,
          cwd || defaultCwd,
          signal,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: result.error
                ? `Error: ${result.error}`
                : result.output,
            },
          ],
          details: undefined,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Specify either (agent + task) for single mode, tasks for parallel mode, or chain for chain mode.",
          },
        ],
        details: undefined,
      };
    },
  });
```

- [ ] **Step 4: Update PHASE_GUIDANCE to reference the subagent tool**

Replace the existing `PHASE_GUIDANCE` object (lines 121-150) with:

```typescript
  const PHASE_GUIDANCE: Record<WorkflowPhase, string> = {
    idle: "",
    clarifying: [
      "\n\n## Active Workflow: Clarification",
      "You are in clarification mode. Follow the clarification skill rules strictly:",
      "- Ask ONE question per message using the ask_user_question tool.",
      "- Generate questions and choices dynamically based on context — no predefined templates.",
      "- Use the subagent tool in single mode to explore the codebase in parallel with user Q&A.",
      "- After each answer, update 'what we've established so far' and assess remaining ambiguity.",
      "- When ambiguity is resolved, present a Context Brief with Complexity Assessment.",
      "- Do NOT start implementation. This phase ends with a Context Brief, not code.",
    ].join("\n"),
    planning: [
      "\n\n## Active Workflow: Plan Crafting",
      "You are in plan-crafting mode. Follow the plan-crafting skill rules strictly:",
      "- Write an executable implementation plan from the current context.",
      "- Every step must be executable — no placeholders.",
      "- Use ask_user_question if you need to resolve any remaining ambiguity.",
      "- End with a Self-Review before presenting the plan.",
    ].join("\n"),
    ultraplanning: [
      "\n\n## Active Workflow: Milestone Planning (Ultraplan)",
      "You are in milestone-planning mode. Follow the milestone-planning skill rules strictly:",
      "- Compose a Problem Brief from the current context.",
      "- Dispatch all 5 reviewer agents in parallel using the subagent tool's parallel mode.",
      "- The 5 reviewers are: Feasibility, Architecture, Risk, Dependency, and User Value analysts.",
      "- Synthesize all reviewer findings into a milestone DAG.",
      "- Use ask_user_question if you need user input on trade-offs.",
    ].join("\n"),
  };
```

- [ ] **Step 5: Update /clarify command prompt to reference subagent tool**

Replace the `prompt` variable in the `/clarify` command handler (the two `sendUserMessage` calls around lines 178-180):

For the topic case:
```typescript
      const prompt = topic
        ? `The user wants to clarify the following request: "${topic}"\n\nBegin the clarification process. Follow the clarification skill rules. Ask ONE question using the ask_user_question tool. Use the subagent tool in single mode to investigate relevant parts of the codebase in parallel.`
        : `The user wants to start a clarification session for their current task.\n\nBegin the clarification process. Follow the clarification skill rules. Ask ONE question using the ask_user_question tool to understand what the user wants to accomplish. Use the subagent tool in single mode to investigate the codebase in parallel.`;
```

- [ ] **Step 6: Update /ultraplan command prompt to reference subagent tool**

Replace the `prompt` variable in the `/ultraplan` command handler (around lines 222-224):

For the topic case:
```typescript
      const prompt = topic
        ? `Decompose the following complex task into milestones: "${topic}"\n\nFollow the milestone-planning skill rules. First compose a Problem Brief. Then dispatch all 5 reviewer agents (Feasibility, Architecture, Risk, Dependency, User Value) in parallel using the subagent tool's parallel mode. After all reviewers complete, synthesize their findings into a milestone DAG.`
        : `Decompose the current complex task into milestones.\n\nFollow the milestone-planning skill rules. First compose a Problem Brief from the current context. Then dispatch all 5 reviewer agents (Feasibility, Architecture, Risk, Dependency, User Value) in parallel using the subagent tool's parallel mode. After all reviewers complete, synthesize their findings into a milestone DAG.`;
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npx tsc --noEmit`
Expected: Clean compile, no errors

- [ ] **Step 8: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/index.ts extensions/agentic-harness/package.json
git commit -m "feat: register subagent tool and update PHASE_GUIDANCE

Register subagent tool with single/parallel/chain modes via TypeBox schema.
Update PHASE_GUIDANCE to reference subagent tool instead of non-existent
'Agent tool'. Fix ultraplan to dispatch all 5 mandatory reviewers."
```

---

### Task 6: Update tests/extension.test.ts

**Dependencies:** Runs after Task 5 completes
**Files:**
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add subagent tool registration test**

Add the following test inside the `describe("Extension Registration", ...)` block, after the existing `"should register ask_user_question tool"` test:

```typescript
  it("should register subagent tool", () => {
    const { mockPi, tools } = createMockPi();
    extension(mockPi);

    const tool = tools.get("subagent");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("subagent");
    expect(tool.promptSnippet).toBeDefined();
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines.length).toBe(6);
  });
```

- [ ] **Step 2: Add PHASE_GUIDANCE subagent reference tests**

Add a new describe block after the existing `describe("before_agent_start Event", ...)`:

```typescript
describe("PHASE_GUIDANCE subagent references", () => {
  it("should reference subagent tool in clarifying phase guidance", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    // Set phase to clarifying by running /clarify
    const commands = new Map<string, any>();
    // Re-create to capture commands
    const mockPi2: any = {
      registerTool: () => {},
      registerCommand: (name: string, def: any) => {
        commands.set(name, def);
      },
      on: (event: string, handler: any) => {
        if (!events.has(event)) events.set(event, []);
        events.get(event)!.push(handler);
      },
      sendUserMessage: () => {},
    };
    extension(mockPi2);

    // Trigger clarify to set phase
    const clarify = commands.get("clarify");
    await clarify.handler("test", {
      ui: { confirm: async () => true, setStatus: () => {} },
    });

    // Now check the before_agent_start handler
    const handlers = events.get("before_agent_start")!;
    // Use the second registration (from mockPi2)
    const result = await handlers[handlers.length - 1](
      { type: "before_agent_start", prompt: "test", systemPrompt: "base" },
      {} as any,
    );

    expect(result?.systemPrompt).toContain("subagent tool");
    expect(result?.systemPrompt).not.toContain("Explore subagents");
  });
});
```

- [ ] **Step 3: Update /clarify delegation test to check for subagent reference**

Replace the existing `/clarify Command` describe block's assertion about the prompt content:

```typescript
describe("/clarify Command", () => {
  it("should delegate to agent via sendUserMessage with subagent reference", async () => {
    const { mockPi, commands } = createMockPi();
    extension(mockPi);

    const clarify = commands.get("clarify");
    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    };

    await clarify.handler("login feature", mockCtx);

    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("login feature");
    expect(prompt).toContain("clarification");
    expect(prompt).toContain("ask_user_question");
    expect(prompt).toContain("subagent");
  });
});
```

- [ ] **Step 4: Update /ultraplan test to check for reviewer and subagent references**

In `tests/ultraplan.test.ts`, update the prompt assertion in the first test:

```typescript
    // Should delegate to agent via sendUserMessage
    expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(prompt).toContain("milestone-planning");
    expect(prompt).toContain("reviewer");
    expect(prompt).toContain("subagent");
    expect(prompt).toContain("Feasibility");
```

- [ ] **Step 5: Run all tests**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git add extensions/agentic-harness/tests/extension.test.ts extensions/agentic-harness/tests/ultraplan.test.ts
git commit -m "test: update tests for subagent tool registration and PHASE_GUIDANCE changes"
```

---

### Task 7 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npm test`
Expected: ALL PASS (existing 12 tests + new tests)

- [ ] **Step 2: TypeScript compile check**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npx tsc --noEmit`
Expected: Clean compile, no type errors

- [ ] **Step 3: Verify no hardcoded "Agent tool" or "Explore subagent" references remain**

Run: `grep -rn "Explore subagent\|Agent tool\|subagent_type" extensions/agentic-harness/index.ts`
Expected: No matches (all references should now use "subagent tool")

- [ ] **Step 4: Verify subagent tool is properly registered**

Run: `grep -n "registerTool" extensions/agentic-harness/index.ts`
Expected: Two registerTool calls — `ask_user_question` and `subagent`

- [ ] **Step 5: Verify PHASE_GUIDANCE references all 5 reviewers**

Run: `grep -n "Feasibility\|Architecture\|Risk\|Dependency\|User Value" extensions/agentic-harness/index.ts`
Expected: All 5 reviewer names present in the ultraplanning guidance

- [ ] **Step 6: Verify plan success criteria**

Manually check:
- [ ] `subagent` tool registered with TypeBox schema supporting single/parallel/chain modes
- [ ] `agents.ts` discovers agents from `~/.pi/agent/agents/` and `.pi/agents/`
- [ ] `subagent.ts` spawns `pi --mode json -p --no-session` subprocesses
- [ ] Parallel execution uses worker-pool with max concurrency 4, max tasks 8
- [ ] Chain mode replaces `{previous}` with prior step output
- [ ] AbortSignal handling with SIGTERM → SIGKILL
- [ ] PHASE_GUIDANCE references `subagent tool` (not "Agent tool" or "Explore subagents")
- [ ] Ultraplan guidance specifies all 5 mandatory reviewers
- [ ] All tests pass, TypeScript compiles clean

- [ ] **Step 7: Run full test suite for regressions**

Run: `cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npm test`
Expected: No regressions — all pre-existing tests still pass
