import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashTool, isToolCallEventType, keyHint, keyText, rawKeyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { RoachFooter, type CacheStats, type ActiveTools } from "./footer.js";
import { homedir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { discoverAgents } from "./agents.js";
import { runAgent, mapWithConcurrencyLimit, MAX_CONCURRENCY, MAX_PARALLEL_TASKS, resolveDepthConfig, getCycleViolations } from "./subagent.js";
import { emptyUsage, isResultError, isResultSuccess, getResultSummaryText, type SingleResult, type SubagentDetails } from "./types.js";
import { renderCall, renderResult } from "./render.js";
import { parsePlan } from "./plan-parser.js";
import { buildValidatorPrompt } from "./validator-template.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { microcompactMessages, getCompactionPrompt, formatCompactSummary } from "./compaction.js";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import { isDisciplineAgent, augmentAgentWithKarpathy, getSlopCleanerTask } from "./discipline.js";
import { fetchUrlToMarkdown } from "./webfetch/utils.js";
import { PI_TEAM_WORKER_ENV, formatTeamRunSummary, runTeam, type TeamRunSummary } from "./team.js";
import { defaultTeamRunStateRoot, listTeamRuns, readTeamRunRecord, writeTeamRunRecord } from "./team-state.js";
import { buildTeamCommandPrompt, getTeamArgumentCompletions, isTeamFollowUpCommand, parseTeamArgs } from "./team-command.js";
import { renderWebfetchCall, renderWebfetchResult } from "./webfetch/render.js";
import { getDefaultApprovalStore } from "./sandbox/approval-store.js";
import { parseSandboxApprovalMode } from "./sandbox/approval-mode.js";
import { createSandboxedBashOperations } from "./sandbox/bash-operations.js";
import { resolvePiAgentDir } from "./sandbox/agent-dir.js";
import { makePolicyFingerprint } from "./sandbox/policy-engine.js";
import { isSensitiveEnvPath } from "./sandbox/sensitive-env.js";

type WorkflowPhase =
  | "idle"
  | "clarifying"
  | "planning"
  | "ultraplanning"
  | "reviewing"
  | "ultrareviewing";

let currentPhase: WorkflowPhase = "idle";
let activeGoalDocument: string | null = null;

const cacheStats: CacheStats = { totalInput: 0, totalCacheRead: 0 };

const activeTools: ActiveTools = { running: new Map() };

export default function (pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const BUNDLED_AGENTS_DIR = join(__dirname, "agents");
  const BUNDLED_SKILLS_DIR = join(__dirname, "skills");
  const agentDir = resolvePiAgentDir();

  const DIRECT_INPUT_OPTION = "Enter custom response";

  const depthConfig = resolveDepthConfig();
  const isRootSession = depthConfig.currentDepth === 0;
  const isTeamWorker = process.env[PI_TEAM_WORKER_ENV] === "1";
  const parsedApprovalMode = parseSandboxApprovalMode(process.env.PI_SANDBOX_APPROVAL_MODE);
  let warnedInvalidApprovalMode = false;
  let announcedAlwaysApprovalMode = false;
  const approvalStore = getDefaultApprovalStore();

  if (isRootSession) {
    const createRootApprovalResolver = (ctx?: { hasUI?: boolean; ui?: { select?: (message: string, choices: string[]) => Promise<string | undefined> } }) => {
      const hasUI = ctx?.hasUI !== false && !!ctx?.ui?.select;
      return async (request: { reason: string; command: string; args: string[] }) => {
        if (parsedApprovalMode.mode === "always") return { approved: true, scope: "session" as const };
        if (parsedApprovalMode.mode === "deny") return { approved: false };
        if (!hasUI) return { approved: false };
        const message = [
          "Sandbox escalation required to run unsandboxed.",
          `Reason: ${request.reason}`,
          `Command: ${request.command} ${request.args.join(" ")}`.trim(),
        ].join("\n");
        const choice = await ctx.ui!.select!(message, ["Deny", "Allow once", "Allow for session", "Always allow"]);
        if (choice === "Allow once") return { approved: true, scope: "once" as const };
        if (choice === "Allow for session") return { approved: true, scope: "session" as const };
        if (choice === "Always allow") return { approved: true, scope: "always" as const };
        return { approved: false };
      };
    };

    const createRootSandbox = (
      ctx?: { hasUI?: boolean; ui?: { select?: (message: string, choices: string[]) => Promise<string | undefined> } },
      requireApprovalForAllCommands = true,
    ) => ({
      enabled: true,
      workspaceRoot: process.cwd(),
      networkMode: "on" as const,
      additionalWritableRoots: [agentDir],
      approvalMode: parsedApprovalMode.mode,
      approvalResolver: createRootApprovalResolver(ctx),
      requireApprovalForAllCommands,
    });

    const sandboxedBashOperations = createSandboxedBashOperations(createRootSandbox());
    const localBash = createBashTool(process.cwd(), { operations: sandboxedBashOperations });
    pi.registerTool({
      ...localBash,
      label: "bash (sandboxed)",
    });
    pi.on("user_bash", (_event, ctx) => ({
      operations: createSandboxedBashOperations(createRootSandbox(ctx as any, true)),
    }));
  }

  const AskUserQuestionParams = Type.Object({
    question: Type.String({
      description: "The question to ask the user. The agent generates this dynamically based on context.",
    }),
    choices: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Multiple choice options generated by the agent. 'Enter custom response' is auto-appended. Omit for free-text input.",
      })
    ),
    placeholder: Type.Optional(
      Type.String({
        description: "Placeholder hint for free-text input mode.",
      })
    ),
    defaultValue: Type.Optional(
      Type.String({
        description: "Default value if user presses Enter without typing.",
      })
    ),
  });

  // ask_user_question is only available to the root session. Subagent
  // processes must not be able to call it — otherwise a subagent ends up
  // asking itself questions and answering them, since subagents run
  // non-interactively and have no user at the other end.
  if (isRootSession) {
    pi.registerTool({
      name: "ask_user_question",
      label: "Ask User Question",
      description:
        "Ask the user a question when the agent needs clarification. The agent composes the question and optional choices dynamically. Returns the user's answer as text.",
      promptSnippet:
        "Ask the user a clarifying question with optional multiple-choice answers",
      promptGuidelines: [
        "Use ask_user_question whenever you encounter ambiguity, unclear scope, or need user preference.",
        "Generate the question and choices yourself based on the current context — do not rely on predefined templates.",
        "Offer concrete choices (A/B/C style) when the options are enumerable. Omit choices for open-ended questions.",
        "Ask one focused question at a time. Do not bundle multiple questions.",
        "After receiving an answer, decide whether further clarification is needed or proceed with the task.",
      ],
      parameters: AskUserQuestionParams,
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        const { question, choices, placeholder, defaultValue } = params;

        let answer: string | undefined;

        if (choices && choices.length > 0) {
          const withDirect = choices.includes(DIRECT_INPUT_OPTION)
            ? choices
            : [...choices, DIRECT_INPUT_OPTION];

          answer = await ctx.ui.select(question, withDirect, { signal });

          if (answer === DIRECT_INPUT_OPTION) {
            answer = await ctx.ui.input(question, placeholder || defaultValue, {
              signal,
            });
          }
        } else {
          answer = await ctx.ui.input(question, placeholder || defaultValue, {
            signal,
          });
        }

        if (answer === undefined) {
          return {
            content: [{ type: "text", text: "User cancelled the question." }],
            details: undefined,
          };
        }

        return {
          content: [{ type: "text", text: answer }],
          details: undefined,
        };
      },
    });
  }

  const HEARTBEAT_MS = 1000;

  const TaskItem = Type.Object({
    agent: Type.String({ description: "Name of the agent to invoke" }),
    task: Type.String({ description: "Task to delegate to the agent" }),
    cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
    output: Type.Optional(Type.String({ description: "Artifact-relative file path where the subagent should write its final output" })),
    reads: Type.Optional(Type.Array(Type.String(), { description: "Files to include as declared read context for the subagent" })),
    progress: Type.Optional(Type.String({ description: "Artifact-relative file path for progress notes" })),
  });

  const ChainItem = Type.Object({
    agent: Type.String({ description: "Name of the agent to invoke" }),
    task: Type.String({ description: "Task with optional {previous} placeholder for prior step output" }),
    cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
    output: Type.Optional(Type.String({ description: "Artifact-relative file path where the subagent should write its final output" })),
    reads: Type.Optional(Type.Array(Type.String(), { description: "Files to include as declared read context for the subagent" })),
    progress: Type.Optional(Type.String({ description: "Artifact-relative file path for progress notes" })),
  });

  const SubagentParams = Type.Object({
    agent: Type.Optional(Type.String({ description: "Agent name for single mode execution" })),
    task: Type.Optional(Type.String({ description: "Task description for single mode execution" })),
    tasks: Type.Optional(Type.Array(TaskItem, { description: `Array of {agent, task} objects for parallel execution (max ${MAX_PARALLEL_TASKS})` })),
    chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} objects for sequential chaining. Use {previous} in task to reference prior output." })),
    agentScope: Type.Optional(Type.Unsafe<"user" | "project" | "both">({
      type: "string", enum: ["user", "project", "both"],
      description: 'Which agent directories to search. Default: "user".',
      default: "user",
    })),
    cwd: Type.Optional(Type.String({ description: "Working directory for single mode" })),
    maxOutput: Type.Optional(Type.Number({ description: "Maximum characters of model-facing subagent output to return. Adds truncation metadata when applied." })),
    output: Type.Optional(Type.String({ description: "Artifact-relative file path where the subagent should write its final output" })),
    reads: Type.Optional(Type.Array(Type.String(), { description: "Files to include as declared read context for the subagent" })),
    progress: Type.Optional(Type.String({ description: "Artifact-relative file path for progress notes" })),
    context: Type.Optional(Type.Unsafe<"fresh" | "fork">({ type: "string", enum: ["fresh", "fork"], description: "Session context mode. fresh preserves --no-session; fork requires PI_SUBAGENT_FORK_SESSION and fails fast if unavailable." })),
    worktree: Type.Optional(Type.Boolean({ description: "Run parallel tasks in isolated git worktrees and capture per-task diffs." })),
    planFile: Type.Optional(Type.String({ description: "Path to plan file. Required when agent is plan-validator — the validator prompt is built from this file, not from the task field." })),
    planTaskId: Type.Optional(Type.Number({ description: "Task number in the plan file to validate (e.g. 1 for Task 1). Required when agent is plan-validator." })),
  });

  const makeDetails = (mode: "single" | "parallel") => (results: SingleResult[]): SubagentDetails => ({ mode, results });

  const TeamParams = Type.Object({
    goal: Type.Optional(Type.String({ description: "Goal for the lightweight native team run. Omit only in follow-up command mode." })),
    workerCount: Type.Optional(Type.Number({ description: `Number of workers to dispatch (max ${MAX_PARALLEL_TASKS})` })),
    agent: Type.Optional(Type.String({ description: "Worker agent name. Default: worker" })),
    agentScope: Type.Optional(Type.Unsafe<"user" | "project" | "both">({
      type: "string", enum: ["user", "project", "both"],
      description: 'Which agent directories to search. Default: "user".',
      default: "user",
    })),
    worktree: Type.Optional(Type.Boolean({ description: "Run team workers in isolated git worktrees" })),
    worktreePolicy: Type.Optional(Type.Unsafe<"off" | "on" | "auto">({
      type: "string",
      enum: ["off", "on", "auto"],
      description: "Worktree isolation policy. Defaults to the legacy worktree boolean behavior.",
    })),
    backend: Type.Optional(Type.Unsafe<"auto" | "native" | "tmux">({
      type: "string",
      enum: ["auto", "native", "tmux"],
      description: "Execution backend selection for team workers. auto prefers tmux when available.",
    })),
    maxOutput: Type.Optional(Type.Number({ description: "Maximum characters of model-facing worker output to retain" })),
    runId: Type.Optional(Type.String({ description: "Optional durable team run id for persisted state" })),
    resumeRunId: Type.Optional(Type.String({ description: "Resume a previously persisted team run id" })),
    resumeMode: Type.Optional(Type.Unsafe<"mark-interrupted" | "retry-stale">({
      type: "string",
      enum: ["mark-interrupted", "retry-stale"],
      description: "How to handle stale in-progress tasks when resuming.",
    })),
    staleTaskMs: Type.Optional(Type.Number({ description: "Age in milliseconds before in-progress resume tasks are stale" })),
    commandTarget: Type.Optional(Type.String({ description: "Follow-up mode target worker owner or task id for an existing resumed run" })),
    commandMessage: Type.Optional(Type.String({ description: "Follow-up mode command message to enqueue for the target" })),
  });

  if (isRootSession && !isTeamWorker) {
    pi.registerTool({
      name: "team",
      label: "Team",
      description: "Run a lightweight native team over existing pi subagents with structured task synthesis.",
      promptSnippet: "Coordinate a small team of bounded pi worker agents",
      promptGuidelines: [
        "Use team for coordinated multi-agent execution when a goal can be split into independent bounded tasks.",
        "Prefer small worker counts for the MVP; max parallel tasks is 12 with 10 concurrent.",
        "Workers must not recursively orchestrate or spawn subagents.",
        "Use subagent directly for simple one-off parallel dispatch without team synthesis.",
      ],
      parameters: TeamParams,
      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded }, theme) => renderResult(result, expanded, theme),
      execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
        const { goal, workerCount, agent, agentScope, worktree, worktreePolicy, backend, maxOutput, runId, resumeRunId, resumeMode, staleTaskMs, commandTarget, commandMessage } = params;
        const defaultCwd = ctx.cwd;
        const teamRunStateRoot = defaultTeamRunStateRoot(defaultCwd);
        const hasUI = (ctx as any).hasUI !== false && !!ctx?.ui?.select;
        const agents = await discoverAgents(defaultCwd, agentScope || "user", BUNDLED_AGENTS_DIR);
        const findAgent = (name: string) => agents.find((a) => a.name === name);
        const approvalResolver = async (request: { reason: string; command: string; args: string[]; cwd: string }) => {
          if (parsedApprovalMode.mode === "always") return { approved: true, scope: "session" as const };
          if (parsedApprovalMode.mode === "deny") return { approved: false };
          if (!hasUI) return { approved: false };
          const message = [
            "Sandbox escalation required to run unsandboxed.",
            `Reason: ${request.reason}`,
            `Command: ${request.command} ${request.args.join(" ")}`.trim(),
          ].join("\n");
          const choice = await ctx.ui.select(message, ["Deny", "Allow once", "Allow for session", "Always allow"], { signal });
          if (choice === "Allow once") return { approved: true, scope: "once" as const };
          if (choice === "Allow for session") return { approved: true, scope: "session" as const };
          if (choice === "Always allow") return { approved: true, scope: "always" as const };
          return { approved: false };
        };
        const sandboxFor = (runCwd: string) => ({
          enabled: true,
          workspaceRoot: defaultCwd,
          networkMode: "on" as const,
          additionalWritableRoots: [agentDir, runCwd],
          approvalMode: parsedApprovalMode.mode,
          approvalResolver,
          approvalStore,
          requireApprovalForAllCommands: true,
        });
        const indicatorSupported = hasUI && typeof ctx?.ui?.setWorkingIndicator === "function";
        if (indicatorSupported) ctx.ui.setWorkingIndicator({ frames: [] });
        let summary: TeamRunSummary;
        try {
          summary = await runTeam({ goal, workerCount, agent, worktree, worktreePolicy, backend, maxOutput, runId, resumeRunId, resumeMode, staleTaskMs, commandTarget, commandMessage }, {
          findAgent,
          summarizeResult: getResultSummaryText,
          persistRun: async (record) => {
            await writeTeamRunRecord(record, teamRunStateRoot);
          },
          loadRun: (id) => readTeamRunRecord(id, teamRunStateRoot),
          emitProgress: (partial) => {
            const sessionName = partial.tasks.find((task) => task.terminal?.backend === "tmux" && task.terminal.sessionName)?.terminal?.sessionName;
            const backendTag = partial.backendUsed === "tmux"
              ? `[tmux: ${sessionName ?? "?"}]`
              : "[native]";
            onUpdate?.({
              content: [{ type: "text" as const, text: `Team ${backendTag}: ${partial.completedCount}/${partial.taskCount} completed, ${partial.failedCount} failed...` }],
              details: makeDetails("parallel")([]),
            });
          },
          emitBackendResolved: (info) => {
            if (!hasUI) return;
            if (info.requested === "auto" && info.used === "native") {
              ctx.ui.notify(
                "Tmux not detected — running team workers natively. Set backend=tmux to require tmux.",
                "info",
              );
            }
          },
          emitTmuxReady: (info) => {
            if (!hasUI) return;
            ctx.ui.notify(
              info.attachedToCurrentClient
                ? [
                  `Tmux team panes ready (${info.paneCount} workers).`,
                  "Opened worker panes in the current tmux window.",
                  `Per-worker logs: ${info.logDir}/task-N.log`,
                ].join("\n")
                : [
                  `Tmux team session ready (${info.paneCount} workers).`,
                  `Attach in another terminal:  ${info.attachCommand}`,
                  `Per-worker logs: ${info.logDir}/task-N.log`,
                ].join("\n"),
              "info",
            );
            ctx.ui.setStatus?.("harness", info.attachedToCurrentClient ? "Team running — current tmux window" : `Team running — ${info.attachCommand}`);
          },
          runTask: (input) => runAgent({
            agent: input.agent ? { ...input.agent, maxSubagentDepth: 1 } : undefined,
            agentName: input.agentName,
            task: input.prompt,
            cwd: defaultCwd,
            depthConfig,
            signal,
            sandbox: sandboxFor(defaultCwd),
            onUpdate,
            makeDetails: makeDetails("parallel"),
            maxOutput: input.maxOutput,
            contextMode: "fresh",
            worktree: input.worktree,
            executionMode: input.task.terminal?.backend === "tmux" ? "tmux" : "native",
            tmuxPane: input.task.terminal?.backend === "tmux" ? {
              sessionName: input.task.terminal.sessionName!,
              windowName: input.task.terminal.windowName!,
              paneId: input.task.terminal.paneId!,
              logFile: input.task.terminal.logFile!,
              eventLogFile: input.task.terminal.eventLogFile,
              attachCommand: input.task.terminal.attachCommand!,
              tmuxBinary: input.task.terminal.tmuxBinary,
              sessionAttempt: input.task.terminal.sessionAttempt,
            } : undefined,
            extraEnv: input.extraEnv,
          }),
        });
        } finally {
          if (indicatorSupported) ctx.ui.setWorkingIndicator();
        }
        return {
          content: [{ type: "text" as const, text: formatTeamRunSummary(summary) }],
          details: makeDetails("parallel")([]),
          isError: !summary.success,
          terminate: summary.success,
        };
      },
    });
  }

  if (depthConfig.canDelegate && !isTeamWorker) {
    pi.registerTool({
      name: "subagent",
      label: "Subagent",
      description:
        "Delegate tasks to specialized agents running as separate pi processes. Supports single, parallel, and chain execution modes.",
      promptSnippet:
        "Delegate tasks to specialized agents (single, parallel, or chain mode)",
      promptGuidelines: [
        "Use single mode (agent + task) for one-off tasks. Use parallel mode (tasks array) for concurrent dispatch. Use chain mode (chain array) for sequential pipelines with {previous} placeholder.",
        "ONLY use these exact agent names — do NOT invent or guess agent names: explorer, worker, planner, plan-worker, plan-validator, plan-compliance, reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value, reviewer-bug, reviewer-security, reviewer-performance, reviewer-test-coverage, reviewer-consistency, reviewer-verifier, review-synthesis.",
        "All agents use the default model. Do NOT specify or mention specific models (no Haiku, Sonnet, etc.).",
        "For codebase exploration: use 'explorer'. For general execution: use 'worker'. For plan execution: use 'plan-compliance' → 'plan-worker' → 'plan-validator'.",
        "For ultraplan milestone reviews: dispatch all 5 reviewers in parallel: reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value.",
        "For ultrareview code reviews: dispatch 10 tasks in parallel (5 reviewers × 2 seeds): reviewer-bug, reviewer-security, reviewer-performance, reviewer-test-coverage, reviewer-consistency. Then run reviewer-verifier on the aggregated findings, then review-synthesis on the verified result.",
        "Max 12 parallel tasks with 10 concurrent. Chain mode stops on first error.",
        "When calling plan-validator, ALWAYS provide planFile (path to the plan .md file) and planTaskId (the task number to validate). The validator prompt will be built from the plan file automatically — you do not need to compose it. Example: { agent: 'plan-validator', task: 'validate', planFile: 'docs/.../plan.md', planTaskId: 3 }",
      ],
      parameters: SubagentParams,

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded }, theme) => renderResult(result, expanded, theme),

      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        const { agent, task, tasks, chain, agentScope, cwd, maxOutput, output, reads, progress, context, worktree } = params;
        const hasUI = (ctx as any).hasUI !== false && !!ctx?.ui?.select;
        if (parsedApprovalMode.invalidRawValue && !warnedInvalidApprovalMode) {
          warnedInvalidApprovalMode = true;
          const message = `[agentic-harness] Invalid PI_SANDBOX_APPROVAL_MODE="${parsedApprovalMode.invalidRawValue}". Falling back to "ask".`;
          if (hasUI && ctx?.ui?.notify) ctx.ui.notify(message, "warning");
          else console.warn(message);
        }
        if (parsedApprovalMode.mode === "always" && !announcedAlwaysApprovalMode) {
          announcedAlwaysApprovalMode = true;
          const message = "[agentic-harness] Sandbox approval mode is \"always\" (YOLO). Unsandboxed fallback approvals are auto-allowed.";
          if (hasUI && ctx?.ui?.notify) ctx.ui.notify(message, "warning");
          else console.warn(message);
        }
        const defaultCwd = ctx.cwd;
        const agents = await discoverAgents(defaultCwd, agentScope || "user", BUNDLED_AGENTS_DIR);
        const findAgent = (name: string) => agents.find((a) => a.name === name);
        const approvalResolver = async (request: { reason: string; command: string; args: string[]; cwd: string }) => {
          if (parsedApprovalMode.mode === "always") return { approved: true, scope: "session" as const };
          if (parsedApprovalMode.mode === "deny") return { approved: false };
          if (!hasUI) return { approved: false };
          const message = [
            "Sandbox escalation required to run unsandboxed.",
            `Reason: ${request.reason}`,
            `Command: ${request.command} ${request.args.join(" ")}`.trim(),
          ].join("\n");
          const choice = await ctx.ui.select(
            message,
            ["Deny", "Allow once", "Allow for session", "Always allow"],
            { signal },
          );
          if (choice === "Allow once") return { approved: true, scope: "once" as const };
          if (choice === "Allow for session") return { approved: true, scope: "session" as const };
          if (choice === "Always allow") return { approved: true, scope: "always" as const };
          return { approved: false };
        };
        const sandboxFor = (runCwd: string) => ({
          enabled: true,
          workspaceRoot: defaultCwd,
          // Subagents must reach model/provider endpoints and update local
          // session lock/state files under PI_CODING_AGENT_DIR (default: ~/.pi/agent).
          networkMode: "on" as const,
          additionalWritableRoots: [agentDir, runCwd],
          approvalMode: parsedApprovalMode.mode,
          approvalResolver,
          approvalStore,
          requireApprovalForAllCommands: true,
        });

        // Safety: cycle detection
        if (depthConfig.preventCycles) {
          const requested: string[] = [];
          if (agent) requested.push(agent);
          if (tasks) for (const t of tasks) requested.push(t.agent);
          if (chain) for (const s of chain) requested.push(s.agent);
          const violations = getCycleViolations(requested, depthConfig.ancestorStack);
          if (violations.length > 0) {
            return {
              content: [{ type: "text" as const, text: `Blocked: delegation cycle detected. Agents already in stack: ${violations.join(", ")}. Stack: ${depthConfig.ancestorStack.join(" -> ") || "(root)"}` }],
              details: makeDetails("single")([]),
              isError: true,
            };
          }
        }

        if (chain && chain.length > 0) {
          let previousOutput = "";
          const allResults: SingleResult[] = [];

          for (let i = 0; i < chain.length; i++) {
            const step = chain[i];
            const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
            const chainAgent = isDisciplineAgent(step.agent)
              ? augmentAgentWithKarpathy(findAgent(step.agent))
              : findAgent(step.agent);
            const result = await runAgent({
              agent: chainAgent,
              agentName: step.agent,
              task: taskWithContext,
              cwd: step.cwd || defaultCwd,
              depthConfig,
              signal,
              onUpdate,
              sandbox: sandboxFor(step.cwd || defaultCwd),
              makeDetails: makeDetails("single"),
              maxOutput,
              output: step.output,
              reads: step.reads,
              progress: step.progress,
              contextMode: context,
            });
            allResults.push(result);

            if (isResultError(result)) {
              const summary = allResults.map((r, j) => `[${chain[j].agent}] ${isResultError(r) ? "failed" : "completed"}: ${getResultSummaryText(r, maxOutput)}`).join("\n\n");
              return {
                content: [{ type: "text" as const, text: `Chain failed at step ${i + 1}: ${result.errorMessage || "error"}\n\n${summary}` }],
                details: makeDetails("single")(allResults),
              };
            }
            previousOutput = getResultSummaryText(result, maxOutput);
          }

          const summary = allResults.map((r, i) => `[${chain[i].agent}] completed: ${getResultSummaryText(r, maxOutput)}`).join("\n\n");
          return {
            content: [{ type: "text" as const, text: summary }],
            details: makeDetails("single")(allResults),
          };
        }

        if (tasks && tasks.length > 0) {
          if (tasks.length > MAX_PARALLEL_TASKS) {
            return {
              content: [{ type: "text" as const, text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
              details: makeDetails("parallel")([]),
            };
          }

          const allResults: SingleResult[] = tasks.map((t) => ({
            agent: t.agent, agentSource: "unknown" as const, task: t.task,
            exitCode: -1, messages: [], stderr: "", usage: emptyUsage(),
          }));

          const emitProgress = () => {
            if (!onUpdate) return;
            const done = allResults.filter((r) => r.exitCode !== -1).length;
            const running = allResults.filter((r) => r.exitCode === -1).length;
            onUpdate({
              content: [{ type: "text" as const, text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
              details: makeDetails("parallel")([...allResults]),
            });
          };

          let heartbeat: ReturnType<typeof setInterval> | undefined;
          if (onUpdate) {
            emitProgress();
            heartbeat = setInterval(() => {
              if (allResults.some((r) => r.exitCode === -1)) emitProgress();
            }, HEARTBEAT_MS);
          }

          let results: SingleResult[];
          try {
            results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (t, index) => {
              const parallelAgent = isDisciplineAgent(t.agent)
                ? augmentAgentWithKarpathy(findAgent(t.agent))
                : findAgent(t.agent);
              const result = await runAgent({
                agent: parallelAgent,
                agentName: t.agent,
                task: t.task,
                cwd: t.cwd || defaultCwd,
                depthConfig,
                signal,
                sandbox: sandboxFor(t.cwd || defaultCwd),
                onUpdate: (partial) => {
                  if (partial.details?.results[0]) {
                    allResults[index] = partial.details.results[0];
                    emitProgress();
                  }
                },
                makeDetails: makeDetails("parallel"),
                maxOutput,
                output: t.output,
                reads: t.reads,
                progress: t.progress,
                contextMode: context,
                worktree,
              });
              allResults[index] = result;
              emitProgress();
              return result;
            });
          } finally {
            if (heartbeat) clearInterval(heartbeat);
          }

          const successCount = results.filter((r) => isResultSuccess(r)).length;
          const summaries = results.map((r) =>
            `[${r.agent}] ${isResultError(r) ? "failed" : "completed"}: ${getResultSummaryText(r, maxOutput)}`,
          );
          return {
            content: [{ type: "text" as const, text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}` }],
            details: makeDetails("parallel")(results),
          };
        }

        if (agent && task) {
          let effectiveTask = task;

          // Validator information barrier: replace LLM-composed task with
          // code-generated prompt built directly from the plan file.
          if (agent === "plan-validator" && params.planFile && params.planTaskId != null) {
            try {
              const planContent = await readFile(params.planFile, "utf-8");
              const parsed = parsePlan(planContent);
              const planTask = parsed.tasks.find((t) => t.id === params.planTaskId);
              if (planTask) {
                effectiveTask = buildValidatorPrompt(planTask, parsed.verificationCommand);
              }
            } catch {
            }
          }

          const singleAgent = isDisciplineAgent(agent)
            ? augmentAgentWithKarpathy(findAgent(agent))
            : findAgent(agent);
          const result = await runAgent({
            agent: singleAgent,
            agentName: agent,
            task: effectiveTask,
            cwd: cwd || defaultCwd,
            depthConfig,
            signal,
            sandbox: sandboxFor(cwd || defaultCwd),
            onUpdate,
            makeDetails: makeDetails("single"),
            maxOutput,
            output,
            reads,
            progress,
            contextMode: context,
          });

          if (isDisciplineAgent(agent) && isResultSuccess(result)) {
            const slopCleaner = findAgent("slop-cleaner");
            if (slopCleaner) {
              const cleanResult = await runAgent({
                agent: slopCleaner,
                agentName: "slop-cleaner",
                task: getSlopCleanerTask(),
                cwd: cwd || defaultCwd,
                depthConfig,
                signal,
                sandbox: sandboxFor(cwd || defaultCwd),
                onUpdate,
                makeDetails: makeDetails("single"),
                maxOutput,
                contextMode: context,
              });
              const mainText = getResultSummaryText(result, maxOutput);
              const cleanText = isResultSuccess(cleanResult)
                ? `\n\n[slop-cleaner] completed: ${getResultSummaryText(cleanResult, maxOutput)}`
                : `\n\n[slop-cleaner] failed: ${getResultSummaryText(cleanResult, maxOutput)}`;
              return {
                content: [{ type: "text" as const, text: mainText + cleanText }],
                details: makeDetails("single")([result, cleanResult]),
              };
            }
          }

          if (isResultError(result)) {
            return {
              content: [{ type: "text" as const, text: `Agent ${result.stopReason || "failed"}: ${getResultSummaryText(result, maxOutput)}` }],
              details: makeDetails("single")([result]),
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: getResultSummaryText(result, maxOutput) }],
            details: makeDetails("single")([result]),
          };
        }

        return {
          content: [{ type: "text" as const, text: "Error: Specify either (agent + task) for single mode, tasks for parallel mode, or chain for chain mode." }],
          details: makeDetails("single")([]),
        };
      },
    });
  }

  const WebFetchParams = Type.Object({
    url: Type.String({
      description: "The URL to fetch and convert to Markdown",
    }),
    raw: Type.Optional(
      Type.Boolean({
        description:
          "Convert the full HTML page to Markdown without filtering",
        default: false,
      }),
    ),
    includeScripts: Type.Optional(
      Type.Boolean({
        description:
          "Include <script> and <style> tag content in the output. Default: false (stripped)",
        default: false,
      }),
    ),
    maxLength: Type.Optional(
      Type.Number({
        description:
          "Maximum number of characters to return. Content beyond this limit is truncated.",
      }),
    ),
  });

  pi.registerTool({
    name: "webfetch",
    label: "WebFetch",
    description:
      "Fetch a URL and convert its HTML content to clean Markdown. Uses Turndown + GFM for Markdown conversion. Results are cached for 15 minutes.",
    promptSnippet: "Fetch a URL and convert to Markdown",
    promptGuidelines: [
      "Use webfetch to retrieve and read web pages, documentation, or any URL content.",
      "Script and style tags are stripped by default. Use includeScripts: true when you need CSS/JS source code.",
      "Use raw: true when you need the full HTML page converted without any filtering.",
      "Use maxLength to limit output size for very large pages.",
      "Results are cached for 15 minutes — repeated requests for the same URL return instantly.",
    ],
    parameters: WebFetchParams,

    renderCall: (args, theme) => renderWebfetchCall(args, theme),
    renderResult: (result, { expanded }, theme) =>
      renderWebfetchResult(result, expanded, theme),

    execute: async (toolCallId, params, signal, _onUpdate, _ctx) => {
      const { url, raw, maxLength, includeScripts } = params;
      try {
        const { content, details } = await fetchUrlToMarkdown(url, {
          raw,
          maxLength,
          includeScripts,
          signal,
        });
        return {
          content: [{ type: "text" as const, text: content }],
          details,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching ${url}: ${message}`,
            },
          ],
          details: undefined,
          isError: true,
        };
      }
    },
  });

  pi.on("resources_discover", async (_event, _ctx) => {
    return {
      skillPaths: [BUNDLED_SKILLS_DIR],
    };
  });

  const clarificationQuestionRule = isRootSession
    ? "- Ask ONE question per message using the ask_user_question tool."
    : "- Do not ask the user questions directly. If information is missing, state the gap clearly in your output.";
  const planningAmbiguityRule = isRootSession
    ? "- Use ask_user_question if you need to resolve any remaining ambiguity."
    : "- If ambiguity remains, state it explicitly and request root-session clarification in your output.";
  const ultraplanningTradeoffRule = isRootSession
    ? "- Use ask_user_question if you need user input on trade-offs."
    : "- If trade-off input is missing, document the trade-off and recommend what should be clarified by the root session.";

  const PHASE_GUIDANCE: Record<WorkflowPhase, string> = {
    idle: "",
    clarifying: [
      "\n\n## Active Workflow: Clarification",
      "You are in agentic-clarification mode. Follow the agentic-clarification skill rules strictly:",
      clarificationQuestionRule,
      "- Generate questions and choices dynamically based on context — no predefined templates.",
      "- Use the subagent tool with agent 'explorer' to investigate the codebase in parallel with user Q&A.",
      "- After each answer, update 'what we've established so far' and assess remaining ambiguity.",
      "- When ambiguity is resolved, present a Context Brief with Complexity Assessment.",
      "- Do NOT start implementation. This phase ends with a Context Brief, not code.",
    ].join("\n"),
    planning: [
      "\n\n## Active Workflow: Plan Crafting",
      "You are in agentic-plan-crafting mode. Follow the agentic-plan-crafting skill rules strictly:",
      "- Write an executable implementation plan from the current context.",
      "- Every step must be executable — no placeholders.",
      planningAmbiguityRule,
      "- End with a Self-Review before presenting the plan.",
    ].join("\n"),
    ultraplanning: [
      "\n\n## Active Workflow: Milestone Planning (Ultraplan)",
      "You are in agentic-milestone-planning mode. Follow the agentic-milestone-planning skill rules strictly:",
      "- Compose a Problem Brief from the current context.",
      "- Dispatch all 5 reviewer agents in parallel using the subagent tool's parallel mode: reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value.",
      "- Synthesize all reviewer findings into a milestone DAG.",
      ultraplanningTradeoffRule,
    ].join("\n"),
    reviewing: [
      "\n\n## Active Workflow: Code Review (/review)",
      "You are in single-pass code review mode:",
      "- Resolve the review target (PR or local diff) as described in the user prompt.",
      "- Read the diff and the files it touches.",
      "- Produce a single integrated review across bug / security / performance / test coverage / consistency dimensions.",
      "- Output the review directly to chat. Do NOT save to a file. Do NOT dispatch subagents.",
      "- If the diff is empty, report 'No changes to review' and stop.",
    ].join("\n"),
    ultrareviewing: [
      "\n\n## Active Workflow: Deep Code Review (/ultrareview)",
      "You are orchestrating a 3-stage code review pipeline:",
      "- Stage 1 (finding): dispatch 10 subagents in parallel using the subagent tool's parallel mode — 5 reviewer roles (reviewer-bug, reviewer-security, reviewer-performance, reviewer-test-coverage, reviewer-consistency) × 2 seeds each. Seed 2 must be instructed to focus on findings seed 1 might miss.",
      "- Stage 2 (verification): dispatch reviewer-verifier (single mode) on the aggregated per-role findings.",
      "- Stage 3 (synthesis): dispatch review-synthesis (single mode) on the verifier output.",
      "- Save the synthesis output to docs/engineering-discipline/reviews/<YYYY-MM-DD>-<topic>-review.md and stream a 5-item top-priority summary to chat.",
      "- If the diff is empty, report 'No changes to review' and stop before dispatching any subagents.",
      "- NEVER dispatch any agent whose name contains 'worker' — only reviewer-* and review-synthesis are allowed in this pipeline.",
    ].join("\n"),
  };

  // Matches user turns that are claude-code skill/command invocations. We suppress
  // phase guidance for these turns so the invoked skill's own instructions are not
  // overridden by a stale workflow phase (e.g. user ran /ultraplan last week,
  // never reset-phase, and today invokes /systematic-debugging).
  const SKILL_INVOCATION_RE = /<command-name>|<command-message>|\[skill\]/;

  pi.on("before_agent_start", async (event, _ctx) => {
    const isSkillInvocation = SKILL_INVOCATION_RE.test(event.prompt ?? "");
    const guidance = (isRootSession && !isSkillInvocation) ? PHASE_GUIDANCE[currentPhase] : "";

    let delegationInfo = "";
    if (depthConfig.canDelegate && !isTeamWorker) {
      const agentList = (await discoverAgents(_ctx.cwd || ".", "user", BUNDLED_AGENTS_DIR))
        .map((a) => `- **${a.name}**: ${a.description}`)
        .join("\n");
      delegationInfo = `\n\n## Delegation Guards\n- Current depth: ${depthConfig.currentDepth}, max: ${depthConfig.maxDepth}\n- Cycle prevention: ${depthConfig.preventCycles ? "enabled" : "disabled"}\n- Ancestor stack: ${depthConfig.ancestorStack.length > 0 ? depthConfig.ancestorStack.join(" -> ") : "(root)"}\n\n## Available Subagents\n${agentList}`;
    }

    if (!guidance && !delegationInfo) return;
    return {
      systemPrompt: event.systemPrompt + (guidance || "") + delegationInfo,
    };
  });

  pi.on("context", async (event, _ctx) => {
    const compacted = microcompactMessages(event.messages);
    const changed = compacted.some((msg, i) => msg !== event.messages[i]);
    if (!changed) return;
    return { messages: compacted };
  });

  pi.on("session_before_compact", async (event, ctx) => {
    // Skip custom compaction for idle phase with no active goal document —
    // let pi's default compaction handle simple conversations.
    if (currentPhase === "idle" && !activeGoalDocument) return;

    const { preparation, signal } = event;
    const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;

    const model = ctx.model;
    if (!model) {
      ctx.ui.notify("No model available, using default compaction", "warning");
      return;
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      ctx.ui.notify("Compaction auth failed, using default compaction", "warning");
      return;
    }

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    if (allMessages.length === 0) return;

    ctx.ui.notify(
      `Custom compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens)...`,
      "info",
    );

    const conversationText = serializeConversation(convertToLlm(allMessages));

    const promptText = getCompactionPrompt(
      currentPhase,
      activeGoalDocument,
      event.customInstructions,
    );

    const previousContext = previousSummary
      ? `\n\nPrevious session summary for context:\n${previousSummary}`
      : "";

    const summaryMessages = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `${promptText}${previousContext}\n\n<conversation>\n${conversationText}\n</conversation>`,
          },
        ],
        timestamp: Date.now(),
      },
    ];

    try {
      const response = await complete(
        model,
        { messages: summaryMessages },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 8192,
          signal,
        },
      );

      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      if (!summary.trim()) {
        if (!signal.aborted) {
          ctx.ui.notify("Compaction summary was empty, using default", "warning");
        }
        return;
      }

      const formattedSummary = formatCompactSummary(summary);

      return {
        compaction: {
          summary: formattedSummary,
          firstKeptEntryId,
          tokensBefore,
          details: {
            phase: currentPhase,
            activeGoalDocument,
          },
        },
      };
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Compaction failed: ${message}`, "error");
      return;
    }
  });

  pi.on("session_compact", async (event, _ctx) => {
    // Mirror the before_agent_start subagent guard: subagents never inherit
    // workflow phase state, even via compaction round-trips. Keeps phase
    // strictly isolated to the root session.
    if (!isRootSession) return;

    if (event.fromExtension && event.compactionEntry.details) {
      const details = event.compactionEntry.details as {
        phase?: string;
        activeGoalDocument?: string | null;
      };
      if (details.phase) currentPhase = details.phase as WorkflowPhase;
      if (details.activeGoalDocument !== undefined) {
        activeGoalDocument = details.activeGoalDocument;
      }
    }
  });

  const GOAL_DOC_PATTERN = /^docs\/engineering-discipline\/(context|plans|reviews)\//;

  // Maps each non-idle phase to the regex for the directory whose fresh write signals phase completion.
  // A write to the matching directory flips currentPhase back to "idle" so the workflow guidance stops
  // riding on subsequent turns. Edits are ignored — only initial writes (new files) count as completion.
  const PHASE_TERMINAL_DIR: Partial<Record<WorkflowPhase, RegExp>> = {
    clarifying: /^docs\/engineering-discipline\/context\//,
    planning: /^docs\/engineering-discipline\/plans\//,
    ultraplanning: /^docs\/engineering-discipline\/plans\//,
    reviewing: /^docs\/engineering-discipline\/reviews\//,
    ultrareviewing: /^docs\/engineering-discipline\/reviews\//,
  };

  pi.on("tool_result", async (event, _ctx) => {
    if (currentPhase === "idle") return;

    const toolName = event.toolName;
    if (toolName !== "write" && toolName !== "edit") return;

    const filePath = event.input.path as string | undefined;
    if (!filePath) return;

    const relativePath = filePath.replace(/^.*?docs\/engineering-discipline\//, "docs/engineering-discipline/");
    if (!GOAL_DOC_PATTERN.test(relativePath)) return;

    activeGoalDocument = relativePath;

    // Auto-reset phase when the current phase's terminal artifact is written (not edited).
    // Clear activeGoalDocument too so this matches /reset-phase semantics — otherwise the
    // session_before_compact early-return gate stays open with a stale goal-doc pointer.
    if (toolName === "write") {
      const terminal = PHASE_TERMINAL_DIR[currentPhase];
      if (terminal && terminal.test(relativePath)) {
        currentPhase = "idle";
        activeGoalDocument = null;
      }
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const hasUI = (ctx as any).hasUI !== false && !!ctx?.ui?.select;

    if (isToolCallEventType("bash", event)) {
      if (parsedApprovalMode.mode === "always") return;
      if (parsedApprovalMode.mode === "deny") {
        return {
          block: true,
          reason: "Bash command execution is blocked by PI_SANDBOX_APPROVAL_MODE=deny.",
        };
      }

      const command = typeof event.input?.command === "string" ? event.input.command : "";
      const cwd = ctx.cwd || process.cwd();
      const policyFingerprint = makePolicyFingerprint({
        platform: process.platform,
        cwd,
        workspaceRoot: process.cwd(),
        fsMode: "workspace-write",
        networkMode: "on",
      });
      const fallbackReason = "Policy requires explicit approval before command execution.";
      const approvalKey = `${policyFingerprint}:${fallbackReason}`;
      const cached = approvalStore.getApprovedScope(approvalKey);
      if (cached === "session" || cached === "always") return;

      if (!hasUI) {
        return {
          block: true,
          reason: "Bash commands require interactive approval in ask mode.",
        };
      }

      const choice = await ctx.ui.select(
        [
          "Bash command execution requested.",
          `Command: ${command || "(empty)"}`,
          "Allow this command?",
        ].join("\n"),
        ["Deny", "Allow once", "Allow for session", "Always allow"],
      );

      if (choice === "Allow once") return;
      if (choice === "Allow for session") {
        await approvalStore.setApprovedScope(approvalKey, "session");
        return;
      }
      if (choice === "Always allow") {
        await approvalStore.setApprovedScope(approvalKey, "always");
        return;
      }
      return {
        block: true,
        reason: "Bash command denied by user approval.",
      };
    }

    if (!isToolCallEventType("read", event)) return;
    const inputPath = event.input?.path;
    if (!inputPath || typeof inputPath !== "string") return;
    if (!isSensitiveEnvPath(inputPath, ctx.cwd)) return;
    if (parsedApprovalMode.mode === "always") return;
    if (parsedApprovalMode.mode === "deny") {
      return {
        block: true,
        reason: "Sensitive .env* reads are blocked by PI_SANDBOX_APPROVAL_MODE=deny.",
      };
    }

    const cwd = ctx.cwd || process.cwd();
    const resolved = resolve(cwd, inputPath);
    const approvalKey = `sensitive-env-read:${resolved}`;
    const cached = approvalStore.getApprovedScope(approvalKey);
    if (cached === "session" || cached === "always") return;

    if (!hasUI) {
      return {
        block: true,
        reason: "Sensitive .env* reads require interactive approval in ask mode.",
      };
    }

    const choice = await ctx.ui.select(
      [
        "Sensitive .env* read requested.",
        `Path: ${resolved}`,
        "Allow this read?",
      ].join("\n"),
      ["Deny", "Allow once", "Allow for session", "Always allow"],
    );

    if (choice === "Allow once") return;
    if (choice === "Allow for session") {
      await approvalStore.setApprovedScope(approvalKey, "session");
      return;
    }
    if (choice === "Always allow") {
      await approvalStore.setApprovedScope(approvalKey, "always");
      return;
    }
    return {
      block: true,
      reason: "Sensitive .env* read denied by user approval.",
    };
  });

  pi.registerCommand("clarify", {
    description:
      "Start agentic-clarification — the agent asks dynamic questions to resolve ambiguity",
    handler: async (args, ctx) => {
      const topic = args?.trim() || "";
      const start = await ctx.ui.confirm(
        "Start Clarification",
        "The agent will ask you questions one at a time to clarify your request.\nIt will also explore the codebase in parallel.\n\nProceed?"
      );
      if (!start) return;

      currentPhase = "clarifying";
      activeGoalDocument = null;
      ctx.ui.setStatus("harness", "Clarification in progress...");

      const prompt = topic
        ? isRootSession
          ? `The user wants to clarify the following request: "${topic}"\n\nBegin the agentic-clarification process. Follow the agentic-clarification skill rules. Ask ONE question using the ask_user_question tool. Use the subagent tool with agent 'explorer' to investigate relevant parts of the codebase in parallel.`
          : `The user wants to clarify the following request: "${topic}"\n\nBegin the agentic-clarification process. Follow the agentic-clarification skill rules. Do not ask the user questions directly. If information is missing, state the missing information clearly in your output. Use the subagent tool with agent 'explorer' to investigate relevant parts of the codebase in parallel.`
        : isRootSession
          ? `The user wants to start an agentic-clarification session for their current task.\n\nBegin the agentic-clarification process. Follow the agentic-clarification skill rules. Ask ONE question using the ask_user_question tool to understand what the user wants to accomplish. Use the subagent tool with agent 'explorer' to investigate the codebase in parallel.`
          : `The user wants to start an agentic-clarification session for their current task.\n\nBegin the agentic-clarification process. Follow the agentic-clarification skill rules. Do not ask the user questions directly. If information is missing, state the missing information clearly in your output. Use the subagent tool with agent 'explorer' to investigate the codebase in parallel.`;

      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("plan", {
    description:
      "Generate an implementation plan — the agent follows agentic-plan-crafting skill rules",
    handler: async (args, ctx) => {
      const ok = await ctx.ui.confirm(
        "Start Agentic Plan Crafting",
        "The agent will create an executable implementation plan based on current context using the agentic-plan-crafting workflow.\n\nProceed?"
      );
      if (!ok) return;

      currentPhase = "planning";
      ctx.ui.setStatus("harness", "Agentic planning workflow in progress...");

      const topic = args?.trim() || "";
      const prompt = topic
        ? isRootSession
          ? `Create an executable implementation plan for: "${topic}"\n\nFollow the agentic-plan-crafting skill rules. If a Context Brief exists from a previous agentic-clarification, use it as input. If not, use the ask_user_question tool to confirm goal, scope, and tech stack before writing the plan.`
          : `Create an executable implementation plan for: "${topic}"\n\nFollow the agentic-plan-crafting skill rules. If a Context Brief exists from a previous agentic-clarification, use it as input. If not, state any missing goal, scope, or tech-stack information explicitly in the plan assumptions before writing the plan.`
        : isRootSession
          ? `Create an executable implementation plan for the current task.\n\nFollow the agentic-plan-crafting skill rules. If a Context Brief exists from a previous agentic-clarification, use it as input. If not, use the ask_user_question tool to confirm goal, scope, and tech stack before writing the plan.`
          : `Create an executable implementation plan for the current task.\n\nFollow the agentic-plan-crafting skill rules. If a Context Brief exists from a previous agentic-clarification, use it as input. If not, state any missing goal, scope, or tech-stack information explicitly in the plan assumptions before writing the plan.`;

      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("ultraplan", {
    description:
      "Decompose a complex task into milestones — the agent dynamically selects reviewers",
    handler: async (args, ctx) => {
      const confirmed = await ctx.ui.confirm(
        "Start Agentic Milestone Planning (Ultraplan)",
        "The agent will:\n1. Compose a Problem Brief\n2. Decide which reviewer perspectives are needed\n3. Dispatch reviewers in parallel\n4. Synthesize a milestone DAG\n\nProceed?"
      );
      if (!confirmed) return;

      currentPhase = "ultraplanning";
      ctx.ui.setStatus("harness", "Agentic milestone workflow in progress...");

      const topic = args?.trim() || "";
      const prompt = topic
        ? `Decompose the following complex task into milestones: "${topic}"\n\nFollow the agentic-milestone-planning skill rules. First compose a Problem Brief. Then dispatch all 5 reviewer agents in parallel using the subagent tool: reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value. After all reviewers complete, synthesize their findings into a milestone DAG.`
        : `Decompose the current complex task into milestones.\n\nFollow the agentic-milestone-planning skill rules. First compose a Problem Brief from the current context. Then dispatch all 5 reviewer agents in parallel using the subagent tool: reviewer-feasibility, reviewer-architecture, reviewer-risk, reviewer-dependency, reviewer-user-value. After all reviewers complete, synthesize their findings into a milestone DAG.`;

      pi.sendUserMessage(prompt);
    },
  });

  // Review target argument must be a PR number, a git ref name, or a PR URL.
  // Restrict to a safe character set (alphanumerics, dot, dash, underscore,
  // slash, colon) so that the value cannot smuggle shell metacharacters into
  // the downstream prompt's `gh pr diff ${topic}` / `git diff main...${topic}`
  // templates. Colon is safe (not a shell metacharacter) and is needed for the
  // `https://` scheme in GitHub PR URLs.
  const REVIEW_TOPIC_RE = /^[a-zA-Z0-9._/:\-]+$/;

  pi.registerCommand("review", {
    description:
      "Single-pass code review of current changes (PR or local diff, auto-detected)",
    handler: async (args, ctx) => {
      const topic = args?.trim() || "";
      if (topic && !REVIEW_TOPIC_RE.test(topic)) {
        ctx.ui.notify(
          `Invalid review target: "${topic}". Expected a PR number (e.g. 27), a branch name (e.g. feature/foo), or a PR URL (e.g. https://github.com/owner/repo/pull/27). Only alphanumerics, dot, dash, underscore, slash, and colon are allowed.`,
          "error"
        );
        return;
      }

      currentPhase = "reviewing";
      activeGoalDocument = null;
      ctx.ui.setStatus("harness", "Code review in progress...");

      const targetClause = topic
        ? `Review target: "${topic}" (may be a PR number, a PR URL, or a branch name). If it is a number or contains "://" (a URL), treat it as a PR reference and fetch the diff with \`gh pr diff ${topic}\` — \`gh\` accepts PR numbers and full PR URLs interchangeably. Otherwise treat it as a branch name and diff it against main with \`git diff main...${topic}\`.`
        : `Review target: auto-detect. First run \`git rev-parse --abbrev-ref HEAD\` to get the current branch. Then run \`gh pr list --head <branch> --json number --jq '.[0].number'\` to check for a matching PR. If a PR exists, use \`gh pr diff <number>\`. Otherwise, combine \`git diff main...HEAD\` with uncommitted changes from \`git diff\` and \`git diff --cached\`.`;

      const prompt = [
        "You are an expert code reviewer. Perform a single-pass review of the current code changes.",
        "",
        targetClause,
        "",
        "If the diff is empty, report \"No changes to review\" and stop.",
        "",
        "Review the diff across these dimensions (brief, integrated review — do not produce a rubric):",
        "- **Bugs**: logic errors, boundary conditions, null/undefined, race conditions, missing error handling",
        "- **Security**: injection, auth/authz, crypto misuse, data exposure",
        "- **Performance**: unnecessary work, algorithmic complexity, sync I/O on hot paths",
        "- **Test coverage**: missing tests, happy-path only, uncovered edge cases",
        "- **Consistency**: naming/convention breaks, duplication of existing utilities, pattern drift",
        "",
        "Output the review directly to chat. Group findings by file. For each finding include: what, where (file:line), severity (Critical/High/Medium/Low), and a one-line suggested fix. Do NOT save to file. Do NOT dispatch subagents — this is a single-pass review performed by you directly.",
      ].join("\n");

      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("ultrareview", {
    description:
      "Deep multi-agent code review — 10 parallel reviewers + verification + synthesis",
    handler: async (args, ctx) => {
      const topic = args?.trim() || "";
      if (topic && !REVIEW_TOPIC_RE.test(topic)) {
        ctx.ui.notify(
          `Invalid review target: "${topic}". Expected a PR number (e.g. 27), a branch name (e.g. feature/foo), or a PR URL (e.g. https://github.com/owner/repo/pull/27). Only alphanumerics, dot, dash, underscore, slash, and colon are allowed.`,
          "error"
        );
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Start Ultrareview",
        "The agent will:\n1. Auto-detect the review target (PR or local diff)\n2. Dispatch 10 subagents in parallel (5 reviewers × 2 seeds)\n3. Run a verification pass to dedupe and filter\n4. Synthesize the final report and save to docs/engineering-discipline/reviews/\n\nThis may take several minutes. Proceed?"
      );
      if (!confirmed) return;

      currentPhase = "ultrareviewing";
      activeGoalDocument = null;
      ctx.ui.setStatus("harness", "Ultrareview pipeline in progress...");

      const targetClause = topic
        ? `Review target: "${topic}" (may be a PR number, a PR URL, or a branch name). If it is a number or contains "://" (a URL), treat it as a PR reference and fetch the diff with \`gh pr diff ${topic}\` — \`gh\` accepts PR numbers and full PR URLs interchangeably. Otherwise treat it as a branch name and diff it against main with \`git diff main...${topic}\`.`
        : `Review target: auto-detect. First run \`git rev-parse --abbrev-ref HEAD\` to get the current branch. Then run \`gh pr list --head <branch> --json number --jq '.[0].number'\` to check for a matching PR. If a PR exists, use \`gh pr diff <number>\`. Otherwise, combine \`git diff main...HEAD\` with uncommitted changes from \`git diff\` and \`git diff --cached\`.`;

      const prompt = [
        "You are orchestrating a multi-stage code review pipeline. Execute all three stages in order.",
        "",
        targetClause,
        "",
        "If the diff is empty, report \"No changes to review\" and stop before dispatching any subagents.",
        "",
        "## Stage 1: Finding (parallel fleet)",
        "",
        "First, resolve the diff once and write it to a shared artifact such as `docs/engineering-discipline/reviews/.tmp/<date>-<topic>.diff` so all reviewers can read the same source without duplicating the full diff payload 10 times.",
        "",
        "Dispatch **10 subagents in parallel** using the subagent tool's parallel mode. This is 5 reviewer roles × 2 seeds each:",
        "- reviewer-bug (seed 1, seed 2)",
        "- reviewer-security (seed 1, seed 2)",
        "- reviewer-performance (seed 1, seed 2)",
        "- reviewer-test-coverage (seed 1, seed 2)",
        "- reviewer-consistency (seed 1, seed 2)",
        "",
        "For each task in the tasks array, the `task` field must include:",
        "1. The shared diff artifact path (or, only if absolutely necessary for a very small diff, a minimal relevant diff excerpt rather than the full inline diff)",
        "2. The list of affected file paths",
        "3. The seed number with this instruction: seed 1 = \"Perform a fresh independent pass\"; seed 2 = \"You are seed 2 — focus on findings seed 1 might miss by examining edge cases and alternative execution paths.\"",
        "4. An explicit instruction to read the shared diff artifact before opening touched files",
        "",
        "Invoke the subagent tool ONCE in parallel mode with a tasks array of 10 entries.",
        "",
        "## Stage 2: Verification",
        "",
        "After all 10 reviewers complete, aggregate their raw findings grouped by role (concatenate seed 1 and seed 2 outputs per role). Then dispatch `reviewer-verifier` in single mode with the aggregated findings as the task. The verifier will deduplicate, filter false positives, and assign final severity/confidence.",
        "",
        "## Stage 3: Synthesis",
        "",
        "Dispatch `review-synthesis` in single mode. The task must substitute these template slots:",
        "- `{VERIFIED_FINDINGS}` = verifier output from Stage 2",
        "- `{REVIEW_TARGET}` = the resolved target (e.g., 'PR #123' or 'branch feature/foo')",
        "- `{REVIEW_DATE}` = today's date as YYYY-MM-DD",
        "",
        "## Output",
        "",
        "1. Compute `<topic>`: if PR mode, use `pr-<number>`; if branch mode, use the sanitized branch name (replace `/` with `-`, lowercase).",
        "2. Compute `<date>`: today's date as YYYY-MM-DD.",
        "3. Write the full synthesis report to `docs/engineering-discipline/reviews/<date>-<topic>-review.md`. Create the directory if it does not exist.",
        "4. Stream a brief summary to chat: the 5 highest-priority findings (by severity then confidence), each with file:line and one-line description, plus the full saved path.",
        "",
        "NEVER dispatch any agent whose name contains \"worker\". Use only the reviewer-* and review-synthesis agents defined for this pipeline.",
      ].join("\n");

      pi.sendUserMessage(prompt);
    },
  });

  if (isRootSession) {
    pi.registerCommand("ask", {
      description: "Manual smoke test for the ask_user_question tool",
      handler: async (args, ctx) => {
        const topic = args?.trim() || "Ask me one focused question using the ask_user_question tool.";
        const confirmed = await ctx.ui.confirm(
          "Run /ask",
          "The agent will send a manual prompt that requires one ask_user_question tool call.\n\nProceed?"
        );
        if (!confirmed) return;

        currentPhase = "idle";
        ctx.ui.setStatus("harness", "Manual ask_user_question test in progress...");

        pi.sendUserMessage(
          `Manual tool test: use the ask_user_question tool exactly once, then stop. User context: "${topic}"`
        );
      },
    });
  }

  const setupHandler = async (_args: string, ctx: any) => {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

    let current: Record<string, unknown> = {};
    try {
      const raw = await readFile(settingsPath, "utf-8");
      current = JSON.parse(raw);
    } catch {
    }

    if (current.quietStartup === true) {
      ctx.ui.notify("Settings already configured — quietStartup is true.", "info");
      return;
    }

    const ok = await ctx.ui.confirm(
      "Setup: Configure Recommended Settings",
      [
        "This will add \"quietStartup\": true to your settings.json:",
        `  ${settingsPath}`,
        "",
        "This hides the default Skills/Extensions/Themes listing at startup.",
        "The ROACH PI banner takes over instead.",
        "",
        "Proceed?",
      ].join("\n"),
    );
    if (!ok) return;

    const updated = { ...current, quietStartup: true };
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(updated, null, 2) + "\n");

    ctx.ui.notify("Settings updated — quietStartup is now true. Restart pi to see the effect.", "info");

    // Ask to star the repository if gh is available
    try {
      const { execSync } = await import("child_process");
      execSync("gh auth status", { stdio: "pipe", timeout: 3000 });
      const star = await ctx.ui.confirm(
        "Star roach-pi on GitHub?",
        "Thanks for using ROACH PI! Would you like to star the repository? ⭐",
      );
      if (star) {
        execSync("gh api user/starred/tmdgusya/roach-pi -X PUT", { stdio: "pipe" });
        ctx.ui.notify("Thanks for the star! ⭐", "info");
      }
    } catch {
      // gh not available or not authenticated — skip silently
    }
  };

  pi.registerCommand("init", {
    description:
      "Configure recommended settings — sets quietStartup: true in ~/.pi/agent/settings.json",
    handler: setupHandler,
  });

  pi.registerCommand("setup", {
    description:
      "Configure recommended settings — sets quietStartup: true in ~/.pi/agent/settings.json",
    handler: setupHandler,
  });

  pi.registerCommand("reset-phase", {
    description: "Reset the workflow phase to idle (clears clarify/plan/ultraplan mode)",
    handler: async (_args, ctx) => {
      currentPhase = "idle";
      activeGoalDocument = null;
      ctx.ui.setStatus("harness", undefined);
      ctx.ui.notify("Workflow phase reset to idle.", "info");
    },
  });

  pi.registerCommand("team", {
    description:
      "Kick off a lightweight native team run — usage: /team goal=\"...\" [agent=worker] [backend=auto|native|tmux] [worker-count=N] [worktree-policy=off|on|auto] [resume=runId] [resume-mode=mark-interrupted|retry-stale] [max-output=N]",
    getArgumentCompletions: async (argumentPrefix) => {
      try {
        return await getTeamArgumentCompletions(argumentPrefix, {
          listAgents: async () => {
            const found = await discoverAgents(process.cwd(), "user", BUNDLED_AGENTS_DIR);
            return found.map((a) => a.name);
          },
          listResumeRuns: async () => {
            const records = await listTeamRuns(defaultTeamRunStateRoot(process.cwd()));
            return records.map((r) => ({ runId: r.runId, status: r.status ?? "unknown" }));
          },
        });
      } catch {
        return null;
      }
    },
    handler: async (args, ctx) => {
      const parsed = parseTeamArgs(args ?? "");
      const isFollowUp = isTeamFollowUpCommand(parsed);
      if (!parsed.goal && !isFollowUp) {
        ctx.ui.notify("/team requires a goal, or follow-up mode: /team resume=<runId> command=<worker|taskId> message=\"...\"", "error");
        return;
      }
      if (parsed.goal && isFollowUp) {
        ctx.ui.notify("/team goal mode and follow-up command mode are mutually exclusive; omit goal when using resume+command+message.", "error");
        return;
      }
      const ok = await ctx.ui.confirm(
        isFollowUp ? "Enqueue Team Command" : "Start Team Run",
        isFollowUp
          ? `Enqueue follow-up command for ${parsed.commandTarget} in ${parsed.resume}:\n\n${parsed.commandMessage}\n\nProceed?`
          : `Dispatch a bounded team toward the goal:\n\n${parsed.goal}\n\nProceed?`,
      );
      if (!ok) return;
      ctx.ui.setStatus("harness", "Team run in progress...");
      pi.sendUserMessage(buildTeamCommandPrompt(parsed));
    },
  });

  pi.on("message_end", async (event, _ctx) => {
    const msg = event.message;
    if (msg.role === "assistant") {
      const usage = msg.usage;
      if (usage) {
        cacheStats.totalInput += usage.input;
        cacheStats.totalCacheRead += usage.cacheRead;
      }
    }
  });

  pi.on("tool_execution_start", async (event, _ctx) => {
    activeTools.running.set(event.toolCallId, event.toolName);
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    activeTools.running.delete(event.toolCallId);
  });

  pi.on("session_start", async (_event, ctx) => {
    currentPhase = "idle";
    activeGoalDocument = null;

    cacheStats.totalInput = 0;
    cacheStats.totalCacheRead = 0;
    activeTools.running.clear();

    ctx.ui.setHeader((_tui, theme) => {
      const banner = [
        "██████╗  ██████╗  █████╗  ██████╗██╗  ██╗    ██████╗ ██╗",
        "██╔══██╗██╔═══██╗██╔══██╗██╔════╝██║  ██║    ██╔══██╗██║",
        "██████╔╝██║   ██║███████║██║     ███████║    ██████╔╝██║",
        "██╔══██╗██║   ██║██╔══██║██║     ██╔══██║    ██╔═══╝ ██║",
        "██║  ██║╚██████╔╝██║  ██║╚██████╗██║  ██║    ██║     ██║",
        "╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝    ╚═╝     ╚═╝",
      ].map(line => theme.bold(theme.fg("accent", line))).join("\n");

      const tagline = theme.fg("dim", "Engineering Discipline Extension");

      const tips = [
        "Use /plan to generate a structured implementation plan after clarifying.",
        "Use /ultraplan for complex tasks that need multi-agent review.",
        "Use /reset-phase if you want to switch from one workflow to another.",
      ];
      const randomTip = tips[Math.floor(Math.random() * tips.length)];
      const tipLine = theme.fg("muted", `Tip: ${randomTip}`);
      const clarifyLine = theme.fg("dim", "However, in most cases, it's best to start with /clarify.");

      const hints = [
        keyHint("app.interrupt", "to interrupt"),
        keyHint("app.clear", "to clear"),
        rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
        keyHint("app.tools.expand", "to expand tools"),
        rawKeyHint("/", "for commands"),
        rawKeyHint("!", "to run bash"),
      ].join("\n");

      return new Text(`\n${banner}\n${tagline}\n\n${tipLine}\n${clarifyLine}\n\n${hints}`, 1, 0);
    });

    ctx.ui.setFooter((_tui, theme, footerData) => {
      return new RoachFooter(theme, footerData, {
        cwd: ctx.cwd,
        getModelName: () => ctx.model?.name,
        getContextUsage: () => ctx.getContextUsage(),
      }, cacheStats, activeTools);
    });

    ctx.ui.notify(
      "Agentic Harness loaded: /clarify, /plan, /ultraplan, /reset-phase",
      "info"
    );
  });
}
