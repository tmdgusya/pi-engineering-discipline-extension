# Checkpoint: M_final — Selective pi-subagents Adoption

**Completed:** 2026-04-24
**Attempts:** 2 verification runs; first full `npm ci && build && test` exposed a flaky/real semantic-abort race that was fixed.

## Scope Completed
- Dependency-free frontmatter parser improvements and extended `AgentConfig` fields.
- Model-facing `maxOutput` truncation with metadata.
- Agent-level `maxSubagentDepth` propagated as a stricter child delegation cap.
- Artifact directory foundation plus `output` / `reads` / `progress` file IO prompt contract.
- `context: "fresh" | "fork"` launch modes, with fork fail-fast when `PI_SUBAGENT_FORK_SESSION` is unavailable.
- Opt-in parallel worktree isolation via `worktree: true`, diff capture, and cleanup metadata.
- Rendering for truncation/artifact/context/worktree metadata.
- Targeted tests for parser, truncation, artifacts, rendering metadata, and worktree helpers.

## Review Results
Parallel code review completed with 5 reviewers:
- reviewer-bug
- reviewer-security
- reviewer-performance
- reviewer-test-coverage
- reviewer-consistency

Findings addressed:
- `maxOutput` now hard-caps returned text length, including marker/separator overhead.
- Declared `reads` resolve relative to `cwd` and cannot escape the workspace.
- Artifact `output`/`progress` paths are run-dir-relative only and cannot escape via absolute paths, `~`, or `..` traversal.
- Declared reads and artifact output reads are bounded instead of full-file reads.
- Worktree diffs use non-binary capped capture and include stat metadata.
- Agent frontmatter `worktree` is honored as a default.
- Rendering and invalid frontmatter boundary tests were added.
- Semantic abort-after-agent_end race was fixed by recognizing buffered semantic completion after termination.

## Test Results
Final command:

```bash
cd extensions/agentic-harness && npm ci && npm run build && npm test
```

Result:
- `npm ci`: completed successfully; existing audit reported 8 vulnerabilities unrelated to this change set.
- `npm run build`: PASS (`tsc --noEmit`).
- `npm test`: PASS — 29 test files, 262 tests.

## Files Changed
- `extensions/agentic-harness/agents.ts`
- `extensions/agentic-harness/types.ts`
- `extensions/agentic-harness/subagent.ts`
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/render.ts`
- `extensions/agentic-harness/artifacts.ts`
- `extensions/agentic-harness/worktree.ts`
- `extensions/agentic-harness/tests/agents.test.ts`
- `extensions/agentic-harness/tests/types.test.ts`
- `extensions/agentic-harness/tests/render.test.ts`
- `extensions/agentic-harness/tests/artifacts.test.ts`
- `extensions/agentic-harness/tests/worktree.test.ts`
- `docs/engineering-discipline/context/2026-04-24-pi-subagents-selective-adoption-brief.md`
- `docs/engineering-discipline/harness/pi-subagents-selective-adoption/state.md`
- `docs/engineering-discipline/harness/pi-subagents-selective-adoption/milestones/milestones.md`
- `docs/engineering-discipline/harness/pi-subagents-selective-adoption/checkpoints/M-final-checkpoint.md`
- `tasks/todo.md`

## Non-goal Audit
- No `nicobailon/pi-subagents` package dependency added.
- No new third-party runtime dependency added.
- No Model Fallback behavior added.
- No Agents Manager TUI/CRUD, MCP direct tool layer, Intercom bridge, Gist sharing, or async/background framework added.
