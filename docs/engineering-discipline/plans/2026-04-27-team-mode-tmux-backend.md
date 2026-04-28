# Team Mode tmux Backend Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Add an optional tmux-backed `team` execution path that automatically uses tmux when available, falls back to the current native backend when it is not, and exposes enough session metadata for operators to attach to worker panes interactively.

**Architecture:** Preserve the current JSON-driven native team runtime as the compatibility baseline. Add a second execution backend for worker launches that runs each worker inside a tmux session/pane while still emitting newline-delimited JSON that the harness can parse from a tee'd pane log. Keep operator interaction out-of-band through tmux attach commands instead of introducing a new in-process keystroke/control protocol.

**Tech Stack:** TypeScript, Node.js child processes, tmux CLI, Vitest, existing pi JSON runner.

**Work Scope:**
- **In scope:** backend selection (`auto`/`native`/`tmux`) for team mode, tmux availability detection, tmux-backed worker launch/session metadata, persisted attach information in team run state, summary/docs/test updates, and automatic fallback to native mode when tmux is unavailable.
- **Out of scope:** in-pi live keystroke routing to workers, pane embedding inside pi TUI, changing generic `subagent` parallel mode to use tmux by default, and cross-platform terminal multiplexers other than tmux.

**Success Criteria:**
- Team mode defaults to `auto` backend selection and uses tmux only when the binary is available.
- When tmux is used, each worker has persisted session/pane metadata plus an attach command visible in summaries/state.
- When tmux is unavailable or explicitly disabled, existing team behavior still works unchanged.
- Worker JSON output is still parsed into `SingleResult` summaries under both backends.
- The extension test suite and build pass.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** the TypeScript build passes, the team/subagent/tmux integration tests pass, and existing extension regressions remain covered.

---

## File Structure Mapping

### New files
- `extensions/agentic-harness/tmux.ts` — tmux backend helpers: availability detection, session naming, pane orchestration, attach command formatting, pane log piping, cleanup helpers.
- `extensions/agentic-harness/tests/tmux.test.ts` — unit tests for tmux helper behavior and command construction.

### Modified files
- `extensions/agentic-harness/team.ts` — team backend selection, backend-used summary fields, terminal/session metadata propagation.
- `extensions/agentic-harness/team-state.ts` — persisted team options/session metadata additions.
- `extensions/agentic-harness/subagent.ts` — optional tmux execution mode for worker launch while preserving JSON event parsing and native mode.
- `extensions/agentic-harness/index.ts` — team tool schema additions and runtime wiring for backend selection.
- `extensions/agentic-harness/types.ts` — result metadata for terminal/tmux session details.
- `extensions/agentic-harness/README.md` — document tmux backend behavior, fallback semantics, and deferred capabilities.
- `extensions/agentic-harness/tests/team.test.ts` — team runtime contract tests.
- `extensions/agentic-harness/tests/subagent-process.test.ts` — execution-mode process tests.
- `extensions/agentic-harness/tests/extension.test.ts` — team tool registration/schema tests.

## Project Capability Discovery

- **Bundled agents available:** `explorer`, `worker`, `planner`, `plan-compliance`, `plan-worker`, `plan-validator`, plus review agents.
- **Relevant skill for execution after planning:** `agentic-run-plan`.
- **Useful verification surface already present:** `tests/team.test.ts`, `tests/subagent-process.test.ts`, `tests/extension.test.ts`, plus the full `npm test` suite.

## Task Decomposition

### Task 1: Lock the public team backend contract

**Dependencies:** None (must run first; later tasks depend on these interfaces)
**Files:**
- Modify: `extensions/agentic-harness/team.ts`
- Modify: `extensions/agentic-harness/team-state.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/types.ts`
- Modify: `extensions/agentic-harness/tests/team.test.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add failing contract tests for backend selection and persisted metadata**

Add assertions to `extensions/agentic-harness/tests/team.test.ts` that expect:

```ts
expect(summary.backendRequested).toBe("auto");
expect(summary.backendUsed).toBe("native");
expect(summary.tasks[0].terminal).toMatchObject({
  backend: "native",
});
```

Add assertions to `extensions/agentic-harness/tests/extension.test.ts` that expect the `team` tool schema to expose:

```ts
backend: Type.Optional(Type.Unsafe<"auto" | "native" | "tmux">({
  type: "string",
  enum: ["auto", "native", "tmux"],
  description: "Execution backend selection for team workers. auto prefers tmux when available.",
}))
```

- [ ] **Step 2: Run the targeted tests and confirm they fail before implementation**

Run: `cd extensions/agentic-harness && npm test -- --run tests/team.test.ts tests/extension.test.ts`
Expected: FAIL with missing `backendRequested` / `backendUsed` / `terminal` metadata and missing `backend` schema option.

- [ ] **Step 3: Implement the backend-selection contract in runtime types and team state**

Update `extensions/agentic-harness/team.ts` to introduce the public contract:

```ts
export type TeamBackend = "auto" | "native" | "tmux";
export type ResolvedTeamBackend = "native" | "tmux";

