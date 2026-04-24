# Milestones: pi-subagents Selective Adoption

## M1 — Baseline Contracts and Frontmatter Foundation
Dependencies: none.

Success criteria:
- AgentConfig supports optional `maxOutput`, `maxSubagentDepth`, `output`, `defaultReads`, `defaultProgress`, `context`, and `worktree` fields.
- Frontmatter parser remains dependency-free and preserves existing `name`, `description`, `tools`, and `model` behavior.
- Parser handles quoted strings, numbers, booleans, comma arrays, and bracket string arrays for known fields.

## M2 — Safe Output and Delegation Limits
Dependencies: M1.

Success criteria:
- Tool-level or agent-level `maxOutput` truncates parent model-facing summaries.
- Truncation metadata records original length, returned length, and applied max.
- Agent-level `maxSubagentDepth` can only tighten inherited delegation depth.

## M3 — Run Artifact Directory
Dependencies: M1.

Success criteria:
- Runs can create a stable artifact directory.
- Result metadata exposes artifact paths additively.
- Existing calls without artifact options remain compatible.

## M4 — File-Based IO
Dependencies: M3.

Success criteria:
- `output`, `reads`, and `progress` are supported via tool options and agent defaults.
- Child prompts clearly instruct reads/writes/progress paths.
- Parent validates output/progress artifacts and reports metadata.

## M5 — Session Context Modes
Dependencies: M1, M2.

Success criteria:
- `context: "fresh"` preserves current `--no-session` behavior.
- `context: "fork"` uses Pi `--fork` when a parent/fork source is available.
- Unsupported fork mode fails fast without silent downgrade.

## M6 — Parallel Worktree Isolation
Dependencies: M3, M4.

Success criteria:
- `worktree: true` is opt-in for parallel tasks.
- Each task runs in its own git worktree.
- Cleanup and diff capture happen on success/failure.

## M7 — Public Schema, Rendering, and Compatibility
Dependencies: M1–M6.

Success criteria:
- Tool schema exposes supported options.
- Rendering displays truncation/artifact/context/worktree metadata.
- Existing discipline workflows continue to work.

## M_final — Integration Verification
Dependencies: M7.

Success criteria:
- `cd extensions/agentic-harness && npm ci && npm run build && npm test` passes.
- Non-goal audit passes.
