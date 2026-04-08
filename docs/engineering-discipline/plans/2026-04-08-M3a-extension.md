# Plan: M3a — Extension Entry — Tools + Commands

## Context Brief

**Goal:** Implement the pi extension entry points: 5 GitHub tools and `/autonomous-dev` slash command.

**Success Criteria:**
- `extensions/autonomous-dev/index.ts` registers 5 tools: gh_issue_list, gh_issue_read, gh_issue_comment, gh_label, gh_pr_create
- Each tool has TypeBox schema with proper parameters
- `/autonomous-dev` command handles subcommands: start, stop, status
- Extension loads without errors
- `pi.on("session_shutdown")` gracefully stops orchestrator

**Files to create:**
- `extensions/autonomous-dev/index.ts`
- `extensions/autonomous-dev/package.json`

**Dependencies (from completed milestones):**
- M1: `types.ts` (AUTONOMOUS_LABELS, WorkerResult), `github.ts` (all gh wrappers)
- M2: `orchestrator.ts` (AutonomousDevOrchestrator)

**Constraints:**
- Worker spawner is stubbed (wires to `stubWorkerSpawn` for now)
- Real agent integration comes in M4

---

## Task 1: Create extensions/autonomous-dev/index.ts

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { AutonomousDevOrchestrator } from "./orchestrator.js";
import {
  listIssuesByLabel,
  getIssueWithComments,
  postComment,
  addLabels,
  swapLabels,
  createPullRequest,
  detectRepo,
} from "./github.js";
import { AUTONOMOUS_LABELS } from "./types.js";

// Global orchestrator instance
let orchestrator: AutonomousDevOrchestrator | null = null;

function getOrchestrator(): AutonomousDevOrchestrator {
  if (!orchestrator) {
    orchestrator = new AutonomousDevOrchestrator({
      repo: "",
      pollIntervalMs: 60_000,
      maxClarificationRounds: 3,
    });
    // Stubbed worker for now
    orchestrator.setWorkerSpawner(async (_issueNumber, _config) => ({
      status: "completed",
      prUrl: "https://example.com/pr/1",
      summary: "Stub implementation",
    }));
  }
  return orchestrator;
}