export interface TeamTerminalMetadata {
  backend: ResolvedTeamBackend;
  sessionName?: string;
  windowName?: string;
  paneId?: string;
  attachCommand?: string;
}
```

Extend `TeamRunOptions`, `TeamRunSummary`, and `TeamTask` to carry:

```ts
backend?: TeamBackend;
backendRequested: TeamBackend;
backendUsed: ResolvedTeamBackend;
terminal?: TeamTerminalMetadata;
```

Update `extensions/agentic-harness/team-state.ts` so `TeamRunOptionsSnapshot` persists `backend`, and keep serialization backward-compatible by leaving new fields optional on read.

Update `extensions/agentic-harness/types.ts` to add terminal metadata on `SingleResult`:

```ts
export interface TerminalMetadata {
  backend: "native" | "tmux";
  sessionName?: string;
  windowName?: string;
  paneId?: string;
  attachCommand?: string;
  logFile?: string;
}
```

- [ ] **Step 4: Wire the `team` tool schema to accept the new backend option**

Update `extensions/agentic-harness/index.ts` so `TeamParams` includes:

```ts
backend: Type.Optional(Type.Unsafe<"auto" | "native" | "tmux">({
  type: "string",
  enum: ["auto", "native", "tmux"],
  description: "Execution backend selection for team workers. auto prefers tmux when available.",
}))
```

Pass `backend` through the `runTeam(...)` call.

- [ ] **Step 5: Re-run the targeted contract tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/team.test.ts tests/extension.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/team.ts extensions/agentic-harness/team-state.ts extensions/agentic-harness/index.ts extensions/agentic-harness/types.ts extensions/agentic-harness/tests/team.test.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "feat: add team backend selection contract"
```

### Task 2: Add a tmux helper module with deterministic command construction

**Dependencies:** Runs after Task 1 completes
**Files:**
- Create: `extensions/agentic-harness/tmux.ts`
- Create: `extensions/agentic-harness/tests/tmux.test.ts`

- [ ] **Step 1: Write failing unit tests for tmux detection, naming, and attach metadata**

Add tests in `extensions/agentic-harness/tests/tmux.test.ts` covering helpers equivalent to:

```ts
expect(buildTmuxSessionName("team-demo")).toBe("pi-team-demo");
expect(buildAttachCommand({ sessionName: "pi-team-demo" })).toBe("tmux attach -t pi-team-demo");
expect(parseTmuxAvailability("/opt/homebrew/bin/tmux\n")).toEqual({ available: true, binary: "/opt/homebrew/bin/tmux" });
expect(parsePaneIds("%1\n%2\n")).toEqual(["%1", "%2"]);
```

Mock tmux command execution so the tests can validate command strings without requiring tmux on CI.

- [ ] **Step 2: Run the new helper tests and confirm they fail**

Run: `cd extensions/agentic-harness && npm test -- --run tests/tmux.test.ts`
Expected: FAIL because `tmux.ts` does not exist yet.

- [ ] **Step 3: Implement tmux helper functions in a new module**

Create `extensions/agentic-harness/tmux.ts` with helpers that follow this shape:

```ts
export interface TmuxAvailability {
  available: boolean;
  binary?: string;
}

export interface TmuxPaneRef {
  sessionName: string;
  windowName: string;
  paneId: string;
  attachCommand: string;
  logFile: string;
}

export async function detectTmux(commandRunner = execFile): Promise<TmuxAvailability> { /* use `command -v tmux` or `which tmux` */ }
export function buildTmuxSessionName(runId: string): string { /* stable sanitized name */ }
export function buildAttachCommand(ref: { sessionName: string }): string { return `tmux attach -t ${ref.sessionName}`; }
export async function createWorkerPanes(...): Promise<TmuxPaneRef[]> { /* new-session + split-window + pipe-pane */ }
export async function killTmuxSession(...): Promise<void> { /* best-effort cleanup */ }
```

