# Pi Engineering Discipline Extension

An advanced extension for the [pi coding agent](https://github.com/badlogic/pi-mono), designed to bring strict engineering discipline and agentic orchestration to your workflow.

The agent dynamically generates questions, selects reviewers, and drives workflow phases autonomously — no hardcoded templates or fixed question sets.

## Installation

```bash
pi install git:github.com/tmdgusya/pi-engineering-discipline-extension
```

## Features

### Commands
- **`/clarify`**: The agent asks dynamic, context-aware questions one at a time to resolve ambiguity. It generates questions and choices on the fly based on your request, while exploring the codebase via subagents in parallel. Ends with a structured Context Brief.
- **`/plan`**: Delegates to the agent in strict plan-crafting mode, ensuring executable implementation plans with no placeholders.
- **`/ultraplan`**: The agent dispatches all 5 reviewer perspectives (Feasibility, Architecture, Risk, Dependency, User Value) in parallel via the subagent tool, then synthesizes findings into a milestone DAG.
- **`/ask`**: Manual test command for the `ask_user_question` tool.
- **`/reset-phase`**: Resets the workflow phase to idle.

### Tools
- **`ask_user_question`**: The agent calls this autonomously whenever it encounters ambiguity — generating questions and choices dynamically based on context.
- **`subagent`**: Delegates tasks to specialized agents running as separate `pi` processes. Supports three execution modes:
  - **Single**: One-off investigation or exploration tasks
  - **Parallel**: Dispatch multiple independent agents concurrently (max 8 tasks, 4 concurrent)
  - **Chain**: Sequential pipeline where each step uses `{previous}` to reference prior output

### Event Handlers
- **`resources_discover`**: Registers `~/engineering-discipline/skills/` so the agent has access to clarification, plan-crafting, and milestone-planning skill rules.
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

## Prerequisites

This extension relies on the core engineering discipline skills (the LLM rulesets). **Before using this extension**, install the skills:

👉 **[tmdgusya/engineering-discipline](https://github.com/tmdgusya/engineering-discipline)**

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

32 tests covering tool registration, command delegation, event handlers, ask_user_question behavior, agent discovery, subagent execution helpers, and concurrency control.

## License
MIT