export default function (pi: ExtensionAPI) {
  // --- GitHub Tools ---

  pi.registerTool({
    name: "gh_issue_list",
    label: "List GitHub Issues",
    description: "List issues with optional label filter",
    parameters: Type.Object({
      repo: Type.String({ description: "Repository in owner/repo format" }),
      label: Type.Optional(Type.String({ description: "Filter by label" })),
      state: Type.Optional(Type.Union([
        Type.Literal("open"),
        Type.Literal("closed"),
        Type.Literal("all"),
      ], { description: "Issue state", default: "open" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const issues = await listIssuesByLabel(
          params.repo,
          params.label || "open",
          []
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${issues.length} issues:\n\n${issues.map(
                (i) => `#${i.number}: ${i.title} (@${i.author})`
              ).join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
        };
      }
    },
  });

  pi.registerTool({
    name: "gh_issue_read",
    label: "Read GitHub Issue",
    description: "Read an issue with all comments",
    parameters: Type.Object({
      repo: Type.String({ description: "Repository in owner/repo format" }),
      issueNumber: Type.Number({ description: "Issue number" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const ctx = await getIssueWithComments(params.repo, params.issueNumber);
        const lines = [
          `#${ctx.issue.number}: ${ctx.issue.title}`,
          `Author: @${ctx.issue.author}`,
          `Labels: ${ctx.issue.labels.join(", ") || "none"}`,
          "",
          "---",
          "**Description:**",
          ctx.issue.body || "_No description_",
          "",
          "**Comments:**",
          ...ctx.comments.map(
            (c) => `- @${c.author} (${c.createdAt}): ${c.body}`
          ),
        ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
        };
      }
    },
  });

  pi.registerTool({
    name: "gh_issue_comment",
    label: "Comment on GitHub Issue",
    description: "Post a comment on an issue",
    parameters: Type.Object({
      repo: Type.String({ description: "Repository in owner/repo format" }),
      issueNumber: Type.Number({ description: "Issue number" }),
      body: Type.String({ description: "Comment text" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        await postComment(params.repo, params.issueNumber, params.body);
        return {
          content: [{ type: "text", text: "Comment posted successfully" }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
        };
      }
    },
  });

  pi.registerTool({
    name: "gh_label",
    label: "Manage GitHub Labels",
    description: "Add or remove labels from an issue",
    parameters: Type.Object({
      repo: Type.String({ description: "Repository in owner/repo format" }),
      issueNumber: Type.Number({ description: "Issue number" }),
      add: Type.Optional(Type.Array(Type.String(), { description: "Labels to add" })),
      remove: Type.Optional(Type.Array(Type.String(), { description: "Labels to remove" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        if (params.add?.length) {
          await addLabels(params.repo, params.issueNumber, params.add);
        }
        if (params.remove?.length) {
          await swapLabels(params.repo, params.issueNumber, params.remove, []);
        }
        return {
          content: [{ type: "text", text: "Labels updated successfully" }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
        };
      }
    },
  });

  pi.registerTool({
    name: "gh_pr_create",
    label: "Create GitHub PR",
    description: "Create a pull request",
    parameters: Type.Object({
      repo: Type.String({ description: "Repository in owner/repo format" }),
      title: Type.String({ description: "PR title" }),
      body: Type.String({ description: "PR body" }),
      head: Type.String({ description: "Head branch" }),
      base: Type.Optional(Type.String({ description: "Base branch", default: "main" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const url = await createPullRequest(
          params.repo,
          params.title,
          params.body,
          params.head,
          params.base
        );
        return {
          content: [{ type: "text", text: `PR created: ${url}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
        };
      }
    },
  });

  // --- /autonomous-dev Command ---

  pi.registerCommand({
    name: "autonomous-dev",
    description: "Manage autonomous issue processing",
    execute: async (args: string[], ctx) => {
      const orch = getOrchestrator();
      const subcommand = args[0]?.toLowerCase();

      switch (subcommand) {
        case "start": {
          const repo = args[1] || orch.getStatus().repo || await detectRepo();
          if (!repo) {
            return "Error: No repo specified. Usage: /autonomous-dev start owner/repo";
          }
          orch.stop();
          // Create new orchestrator with the specified repo
          orchestrator = new AutonomousDevOrchestrator({
            repo,
            pollIntervalMs: 60_000,
            maxClarificationRounds: 3,
          });
          // Keep the same worker spawner if set
          orchestrator.setWorkerSpawner((orch as any).workerSpawner || (async () => ({
            status: "completed",
            prUrl: "https://example.com/pr/1",
            summary: "Stub",
          })));
          orchestrator.start();
          return `Started autonomous dev engine for ${repo}`;
        }

        case "stop": {
          orch.stop();
          return "Stopped autonomous dev engine";
        }

        case "status": {
          const status = orch.getStatus();
          const lines = [
            `Status: ${status.isRunning ? "Running" : "Not running"}`,
            `Repo: ${status.repo || "(not set)"}`,
            `Poll interval: ${status.pollIntervalMs}ms`,
            `Tracked issues: ${status.trackedIssues.length}`,
            "",
            "Stats:",
            `  Processed: ${status.stats.totalProcessed}`,
            `  Completed: ${status.stats.totalCompleted}`,
            `  Failed: ${status.stats.totalFailed}`,
            `  Clarifications asked: ${status.stats.totalClarificationAsked}`,
          ];
          return lines.join("\n");
        }

        case "poll": {
          await orch.pollCycle();
          return "Poll cycle completed";
        }

        default:
          return `Unknown subcommand: ${subcommand}

Usage:
  /autonomous-dev start [repo]  - Start the engine (uses current dir repo if not specified)
  /autonomous-dev stop          - Stop the engine
  /autonomous-dev status        - Show current status
  /autonomous-dev poll          - Trigger one poll cycle

Available labels:
  ${Object.values(AUTONOMOUS_LABELS).join("\n  ")}
`;
      }
    },
  });

  // --- Session lifecycle ---

  pi.on("session_shutdown", () => {
    if (orchestrator) {
      orchestrator.stop();
      orchestrator = null;
    }
  });
}
```

---

## Task 2: Create extensions/autonomous-dev/package.json

```json
{
  "name": "pi-autonomous-dev",
  "version": "0.0.1",
  "description": "Autonomous GitHub issue processing engine",
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@sinclair/typebox": "^0.32.14"
  }
}
```

---

## Verification

- [ ] `extensions/autonomous-dev/index.ts` registers 5 tools
- [ ] `/autonomous-dev` command handles start/stop/status/poll
- [ ] Extension loads without errors