Require the helper to:
- sanitize run IDs into tmux-safe names
- create a detached session for task 1
- add panes for remaining tasks with `split-window`
- install `pipe-pane` logging for each pane
- return pane IDs and attach command text deterministically

- [ ] **Step 4: Re-run the helper tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/tmux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/tmux.ts extensions/agentic-harness/tests/tmux.test.ts
git commit -m "feat: add tmux helper module for team backend"
```

### Task 3: Integrate the tmux backend into worker execution and team summaries

**Dependencies:** Runs after Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/team.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/types.ts`
- Modify: `extensions/agentic-harness/tests/subagent-process.test.ts`
- Modify: `extensions/agentic-harness/tests/team.test.ts`

- [ ] **Step 1: Add failing runtime tests for tmux execution and auto fallback**

In `extensions/agentic-harness/tests/subagent-process.test.ts`, add tests that mock the tmux helper and expect behavior equivalent to:

```ts
expect(result.terminal).toMatchObject({
  backend: "tmux",
  sessionName: "pi-team-run-1",
  attachCommand: "tmux attach -t pi-team-run-1",
});
expect(result.messages.at(-1)?.content?.[0]?.text).toContain("done");
```

In `extensions/agentic-harness/tests/team.test.ts`, add tests that expect:

```ts
expect(summary.backendRequested).toBe("auto");
expect(summary.backendUsed).toBe("tmux");
expect(summary.tasks.every((task) => task.terminal?.backend === "tmux")).toBe(true);
expect(summary.finalSynthesis).toContain("tmux attach -t");
```

Add a second test that forces tmux unavailability and expects `backendUsed === "native"` with otherwise unchanged team success behavior.

- [ ] **Step 2: Run the targeted runtime tests and confirm they fail**

Run: `cd extensions/agentic-harness && npm test -- --run tests/subagent-process.test.ts tests/team.test.ts`
Expected: FAIL because no tmux execution path or fallback selection exists yet.

- [ ] **Step 3: Add an execution-mode branch to `runAgent(...)`**

Update `extensions/agentic-harness/subagent.ts` to introduce an optional execution mode:

```ts
export interface RunAgentOptions {
  executionMode?: "native" | "tmux";
  tmuxPane?: {
    sessionName: string;
    windowName: string;
    paneId: string;
    logFile: string;
    attachCommand: string;
  };
}
```

Implement the branch so that:
- `native` mode preserves the current `spawn(... stdio: ["pipe","pipe","pipe"])` path unchanged
- `tmux` mode launches the same pi command inside the provided pane using the tmux helper
- worker JSON output is read from the pane log file and processed through `processPiJsonLine(...)`
- `result.terminal` is populated for both modes (`backend: "native"` or `"tmux"`)
- semantic completion still depends on agent-end/child-exit handling, not on raw pane text alone

- [ ] **Step 4: Resolve team backend selection and session metadata in `runTeam(...)`**

Update `extensions/agentic-harness/team.ts` to add a resolver equivalent to:

```ts
const requested = opts.backend ?? "auto";
const backendUsed = requested === "tmux"
  ? "tmux"
  : requested === "native"
    ? "native"
    : (await detectTmux()).available ? "tmux" : "native";
```

When `backendUsed === "tmux"`:
- create one tmux session for the run
- create one pane per runnable worker
- assign each task its pane metadata before dispatch
- include attach command/session data in `task.terminal`, persisted state, and final summary text
- best-effort kill the session after completion unless a failing run leaves it behind intentionally for debugging; document the chosen policy in the summary notes

When `backendUsed === "native"`:
- preserve the current task dispatch flow
- still populate `task.terminal = { backend: "native" }`

- [ ] **Step 5: Pass the selected execution mode from the root tool**

Update `extensions/agentic-harness/index.ts` so the `runTask` callback passes:

