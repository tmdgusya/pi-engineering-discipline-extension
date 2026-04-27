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

The `team` tool coordinates a small batch of existing pi subagents from the root session. Use it when a goal can be split into independent worker assignments and you want one synthesized result with explicit verification evidence.

Example tool request:

```json
{
  "goal": "Implement the API client and update its tests",
  "workerCount": 2,
  "agent": "worker",
  "worktree": false,
  "maxOutput": 6000
}
```

MVP behavior:

- Creates a bounded parallel batch of dependency-free task records; it is not a full dependency scheduler.
- Dispatches workers through the existing subagent process runner and preserves the normal subagent depth/cycle safeguards.
- Runs team workers with `PI_TEAM_WORKER=1`, which suppresses recursive orchestration tools such as `team` and `subagent` inside workers.
- Returns per-task status, owner, output summaries, artifact/worktree references when present, and structured verification evidence.
- Reports the run as incomplete/failed when any worker fails; the synthesis must not describe partial work as full success.

Use `subagent` directly for simple one-off parallel dispatch where you do not need team task records, lifecycle status, or final verification synthesis.

### Deferred parity milestones

The lightweight native implementation intentionally defers heavier team-runtime features:

- Persistent team resume and recovery across sessions
- Worker inbox/outbox messaging
- Heartbeat and status monitoring
- Full staged pipelines such as plan → PRD → exec → verify → fix
- tmux-pane worker runtime
- Default worktree-per-worker isolation

These are future parity milestones, not MVP requirements.

### Verification checklist

Before declaring a team-mode change complete, run from `extensions/agentic-harness`:

```bash
npm test
npm run build
```

The test suite should cover task creation, worker prompt guardrails, success/failure synthesis, runtime suppression under `PI_TEAM_WORKER=1`, tool registration, and a fake-runner e2e path. The build must pass with `tsc --noEmit`.

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
npm run test
```

12 tests covering tool registration, command delegation, event handlers, and ask_user_question behavior (free-text, multi-choice, direct input fallback, cancellation).
