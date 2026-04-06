# Pi Engineering Discipline Extension

An advanced extension for the [pi coding agent](https://github.com/badlogic/pi-mono), designed to bring strict engineering discipline and agentic orchestration to your workflow.

The agent dynamically generates questions, selects reviewers, and drives workflow phases autonomously — no hardcoded templates or fixed question sets.

## Installation

```bash
pi install git:github.com/tmdgusya/pi-engineering-discipline-extension
```

## Setup (Required)

> **After installing, run `/setup` first.** This is not optional.

```bash
/setup
```

`/setup` configures `quietStartup: true` in `~/.pi/agent/settings.json` so the extension's custom ROACH PI banner replaces the default startup listing. Without this, you'll see redundant startup output.

> ⚠️ **If you have the `superpowers` skill installed, remove it before using this extension.** The `superpowers` skill conflicts with this extension's bundled skills (e.g., `agentic-clarification`, `agentic-plan-crafting`, `agentic-karpathy`). Duplicate skill names can cause unexpected behavior since skill loading does not guarantee extension override.

## Why ROACH PI?

- **Fully open source** — Every line is on GitHub. No hidden prompts, no secret system instructions, no obfuscated behavior. Read the [source](https://github.com/tmdgusya/roach-pi) and see exactly what the agent does.
- **Observable** — The footer displays prompt cache hit rate in real time. See how your context is being utilized, session by session.
- **Transparent by design** — Tools, event hooks, skill injections, and agent prompts are all plain TypeScript and Markdown. No magic.

## Features

### Commands
- **`/setup`**: **Run this first.** Configures `quietStartup: true` and sets up the ROACH PI banner.
- **`/clarify`**: The agent asks dynamic, context-aware questions one at a time to resolve ambiguity. It generates questions and choices on the fly based on your request, while exploring the codebase via subagents in parallel. Ends with a structured Context Brief.
- **`/plan`**: Delegates to the agent in strict agentic-plan-crafting mode, ensuring executable implementation plans with no placeholders.
- **`/ultraplan`**: The agent dispatches all 5 reviewer perspectives (Feasibility, Architecture, Risk, Dependency, User Value) in parallel via the subagent tool, then synthesizes findings into a milestone DAG.
- **`/ask`**: Manual test command for the `ask_user_question` tool.
- **`/reset-phase`**: Resets the workflow phase to idle.
- **`/loop <interval> <prompt>`**: Schedule a recurring prompt at fixed intervals (`5s`, `10m`, `2h`, `1d`). Cron-style — fires on schedule regardless of execution state.
- **`/loop-stop [job-id]`**: Stop a specific loop job. Interactive selector if no ID given.
- **`/loop-list`**: List all active loop jobs with run counts, error counts, and timing.
- **`/loop-stop-all`**: Stop all active loop jobs (with confirmation).

### Tools
- **`ask_user_question`**: The agent calls this autonomously whenever it encounters ambiguity — generating questions and choices dynamically based on context.
- **`subagent`**: Delegates tasks to specialized agents running as separate `pi` processes. Supports three execution modes:
  - **Single**: One-off investigation or exploration tasks
  - **Parallel**: Dispatch multiple independent agents concurrently (max 8 tasks, 4 concurrent)
  - **Chain**: Sequential pipeline where each step uses `{previous}` to reference prior output

### Session Loop

A session-scoped job scheduler for recurring tasks. Up to 100 concurrent jobs with per-job error isolation, `AbortController`-based cooperative cancellation, and automatic cleanup on session shutdown.

```bash
# Check git status every 5 minutes
/loop 5m check git status and report changes

# Monitor dev server every 30 seconds
/loop 30s verify the dev server is running on port 3000

# View active jobs
/loop-list

# Stop all jobs
/loop-stop-all
```

Key properties:
- **Session-scoped**: Jobs are automatically cleaned up when the session ends. No persistence.
- **Error-isolated**: One failing job does not affect others.
- **Timeout-protected**: Jobs timeout at `max(interval × 2, 60s)` to prevent hangs.
- **Queue-safe**: Uses `deliverAs: 'followUp'` so loop prompts queue correctly even during active agent turns.

### Event Handlers
- **`resources_discover`**: Registers `~/engineering-discipline/skills/` so the agent has access to agentic-clarification, agentic-plan-crafting, and agentic-milestone-planning skill rules.
  - Compatibility mode (default): skills are merged with existing discovered skills.
  - If duplicate skill names exist, the first discovered skill is kept (extension override is not guaranteed).
- **`before_agent_start`**: Injects workflow phase guidance into the system prompt so the agent stays on track during `/clarify`, `/plan`, or `/ultraplan` sessions.

## Subagent System

The extension includes a built-in subagent system that spawns `pi` CLI subprocesses (`pi --mode json -p --no-session`).

### Agent Discovery

Agents are `.md` files with YAML frontmatter:

```markdown
---
name: scout
description: Fast reconnaissance agent
model: haiku
tools: read,glob,grep
---
You are a fast scout agent. Explore the codebase quickly and report key findings.
```

Agent locations:
- **User agents**: `~/.pi/agent/agents/*.md`
- **Project agents**: `.pi/agents/*.md` (overrides user agents of the same name)

## Observability

The footer displays real-time metrics during every session:

- **Cache hit rate** — prompt cache utilization per session
- **Context usage bar** — how much of the context window is used
- **Active tools** — which tools are currently running
- **Branch, model, directory** — at a glance

Everything the agent does is inspectable. No hidden behavior.

## Development

1. Clone the repository:
   ```bash
   git clone https://github.com/tmdgusya/pi-engineering-discipline-extension.git ~/.pi/agent/extensions/agentic-harness
   ```
2. Install dependencies:
   ```bash
   cd ~/.pi/agent/extensions/agentic-harness/extensions/agentic-harness
   npm install
   ```
3. Type `/reload` in the `pi` terminal to apply changes.

## Testing

```bash
cd extensions/agentic-harness
npm test
```

67 tests covering tool registration, command delegation, event handlers, ask_user_question behavior, agent discovery, subagent execution helpers, and concurrency control.

## Open Source

This project is [MIT licensed](https://github.com/tmdgusya/roach-pi/blob/main/LICENSE). Every component — tools, agents, skills, event hooks — is open source and auditable. [Read the source](https://github.com/tmdgusya/roach-pi).

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. **Feature proposals must be discussed on [GitHub Discussions](https://github.com/tmdgusya/roach-pi/discussions) before implementation.**

## License
MIT
