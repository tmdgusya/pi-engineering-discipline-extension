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
- **`/review [target]`**: Single-pass code review of current changes across 5 dimensions (bugs, security, performance, test coverage, consistency). No subagents — the current agent reads the diff and produces an integrated review directly. Target is optional; if omitted, auto-detects PR or local diff vs `main`.
- **`/ultrareview [target]`**: Deep 3-stage code review pipeline. Stage 1 dispatches 10 subagents in parallel (5 reviewer roles × 2 seeds). Stage 2 runs `reviewer-verifier` to dedupe findings and filter false positives. Stage 3 runs `review-synthesis` to produce the final structured report, saved to `docs/engineering-discipline/reviews/YYYY-MM-DD-<topic>-review.md` with a summary streamed to chat. Mirrors claude-code's `bughunter` pipeline locally (no cloud teleport).
- **`/ask`**: Manual test command for the `ask_user_question` tool.
- **`/reset-phase`**: Resets the workflow phase to idle.
- **`/loop <interval> <prompt>`**: Schedule a recurring prompt at fixed intervals (`5s`, `10m`, `2h`, `1d`). Cron-style — fires on schedule regardless of execution state.
- **`/loop-stop [job-id]`**: Stop a specific loop job. Interactive selector if no ID given.
- **`/loop-list`**: List all active loop jobs with run counts, error counts, and timing.
- **`/loop-stop-all`**: Stop all active loop jobs (with confirmation).
- **`/fff-mode both|tools-only`**: Switch FFF integration mode. `both` overrides search tools and `@` autocomplete. `tools-only` keeps only the tool overrides.
- **`/fff-health`**: Show FFF engine status, indexed file count, git detection, and frecency/query tracker health.
- **`/fff-rescan`**: Trigger an explicit FFF file rescan for the current working tree.

### Tools
- **`ask_user_question`**: The agent calls this autonomously whenever it encounters ambiguity — generating questions and choices dynamically based on context.
- **`subagent`**: Delegates tasks to specialized agents running as separate `pi` processes. Supports three execution modes:
  - **Single**: One-off investigation or exploration tasks
  - **Parallel**: Dispatch multiple independent agents concurrently (max 12 tasks, 10 concurrent)
  - **Chain**: Sequential pipeline where each step uses `{previous}` to reference prior output
- **FFF-backed search overrides**:
  - **`find`** → FFF fuzzy file search with ranking and git-aware indexing
  - **`grep`** → FFF content search with pagination and smart-case behavior
  - **`multi_grep`** → multi-pattern OR search through the FFF engine

### FFF Search Engine

ROACH PI now includes an embedded FFF-powered search extension under `extensions/fff-search`.

What it changes:
- replaces the built-in `find` and `grep` tools with FFF-backed implementations
- adds `multi_grep` for multi-pattern OR search
- stores frecency and query history under `~/.pi/agent/fff/`
- initializes a native `FileFinder` instance at session start for the current working directory
- falls back to built-in `find` / `grep` behavior if the native FFF layer is unavailable or fails to initialize for the current workspace

Operational modes:
- **`both`** — override tools and replace `@` file autocomplete suggestions
- **`tools-only`** — override tools only, keep pi's default autocomplete

### Code Review (`/review` and `/ultrareview`)

Both commands accept the same three target forms. The target argument is validated against a safe-character allowlist (`a–z`, `A–Z`, `0–9`, `.`, `-`, `_`, `/`, `:`) before being interpolated into any shell command — shell metacharacters (`;`, `|`, `&`, `$`, backticks, quotes, whitespace, etc.) are rejected with a clear error.

**Input forms:**

```bash
# No argument — auto-detect. If the current branch has an open PR,
# uses `gh pr diff <number>`. Otherwise falls back to
# `git diff main...HEAD` plus uncommitted changes.
/review
/ultrareview

# PR number — fetched via `gh pr diff <number>`.
/review 27
/ultrareview 27

# PR URL — the full GitHub URL works the same as a number, because
# `gh pr diff` accepts both interchangeably.
/review https://github.com/tmdgusya/roach-pi/pull/27
/ultrareview https://github.com/tmdgusya/roach-pi/pull/27

# Branch name — diffed against main with `git diff main...<branch>`.
/review feature/add-auth-flow
/ultrareview feature/add-auth-flow
```

