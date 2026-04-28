# Pi Engineering Discipline Extension

An advanced extension for the [pi coding agent](https://github.com/badlogic/pi-mono), designed to bring strict engineering discipline and agentic orchestration to your workflow.

The agent dynamically generates questions, selects reviewers, and drives workflow phases autonomously — no hardcoded templates or fixed question sets.

## Features

- **`/clarify`**: The agent asks dynamic, context-aware questions one at a time to resolve ambiguity. It generates questions and choices on the fly based on your request, while exploring the codebase in parallel. Ends with a structured Context Brief.
- **`/plan`**: Delegates to the agent in strict agentic-plan-crafting mode, ensuring executable implementation plans with no placeholders.
- **`/ultraplan`**: The agent dynamically decides which reviewer perspectives are needed for your specific problem, dispatches them in parallel, and synthesizes findings into a milestone DAG.
- **`/ask`**: Manual test command for the `ask_user_question` tool.
- **`/reset-phase`**: Resets the workflow phase to idle (useful if you want to exit clarify/plan/ultraplan mode manually).
- **`ask_user_question` tool**: Registered as an LLM tool that the agent calls autonomously whenever it encounters ambiguity — not just during `/clarify`.

## How It Works

The extension uses three key mechanisms:

1. **`ask_user_question` tool** with `promptGuidelines` — the agent decides when and what to ask, generating questions and choices dynamically.
2. **`resources_discover` event** — automatically registers `~/engineering-discipline/skills/` so the agent has access to agentic-clarification, agentic-plan-crafting, and agentic-milestone-planning skill rules.
   - Compatibility mode (default): discovered skills are merged with existing skill sources.
   - If duplicate skill names exist, the first discovered skill is kept (extension-first override is not guaranteed).
3. **`before_agent_start` event** — injects workflow phase guidance into the system prompt so the agent stays on track during `/clarify`, `/plan`, or `/ultraplan` sessions.

## Prerequisites

This extension relies on the core engineering discipline skills (the LLM rulesets). **Before using this extension**, install the skills:

👉 **[tmdgusya/engineering-discipline](https://github.com/tmdgusya/engineering-discipline)**

The extension registers the skill paths automatically via `resources_discover`, so they will be available in the agent's system prompt.

By default this is compatibility behavior: non-conflicting user skills remain available.
For colliding skill names, precedence follows discovery order.

## Installation

```bash
pi install git:github.com/tmdgusya/pi-engineering-discipline-extension
```

## Usage

Start `pi` in interactive mode:

```bash
pi
```

Then use the slash commands:

1. `/clarify` — resolve ambiguity before planning (outputs a Context Brief)
2. `/plan` — create an executable implementation plan from the Context Brief
3. `/ultraplan` — decompose complex tasks into milestones with parallel reviewers

The `ask_user_question` tool is also available to the agent at all times — it will ask you questions autonomously whenever it detects ambiguity, even outside of `/clarify` mode.



## Lightweight Native Team Mode

The `team` tool coordinates a small, bounded batch of existing pi subagents from the root session. Use it when a goal can be split into independent worker assignments and you want one synthesized result with task lifecycle status and explicit verification evidence. Use `subagent` directly for one-off delegation when you do not need team task records, lifecycle status, or final synthesis.

Example tool invocation shape:

```json
{
  "goal": "Implement the API client and update its tests",
  "workerCount": 2,
  "agent": "worker",
  "worktree": false,
  "worktreePolicy": "off",
  "backend": "auto",
  "maxOutput": 6000
}
```

Parameters:

| Field | Required | Notes |
|---|---:|---|
| `goal` | yes | Root-level objective to split into dependency-free worker tasks. |
| `workerCount` | no | Number of workers to dispatch; defaults to a small batch and is clamped by the tool. |
| `agent` | no | Worker agent name; defaults to `worker`. |
| `worktree` | no | When `true`, asks the existing subagent runner to isolate worker edits in git worktrees. |
| `worktreePolicy` | no | Explicit worktree isolation policy: `off`, `on`, or `auto`. Defaults to legacy `worktree` boolean behavior. |
| `backend` | no | Execution backend selection: `auto`, `native`, or `tmux`. Defaults to `auto`. |
| `maxOutput` | no | Maximum characters of model-facing worker output retained in the final synthesis. |
| `runId` | no | Optional durable run id for persisted team state. |
| `resumeRunId` | no | Resume a previously persisted team run. |
| `resumeMode` | no | Resume behavior for stale in-progress tasks: `mark-interrupted` or `retry-stale`. |
| `staleTaskMs` | no | Age threshold for stale in-progress tasks during resume. |

### MVP behavior and stable summary contract

- Creates dependency-free parallel-batch task records; this MVP is not a dependency scheduler.
- `backend: "auto"` (default) prefers tmux when the binary is available and otherwise falls back to the native JSON subprocess backend.
- `backend: "native"` uses the existing JSON subprocess backend without tmux.
- `backend: "tmux"` requires tmux and records attach metadata for each worker pane.
- When `team` runs inside an existing tmux client, worker panes open automatically in the current tmux window; otherwise attach to a detached tmux-backed run with `tmux attach -t <session>`.
- Tmux worker panes are intended to be human-readable: standard pi JSON events are rendered into concise worker conversation/progress text in the visible pane and `task-N.log` pane log.
- Raw machine-readable pi JSON events are kept separately in a per-task event log such as `task-N.events.jsonl`; the orchestrator uses that event log for completion/result parsing when it is present.
- Failed tmux team runs intentionally leave tmux panes/sessions alive for debugging. Detached runs can be inspected with `tmux ls` and cleaned up with `tmux kill-session -t <session>`.
- If a tmux session collision occurs, retry sessions may use a suffixed session name; the actual attach command is recorded in the run summary and persisted state.
- The tmux backend runs the resolved sandbox command inside a tmux pane. Treat sandbox parity as tested for wrapper invocation, not as pane embedding isolation.
- Operator interaction happens through the existing tmux client and pane controls; detached runs still use tmux attach/switch-pane rather than a new pi-side control channel.
- Dispatches workers through the selected backend and preserves normal subagent depth/cycle safeguards.
- Runs team workers with `PI_TEAM_WORKER=1`, which suppresses recursive orchestration tools such as `team` and `subagent` inside workers.
- Returns a `TeamRunSummary` with stable user-facing fields: `goal`, `ok`/`success`, `completedCount`, `failedCount`, `tasks`, `finalSynthesis`, and `verificationEvidence`.
- Keeps each task's status, owner, output summary, artifact references, and worktree references when present.
- Can persist durable run records under `.pi/agent/runs/<runId>/team-run.json`, including task lifecycle events and recorded inbox/outbox messages.
- Can conservatively resume persisted runs by preserving terminal task state and marking stale in-progress tasks interrupted unless explicitly retried.
- Reports the run as incomplete/failed when any worker fails; partial worker success must not be synthesized as full team success.

### Deferred parity milestones

The lightweight team implementation intentionally defers heavier team-runtime features until they are implemented and tested:

- Live worker chat/control beyond recorded inbox/outbox messages
- Rich heartbeat/status dashboards beyond persisted run snapshots
- Full staged pipelines such as plan → PRD → exec → verify → fix
- In-pi pane embedding and direct pi-side keystroke routing to workers
- Default worktree-per-worker isolation policy; use `worktree`/`worktreePolicy` explicitly for now

### Verification and release checklist

Before declaring a team-mode change complete, run from `extensions/agentic-harness`:

```bash
npm test
npm run build
```

There is currently no `lint` script in `extensions/agentic-harness/package.json`; use the test/build gate plus manual docs review unless a lint script is added later. The test suite should cover task creation, worker prompt guardrails, worker-count clamping, success/failure synthesis, runtime suppression under `PI_TEAM_WORKER=1`, root tool registration, fake-runner e2e coverage, and tmux split-stream behavior where visible pane logs stay readable while raw event logs remain machine-parseable. The build must pass with `tsc --noEmit`.

### Tmux worker log troubleshooting

For tmux-backed team runs, inspect logs in this order:

1. **Visible pane / `task-N.log`** — start here for operator-facing context. It should show readable worker progress and final assistant text rather than raw `{"type":"message_end"...}` event envelopes.
2. **Raw event log / `task-N.events.jsonl`** — use this second when debugging orchestration, completion detection, or final synthesis. It contains the raw JSON events and tmux exit marker that the harness parses.
3. **Persisted team run / `team-run.json`** — use this for task lifecycle state, terminal metadata, artifact refs, and the final synthesized summary.

If a worker fails, the tmux session is intentionally preserved so the pane, visible log, and raw event log can be compared before cleanup.

## Development

1. Clone the repository:
   ```bash
   git clone https://github.com/tmdgusya/pi-engineering-discipline-extension.git ~/.pi/agent/extensions/agentic-harness
   ```
2. Install dependencies:
   ```bash
   cd ~/.pi/agent/extensions/agentic-harness
   npm install
   ```
3. Type `/reload` in the `pi` terminal to apply changes.

## Testing

```bash
npm test
npm run build
```

The extension test suite covers command delegation, event handlers, ask_user_question behavior, subagent/team registration, and lightweight team-mode synthesis. `npm run build` runs `tsc --noEmit`.