```ts
runAgent({
  ...,
  executionMode: input.task.terminal?.backend === "tmux" ? "tmux" : "native",
  tmuxPane: input.task.terminal?.backend === "tmux" ? {
    sessionName: input.task.terminal.sessionName!,
    windowName: input.task.terminal.windowName!,
    paneId: input.task.terminal.paneId!,
    logFile: input.task.terminal.logFile!,
    attachCommand: input.task.terminal.attachCommand!,
  } : undefined,
})
```

- [ ] **Step 6: Re-run the targeted runtime tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/subagent-process.test.ts tests/team.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add extensions/agentic-harness/subagent.ts extensions/agentic-harness/team.ts extensions/agentic-harness/index.ts extensions/agentic-harness/types.ts extensions/agentic-harness/tests/subagent-process.test.ts extensions/agentic-harness/tests/team.test.ts
git commit -m "feat: integrate optional tmux backend for team workers"
```

### Task 4: Document the tmux backend and verify root registration behavior

**Dependencies:** Runs after Task 3 completes
**Files:**
- Modify: `extensions/agentic-harness/README.md`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add or update tests for tool-schema wording and fallback semantics**

Extend `extensions/agentic-harness/tests/extension.test.ts` so the `team` tool description/parameters assert the presence of the backend help text and preserve root-only registration behavior.

Expected assertions should include:

```ts
expect(teamTool.parameters.properties.backend.enum).toEqual(["auto", "native", "tmux"]);
expect(teamTool.description).toContain("lightweight native team");
```

- [ ] **Step 2: Run the targeted extension tests and confirm they fail if docs/schema are stale**

Run: `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts`
Expected: FAIL until the tool help text and docs references are updated.

- [ ] **Step 3: Update README documentation**

Revise `extensions/agentic-harness/README.md` so it documents:
- the new `backend` option (`auto`, `native`, `tmux`)
- auto fallback behavior when tmux is unavailable
- how to attach: `tmux attach -t <session>`
- what remains deferred (for example, in-pi pane embedding and direct keystroke routing)

Use concrete wording like:

```md
- `backend: "auto"` (default) prefers tmux when the binary is available and otherwise falls back to the native JSON subprocess backend.
- `backend: "tmux"` requires tmux and records attach metadata for each worker pane.
- Operator interaction happens through tmux attach/switch-pane, not through a new pi-side control channel.
```

- [ ] **Step 4: Re-run the targeted extension tests**

Run: `cd extensions/agentic-harness && npm test -- --run tests/extension.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/README.md extensions/agentic-harness/tests/extension.test.ts
git commit -m "docs: describe team tmux backend and fallback behavior"
```

### Task 5 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run: `cd extensions/agentic-harness && npm run build && npm test`
Expected: ALL PASS

- [ ] **Step 2: Verify plan success criteria**

Manually check each success criterion from the plan header:
- [ ] Team mode defaults to `auto` backend selection and uses tmux only when the binary is available.
- [ ] When tmux is used, each worker has persisted session/pane metadata plus an attach command visible in summaries/state.
- [ ] When tmux is unavailable or explicitly disabled, existing team behavior still works unchanged.
- [ ] Worker JSON output is still parsed into `SingleResult` summaries under both backends.
- [ ] The extension test suite and build pass.

- [ ] **Step 3: Run focused regression coverage for touched areas**

Run: `cd extensions/agentic-harness && npm test -- --run tests/tmux.test.ts tests/team.test.ts tests/subagent-process.test.ts tests/extension.test.ts`
Expected: PASS

## Self-Review

- **Spec coverage:** The plan covers backend contract definition, helper creation, runtime integration, fallback behavior, persisted metadata, docs, and final verification.
- **Placeholder scan:** No `TODO`/`TBD` placeholders remain; every task has exact files, commands, and expected outcomes.
- **Type consistency:** The plan consistently uses `TeamBackend`, `ResolvedTeamBackend`, and `terminal`/`TerminalMetadata` naming across runtime, state, and tests.
- **Dependency verification:** Tasks are sequential because they touch overlapping files (`team.ts`, `index.ts`, `types.ts`, tests). No parallel file conflicts are introduced.
- **Verification coverage:** Includes targeted failing-test steps plus a final build-and-test verification task.

## Execution Handoff

Plan complete and saved to `docs/engineering-discipline/plans/2026-04-27-team-mode-tmux-backend.md`.

How would you like to proceed?

1. Subagent execution (recommended) — dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline execution — execute tasks in this session using the agentic-run-plan skill, batch execution with checkpoints
