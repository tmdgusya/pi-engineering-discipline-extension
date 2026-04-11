# ROACH PI Architecture

This note captures the current high-level architecture of the ROACH PI extension suite.

Files added here:
- `docs/architecture/roach-pi-high-level.excalidraw` — editable Excalidraw source
- `docs/architecture/README.md` — this summary

## What the diagram shows

1. `pi` runtime is the host surface.
   - It provides the tool registry, command registry, event lifecycle, and TUI surface.
2. ROACH PI is an extension suite layered on top of that runtime.
   - `agentic-harness` is the orchestration core.
   - `session-loop` adds session-scoped recurring jobs.
   - `autonomous-dev` adds a GitHub issue processing engine.
3. The main reusable execution primitive is the spawned child `pi` process.
   - `agentic-harness` uses it for subagents.
   - `autonomous-dev` uses it for issue workers.
4. Bundled agents and skills are plain Markdown assets.
   - Agents live under `extensions/agentic-harness/agents/`
   - Skills live under `extensions/agentic-harness/skills/`
5. Observability and local state are first-class concerns.
   - workflow state file: `~/.pi/extension-state.json`
   - autonomous-dev log: `~/.pi/autonomous-dev.log`
   - footer / status / widget UI surfaces are part of the runtime behavior

## Key file map

### Extension entrypoints
- `package.json`
- `extensions/agentic-harness/index.ts`
- `extensions/session-loop/index.ts`
- `extensions/autonomous-dev/index.ts`

### Agentic harness internals
- `extensions/agentic-harness/subagent.ts`
- `extensions/agentic-harness/agents.ts`
- `extensions/agentic-harness/footer.ts`
- `extensions/agentic-harness/state.ts`
- `extensions/agentic-harness/webfetch/`

### Session loop
- `extensions/session-loop/scheduler.ts`
- `extensions/session-loop/commands.ts`

### Autonomous dev
- `extensions/autonomous-dev/orchestrator.ts`
- `extensions/autonomous-dev/github.ts`
- `extensions/autonomous-dev/logger.ts`
- `extensions/autonomous-dev/agents/autonomous-dev-worker.md`

## Editing

- Open the local `.excalidraw` file in https://excalidraw.com by importing the file.
- Shareable online view: https://excalidraw.com/#json=oVHGws8WgbCFib2A6ANW3,j-HgCZDcQrEwE93BQ_Gs0g
- Source of truth in the repo: `docs/architecture/roach-pi-high-level.excalidraw`
