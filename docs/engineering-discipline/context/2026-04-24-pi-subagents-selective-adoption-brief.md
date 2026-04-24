# Context Brief: Selective pi-subagents Feature Adoption

## Goal
Adopt selected high-value ideas from `nicobailon/pi-subagents` into `extensions/agentic-harness` without adding supply-chain dependency risk and while excluding Model Fallback.

## Scope
- **In scope**:
  - `maxOutput` / output truncation for subagent results
  - agent-level `maxSubagentDepth`
  - dependency-free frontmatter parser improvements
  - `output` / `reads` / `progress` file-based IO
  - chain/run artifact directory
  - parallel `worktree` isolation
  - `context: "fork"` session mode
- **Out of scope**:
  - Model Fallback
  - depending on `pi-subagents` as a package
  - Agents Manager TUI
  - agent CRUD management actions
  - MCP direct tools
  - Intercom bridge
  - GitHub Gist session sharing
  - full async/background framework

## Technical Context
Current implementation is concentrated in `extensions/agentic-harness`.

- `subagent.ts`
  - Spawns child `pi` processes via `child_process.spawn`
  - Builds CLI args with `--mode json`, `-p`, `--no-session`
  - Propagates depth/cycle env vars
  - Parses child JSON stdout through `runner-events.ts`
  - Handles lifecycle events, abort, semantic agent end, sandbox launch
- `index.ts`
  - Registers the `subagent` tool and orchestrates single/parallel/chain behavior
  - Defines tool schemas for subagent params, task items, and chain items
  - Injects workflow/depth guidance into prompts
- `agents.ts`
  - Discovers bundled/user/project markdown agents
  - Current frontmatter parser is simple `key: value`
  - Currently supports name, description, tools, model
- `types.ts`
  - Defines `SingleResult`, `SubagentDetails`, `UsageStats`
- `render.ts`
  - Has display-level truncation but not model-facing payload truncation

Existing gaps:
- No user-facing `maxOutput` setting or truncation metadata
- No agent-level max depth cap
- Frontmatter parser lacks booleans, numbers, arrays, comments, quoted strings
- No file artifact IO for output/read/progress handoff
- No git worktree isolation for parallel modifying agents
- Child process currently uses `--no-session`; session fork needs design and Pi session API validation

## Constraints
- Avoid new third-party dependencies where possible.
- Do not vendor or depend on the `pi-subagents` package.
- Preserve existing `/clarify`, `/plan`, `/ultraplan`, plan-worker, plan-validator behavior.
- Keep changes incremental and testable.
- Worktree isolation must not leave temp worktrees/branches behind on failure.
- `context: "fork"` must fail fast if fork cannot be created; it must not silently downgrade to `fresh`.

## Success Criteria
- `maxOutput` prevents large subagent results from flooding parent context and exposes truncation metadata.
- Agent markdown frontmatter can express `maxSubagentDepth`, `output`, `defaultReads`, and `defaultProgress` without new YAML dependency.
- Subagent/chain runs can write final output and progress artifacts and read configured files.
- Parallel execution with `worktree: true` gives each parallel task an isolated git worktree and captures per-worktree diffs.
- `context: "fork"` launches children from a real parent session fork when supported, with explicit failure otherwise.
- Existing behavior remains backward-compatible.
- Verification passes: `cd extensions/agentic-harness && npm ci && npm run build && npm test`.

## Verification Strategy
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm ci && npm run build && npm test`
- **What it validates:** extension-local dependencies, strict TypeScript compilation, and the full Vitest behavior suite for agentic harness.

## Complexity Assessment
| Signal | Score |
|---|---:|
| Scope breadth | 3 |
| File impact | 3 |
| Interface boundaries | 3 |
| Dependency depth | 3 |
| Risk surface | 3 |

**Score:** 15
**Verdict:** Complex
**Rationale:** Output truncation and frontmatter support are moderate, but worktree isolation and session fork affect process execution, repo state, and session semantics.

## Suggested Next Step
Proceed to `agentic-milestone-planning` — this requires milestone decomposition before implementation.
