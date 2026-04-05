# Pi Engineering Discipline Extensions

A suite of advanced extensions for the [pi coding agent](https://github.com/badlogic/pi-mono), designed to bring strict engineering discipline and agentic orchestration to your workflow.

This repository contains two main extensions:
1. **Agentic Harness**: Orchestrates complex agentic workflows (`/clarify`, `/plan`, `/ultraplan`).
2. **HUD Dashboard**: Real-time status monitoring with secret redaction and context-aware display.

## Installation

You can install this suite globally for `pi` using the built-in package manager:

```bash
pi install git:github.com/tmdgusya/pi-engineering-discipline-extension
```

*Note: This will automatically add both extensions to your global `pi` settings.*

## Extensions

### 1. Agentic Harness
- **`/clarify`**: Native TUI questionnaire to gather Goal, Scope, and Constraints.
- **`/plan`**: Plan-crafting mode to generate executable implementation plans.
- **`/ultraplan`**: Parallel multi-agent review dashboard with live animations.

### 2. HUD Dashboard
- **HUD Interface**: Real-time monitoring of agent status, tools, and metrics.
- **Security**: Automatic redaction of secrets in UI display.
- **Commands**: `/hud-metrics`, `/hud-tools`, `/hud-minimize`, `/hud-reset`, `/hud-status`.

## Prerequisites

These extensions rely on the core engineering discipline instructions (the LLM rulesets). **Before using these**, ensure you have the core skills installed:

👉 **[tmdgusya/engineering-discipline](https://github.com/tmdgusya/engineering-discipline)**

## Development

1. Clone the repository:
   ```bash
   git clone https://github.com/tmdgusya/pi-engineering-discipline-extension.git ~/.pi/agent/extensions/pi-extensions
   ```
2. Install dependencies for the extension you want to work on:
   ```bash
   cd ~/.pi/agent/extensions/pi-extensions/extensions/hud-dashboard
   npm install
   ```

## License
MIT
