# Pi Engineering Discipline Extension

An advanced extension for the [pi coding agent](https://github.com/badlogic/pi-mono), designed to bring strict engineering discipline and agentic orchestration to your workflow. 

Instead of relying solely on chat prompts, this extension provides deterministic TUI (Terminal UI) dashboards and actual parallel sub-agent execution for complex tasks like milestone planning and clarification loops.

## Features

- **`/clarify`**: Replaces messy chat loops with a native TUI questionnaire to gather your Goal, Scope, and Constraints before intelligently exploring the codebase.
- **`/plan`**: Forces the agent into strict plan-crafting mode, ensuring no placeholders or vague tasks are left behind.
- **`/ultraplan`**: Spawns **5 real parallel `pi` sub-agents** (Security, Architecture, Data Flow, Edge Cases, UX & State) to independently review your codebase. It features a beautiful live dashboard showing real-time spinner animations and status updates, synthesizing the results into a final milestone DAG when complete.

## Prerequisites

This extension relies on the core engineering discipline instructions (the LLM rulesets) to function correctly. **Before using this extension**, please ensure you have the core skills installed in your workspace or globally.

You can find the required skills repository here:
👉 **[tmdgusya/engineering-discipline](https://github.com/tmdgusya/engineering-discipline)**

*(If these skills are not installed, the LLM will not understand what the "plan-crafting" or "ultraplan" rules are when the extension triggers them).*

## Installation

You can install this extension globally for `pi` using the built-in package manager directly from this GitHub repository:

```bash
pi install git:github.com/tmdgusya/pi-engineering-discipline-extension
```

*Note: This will automatically add the extension to your global `pi` settings and load it on your next session.*

## Usage

Start your `pi` agent in interactive mode as usual:

```bash
pi
```

Then, trigger the interactive workflows by typing the slash commands:

1. Type `/clarify` to define the parameters of a vague feature request.
2. Type `/plan` to convert the generated Context Brief into an executable implementation plan.
3. Type `/ultraplan` for complex features to launch the parallel multi-agent review dashboard.

## Development

If you want to modify this extension locally:

1. Clone the repository into your global pi extensions folder:
   ```bash
   git clone https://github.com/tmdgusya/pi-engineering-discipline-extension.git ~/.pi/agent/extensions/agentic-harness
   ```
2. Install dependencies:
   ```bash
   cd ~/.pi/agent/extensions/agentic-harness
   npm install
   ```
3. The extension will automatically be discovered by `pi`. If you make changes while `pi` is running, just type `/reload` in the `pi` terminal to apply them instantly.

## Testing

This extension includes a Vitest suite to verify parallel sub-agent spawning and TUI handoffs:

```bash
npm run test
```