**When to use which:**

- **`/review`** — quick sanity check. No confirmation dialog, no file saved, a single integrated review is streamed to chat. Good for iterating on a PR before requesting a deeper pass.
- **`/ultrareview`** — deep review. Asks for confirmation before dispatching 10 subagents (this takes several minutes). The final report is saved under `docs/engineering-discipline/reviews/` and a top-5 summary is streamed to chat. Use before merging non-trivial changes.

**Rejected inputs:**

```bash
/review 27; rm -rf /            # rejected: contains `;` and whitespace
/review "27"                    # rejected: contains double quotes
/review $(whoami)               # rejected: contains `$` and `(`/`)`
```

These all produce an `Invalid review target` error notification and no prompt is dispatched. For `/ultrareview`, validation runs **before** the confirmation dialog so you are never asked to confirm a run that would fail.

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

### Autonomous Dev Engine (Experimental)

An autonomous GitHub issue processing engine that polls issues labeled `autonomous-dev:ready`, implements them using the agentic pipeline, and creates pull requests.

> ⚠️ **Experimental** — Requires `PI_AUTONOMOUS_DEV=1` environment variable.

```bash
export PI_AUTONOMOUS_DEV=1
```

The engine runs inside the TUI and exposes a compact persistent HUD in the footer and a below-editor widget so you can see:
- current engine state
- current activity
- recent worker activity history
- active issue context
- whether a worker/subagent is actively running

Busy worker activity is shown as a green indicator, idle polling/tracking is orange, and stopped is red.

#### Label Protocol

| Label | Meaning |
|-------|---------|  
| `autonomous-dev:ready` | Issue queued for processing |
| `autonomous-dev:in-progress` | Being implemented |
| `autonomous-dev:needs-clarification` | Awaiting author response |
| `autonomous-dev:completed` | PR created |
| `autonomous-dev:failed` | Could not complete |

#### Commands

- **`/autonomous-dev start [repo]`** — Start the engine. Prefer an explicit full GitHub repo slug like `owner/repo` (for example `tmdgusya/roach-pi`). If omitted, the engine tries to detect the current directory's GitHub remote.
- **`/autonomous-dev stop`** — Stop the engine and abort in-flight autonomous worker execution for the current session.
- **`/autonomous-dev status`** — Show current status, including recent activity, last poll/error timestamps, active worker count, and log file path.
- **`/autonomous-dev poll`** — Trigger one poll cycle

Example:

```bash
/autonomous-dev start tmdgusya/roach-pi
```

#### Runtime Notes

- The worker reuses the active session's model/provider configuration. If the current session is not authenticated for its selected provider, `/autonomous-dev start` may fail during worker preflight or worker launch.
- The engine writes structured JSONL logs to `~/.pi/autonomous-dev.log` by default. Override with `PI_AUTONOMOUS_DEV_LOG_PATH` if needed.
- Poll discovery and GitHub integration are observable through `/autonomous-dev status` and the log file.

#### Tools

- **`gh_issue_list`** — List issues with optional label filter
- **`gh_issue_read`** — Read an issue with all comments
- **`gh_issue_comment`** — Post a comment on an issue
- **`gh_label`** — Add or remove labels
- **`gh_pr_create`** — Create a pull request

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
npm test
```

253 tests covering tool registration, command delegation, event handlers, ask_user_question behavior, agent discovery, subagent execution helpers, concurrency control, autonomous-dev GitHub client, and orchestrator.

## Open Source

This project is [MIT licensed](https://github.com/tmdgusya/roach-pi/blob/main/LICENSE). Every component — tools, agents, skills, event hooks — is open source and auditable. [Read the source](https://github.com/tmdgusya/roach-pi).

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. **Feature proposals must be discussed on [GitHub Discussions](https://github.com/tmdgusya/roach-pi/discussions) before implementation.**

## License
MIT
