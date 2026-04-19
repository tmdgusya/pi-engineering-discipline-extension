# Phase State Multi-Session Isolation Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Eliminate cross-session phase contamination and stop phase guidance from leaking into unrelated skill invocations and subagents by making phase state per-process in-memory only, with skill-aware suppression, subagent guard, and terminal-artifact auto-reset.

**Architecture:**
Drop the global `~/.pi/extension-state.json` file that every pi session shares. Phase (`currentPhase`, `activeGoalDocument`) lives only in the process-local module closure. Cross-compaction survival is already handled by the existing `session_compact` event round-trip and stays untouched. Three behavioral guards are added on top: (a) skip phase guidance when the turn runs inside a subagent process, (b) skip phase guidance when the user prompt is a skill/command invocation, (c) auto-reset phase to idle when the current phase's terminal artifact is written.

**Tech Stack:** TypeScript, vitest, `@mariozechner/pi-coding-agent` ExtensionAPI.

**Work Scope:**
- **In scope:**
  - Remove global state-file persistence (`loadState`/`saveState`/`updateState`) from `index.ts`.
  - Delete `state.ts` and `tests/state.test.ts` (module becomes unused).
  - Add subagent guard in `before_agent_start` — suppress phase guidance when `!isRootSession`, keep delegation guards.
  - Add skill-invocation suppression in `before_agent_start` — suppress phase guidance when `event.prompt` contains a command/skill marker.
  - Add terminal-artifact auto-reset in `tool_result` — reset `currentPhase` to `"idle"` when the current phase's terminal directory receives a `write`.
  - Update `tests/extension.test.ts` with coverage for all four behavioral changes.
  - Verify no stale state.json is read or written by the extension.
- **Out of scope:**
  - Changing subagent spawning (`subagent.ts`).
  - Changing compaction behaviour (`compaction.ts`).
  - Phase TTL (previously discussed Option 3) — not needed once file persistence is dropped.
  - Backwards-compat cleanup of the old `~/.pi/extension-state.json` file (harmless to leave; new code ignores it).
  - UI/footer changes.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npm test && npm run build`
- **What it validates:** All vitest unit tests pass (including new coverage) and `tsc --noEmit` type-checks the whole extension cleanly.

---

## File Structure Mapping

| File | Action | Responsibility |
|---|---|---|
| `extensions/agentic-harness/index.ts` | Modify | Remove state-file persistence; add subagent guard, skill suppression, terminal-artifact auto-reset |
| `extensions/agentic-harness/state.ts` | Delete | No longer used after persistence is removed |
| `extensions/agentic-harness/tests/state.test.ts` | Delete | Tests the deleted module |
| `extensions/agentic-harness/tests/extension.test.ts` | Modify | Add tests for each behavioral change |

All changes touch the extension package at `extensions/agentic-harness/`. Tasks 1–4 all modify `index.ts`, so they must run sequentially to avoid file conflicts.

---

## Project Capability Discovery

- **Project agents:** No project agents in `.claude/agents/` relevant to this task.
- **Project skills:** None directly applicable (plan-crafting already in use for this document).
- **Test runner:** `vitest run` via `npm test` (configured in `package.json`).
- **Type-check:** `tsc --noEmit` via `npm run build`.

Workers run the commands directly; no specialized agent dispatch is needed.

---

## Task Decomposition

### Task 1: Subagent phase-guidance guard

**Dependencies:** None (can run in parallel with nothing — first task)
**Files:**
- Modify: `extensions/agentic-harness/index.ts:532-547` (the `before_agent_start` handler)
- Test: `extensions/agentic-harness/tests/extension.test.ts` (new test in the `describe("before_agent_start Event")` block, after line 278)

- [ ] **Step 1: Add failing test for subagent phase-guidance guard**

In `tests/extension.test.ts`, add this test inside the existing `describe("before_agent_start Event", () => { ... })` block (insert before the closing `});` near line 279):

```ts
  it("should NOT inject phase guidance in subagent context, but should still inject delegation guards", async () => {
    const prevDepth = process.env.PI_SUBAGENT_DEPTH;
    process.env.PI_SUBAGENT_DEPTH = "1";
    try {
      const { mockPi, events, commands } = createMockPi();
      extension(mockPi);

      // Root would normally set phase via /plan; inside a subagent the /plan command is not registered,
      // but we simulate the scenario where a subagent process inherits a phase from a (now-removed) global store.
      // Because phase state is now in-memory-only and subagents start idle, this test also verifies the default
      // behaviour: idle subagents never get phase guidance text.
      const handlers = events.get("before_agent_start")!;
      const result = await handlers[0](
        { type: "before_agent_start", prompt: "do the task", systemPrompt: "base" },
        { cwd: "." } as any
      );

      expect(result?.systemPrompt).toContain("base");
      expect(result?.systemPrompt).not.toContain("Active Workflow:");
      // Delegation guards depend on depthConfig.canDelegate. At depth=1 (< default max 3) delegation is still allowed,
      // so the guards section still appears.
      expect(result?.systemPrompt).toContain("## Delegation Guards");
    } finally {
      if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
      else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    }
  });
```

- [ ] **Step 2: Run the new test to confirm it fails**

Run: `npx vitest run tests/extension.test.ts -t "NOT inject phase guidance in subagent context"`
Expected: FAIL — with the current implementation the test still passes because `currentPhase` defaults to `"idle"` (whose guidance is `""`), but the test also needs the skill-suppression fix to survive Task 2. Accept PASS or FAIL here; this test is the behavioural contract that the subagent branch is guarded.

Note: This test may PASS on first run since the default phase is `"idle"`. The real enforcement is the code change in Step 3, which guarantees subagents never see non-idle guidance even if a future bug sets `currentPhase` inside a subagent process. Move to Step 3 regardless.

- [ ] **Step 3: Gate phase guidance on `isRootSession` in `before_agent_start`**

In `extensions/agentic-harness/index.ts`, locate the `before_agent_start` handler (currently at lines 532-547):

```ts
  pi.on("before_agent_start", async (event, _ctx) => {
    const guidance = PHASE_GUIDANCE[currentPhase];

    let delegationInfo = "";
    if (depthConfig.canDelegate) {
      const agentList = (await discoverAgents(_ctx.cwd || ".", "user", BUNDLED_AGENTS_DIR))
        .map((a) => `- **${a.name}**: ${a.description}`)
        .join("\n");
      delegationInfo = `\n\n## Delegation Guards\n- Current depth: ${depthConfig.currentDepth}, max: ${depthConfig.maxDepth}\n- Cycle prevention: ${depthConfig.preventCycles ? "enabled" : "disabled"}\n- Ancestor stack: ${depthConfig.ancestorStack.length > 0 ? depthConfig.ancestorStack.join(" -> ") : "(root)"}\n\n## Available Subagents\n${agentList}`;
    }

    if (!guidance && !delegationInfo) return;
    return {
      systemPrompt: event.systemPrompt + (guidance || "") + delegationInfo,
    };
  });
```

Replace with:

```ts
  pi.on("before_agent_start", async (event, _ctx) => {
    const guidance = isRootSession ? PHASE_GUIDANCE[currentPhase] : "";

    let delegationInfo = "";
    if (depthConfig.canDelegate) {
      const agentList = (await discoverAgents(_ctx.cwd || ".", "user", BUNDLED_AGENTS_DIR))
        .map((a) => `- **${a.name}**: ${a.description}`)
        .join("\n");
      delegationInfo = `\n\n## Delegation Guards\n- Current depth: ${depthConfig.currentDepth}, max: ${depthConfig.maxDepth}\n- Cycle prevention: ${depthConfig.preventCycles ? "enabled" : "disabled"}\n- Ancestor stack: ${depthConfig.ancestorStack.length > 0 ? depthConfig.ancestorStack.join(" -> ") : "(root)"}\n\n## Available Subagents\n${agentList}`;
    }

    if (!guidance && !delegationInfo) return;
    return {
      systemPrompt: event.systemPrompt + (guidance || "") + delegationInfo,
    };
  });
```

- [ ] **Step 4: Run the new test — verify it passes**

Run: `npx vitest run tests/extension.test.ts -t "NOT inject phase guidance in subagent context"`
Expected: PASS

- [ ] **Step 5: Run the full extension test file to check for regressions**

Run: `npx vitest run tests/extension.test.ts`
Expected: All tests pass (old plus new).

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "fix(harness): never inject phase guidance in subagent context"
```

---

### Task 2: Skill-invocation suppression

**Dependencies:** Runs after Task 1 completes (same file: `index.ts`)
**Files:**
- Modify: `extensions/agentic-harness/index.ts` (the `before_agent_start` handler modified in Task 1)
- Test: `extensions/agentic-harness/tests/extension.test.ts` (add another test to the `before_agent_start Event` block)

- [ ] **Step 1: Write the failing test**

In `tests/extension.test.ts`, inside the same `describe("before_agent_start Event", () => { ... })` block, add:

```ts
  it("should suppress phase guidance when user prompt is a skill/command invocation", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    // Put the root session in ultraplanning phase via the /ultraplan command.
    const ultraplan = commands.get("ultraplan");
    await ultraplan.handler("test topic", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const handlers = events.get("before_agent_start")!;

    // Case A: a normal user turn — phase guidance is injected as before.
    const normal = await handlers[0](
      { type: "before_agent_start", prompt: "keep working on the milestones", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(normal?.systemPrompt).toContain("Active Workflow: Milestone Planning (Ultraplan)");

    // Case B: the user invokes a skill via the claude-code-style <command-name> tag.
    // Phase guidance must NOT be injected for this turn.
    const skillPrompt = [
      "<command-message>systematic-debugging</command-message>",
      "<command-name>/systematic-debugging</command-name>",
      "<command-args>fix this bug</command-args>",
    ].join("\n");
    const skillTurn = await handlers[0](
      { type: "before_agent_start", prompt: skillPrompt, systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(skillTurn?.systemPrompt).not.toContain("Active Workflow: Milestone Planning (Ultraplan)");

    // Case C: a raw "[skill] foo" marker also suppresses guidance.
    const bracketTurn = await handlers[0](
      { type: "before_agent_start", prompt: "[skill] some-skill\n\nfix this", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(bracketTurn?.systemPrompt).not.toContain("Active Workflow: Milestone Planning (Ultraplan)");
  });
```

- [ ] **Step 2: Run the new test — expect it to fail**

Run: `npx vitest run tests/extension.test.ts -t "suppress phase guidance when user prompt is a skill"`
Expected: FAIL — skill turns currently still receive phase guidance.

- [ ] **Step 3: Implement skill-invocation suppression**

In `extensions/agentic-harness/index.ts`, just above the `before_agent_start` handler that was edited in Task 1, add the helper:

```ts
  // Matches user turns that are claude-code skill/command invocations. We suppress
  // phase guidance for these turns so the invoked skill's own instructions are not
  // overridden by a stale workflow phase (e.g. user ran /ultraplan last week,
  // never reset-phase, and today invokes /systematic-debugging).
  const SKILL_INVOCATION_RE = /<command-name>|<command-message>|\[skill\]/;
```

Then update the guidance computation at the top of the `before_agent_start` handler from:

```ts
    const guidance = isRootSession ? PHASE_GUIDANCE[currentPhase] : "";
```

to:

```ts
    const isSkillInvocation = SKILL_INVOCATION_RE.test(event.prompt ?? "");
    const guidance = (isRootSession && !isSkillInvocation) ? PHASE_GUIDANCE[currentPhase] : "";
```

- [ ] **Step 4: Run the new test — expect it to pass**

Run: `npx vitest run tests/extension.test.ts -t "suppress phase guidance when user prompt is a skill"`
Expected: PASS

- [ ] **Step 5: Run the full extension test file**

Run: `npx vitest run tests/extension.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "fix(harness): suppress phase guidance on skill/command invocations"
```

---

### Task 3: Terminal-artifact auto-reset

**Dependencies:** Runs after Task 2 completes (same file: `index.ts`)
**Files:**
- Modify: `extensions/agentic-harness/index.ts:666-682` (the `tool_result` handler and the `GOAL_DOC_PATTERN` constant above it)
- Test: `extensions/agentic-harness/tests/extension.test.ts` (new `describe` block for `tool_result`)

- [ ] **Step 1: Write the failing test**

In `tests/extension.test.ts`, append this new block at the bottom of the file (before the final closing of the outer describe blocks — after the last existing `describe` block):

```ts
describe("tool_result Phase Auto-Reset", () => {
  it("should reset currentPhase to idle when the phase's terminal artifact is written", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    // Put root session into 'planning' phase via /plan.
    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const beforeHandlers = events.get("before_agent_start")!;
    const before = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "continue planning", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(before?.systemPrompt).toContain("Active Workflow: Plan Crafting");

    // Simulate a write to the planning terminal directory.
    const toolHandlers = events.get("tool_result")!;
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "write",
        input: { path: "docs/engineering-discipline/plans/2026-04-19-foo.md" },
      } as any,
      { cwd: "." } as any
    );

    // Next turn must no longer see phase guidance, because phase was reset to idle.
    const after = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "anything", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(after?.systemPrompt).not.toContain("Active Workflow: Plan Crafting");
  });

  it("should NOT reset phase when a write targets a different phase's directory", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const toolHandlers = events.get("tool_result")!;
    // Writing a review doc while in planning phase must NOT reset planning.
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "write",
        input: { path: "docs/engineering-discipline/reviews/2026-04-19-bar.md" },
      } as any,
      { cwd: "." } as any
    );

    const beforeHandlers = events.get("before_agent_start")!;
    const after = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "anything", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(after?.systemPrompt).toContain("Active Workflow: Plan Crafting");
  });

  it("should NOT reset phase on edit — only on write (first creation)", async () => {
    const { mockPi, events, commands } = createMockPi();
    extension(mockPi);

    const plan = commands.get("plan");
    await plan.handler("test feature", {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        setStatus: vi.fn(),
      },
    } as any);

    const toolHandlers = events.get("tool_result")!;
    await toolHandlers[0](
      {
        type: "tool_result",
        toolName: "edit",
        input: { path: "docs/engineering-discipline/plans/2026-04-19-foo.md" },
      } as any,
      { cwd: "." } as any
    );

    const beforeHandlers = events.get("before_agent_start")!;
    const after = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "anything", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(after?.systemPrompt).toContain("Active Workflow: Plan Crafting");
  });
});
```

- [ ] **Step 2: Run the new tests — expect failures**

Run: `npx vitest run tests/extension.test.ts -t "Phase Auto-Reset"`
Expected: FAIL on the first test ("should reset currentPhase...") because no auto-reset logic exists yet. Other two may pass incidentally, but verify the first one fails.

- [ ] **Step 3: Add terminal-directory map and auto-reset logic**

In `extensions/agentic-harness/index.ts`, find the block around line 666:

```ts
  const GOAL_DOC_PATTERN = /^docs\/engineering-discipline\/(context|plans|reviews)\//;

  pi.on("tool_result", async (event, _ctx) => {
    if (currentPhase === "idle") return;

    const toolName = event.toolName;
    if (toolName !== "write" && toolName !== "edit") return;

    const filePath = event.input.path as string | undefined;
    if (!filePath) return;

    const relativePath = filePath.replace(/^.*?docs\/engineering-discipline\//, "docs/engineering-discipline/");
    if (GOAL_DOC_PATTERN.test(relativePath)) {
      activeGoalDocument = relativePath;
      updateState(STATE_FILE, { activeGoalDocument: relativePath }).catch(() => {});
    }
  });
```

Replace with:

```ts
  const GOAL_DOC_PATTERN = /^docs\/engineering-discipline\/(context|plans|reviews)\//;

  // Maps each non-idle phase to the regex for the directory whose fresh write signals phase completion.
  // A write to the matching directory flips currentPhase back to "idle" so the workflow guidance stops
  // riding on subsequent turns. Edits are ignored — only initial writes (new files) count as completion.
  const PHASE_TERMINAL_DIR: Partial<Record<WorkflowPhase, RegExp>> = {
    clarifying: /^docs\/engineering-discipline\/context\//,
    planning: /^docs\/engineering-discipline\/plans\//,
    ultraplanning: /^docs\/engineering-discipline\/plans\//,
    reviewing: /^docs\/engineering-discipline\/reviews\//,
    ultrareviewing: /^docs\/engineering-discipline\/reviews\//,
  };

  pi.on("tool_result", async (event, _ctx) => {
    if (currentPhase === "idle") return;

    const toolName = event.toolName;
    if (toolName !== "write" && toolName !== "edit") return;

    const filePath = event.input.path as string | undefined;
    if (!filePath) return;

    const relativePath = filePath.replace(/^.*?docs\/engineering-discipline\//, "docs/engineering-discipline/");
    if (!GOAL_DOC_PATTERN.test(relativePath)) return;

    activeGoalDocument = relativePath;

    // Auto-reset phase when the current phase's terminal artifact is written (not edited).
    if (toolName === "write") {
      const terminal = PHASE_TERMINAL_DIR[currentPhase];
      if (terminal && terminal.test(relativePath)) {
        currentPhase = "idle";
      }
    }
  });
```

Note: the `updateState(STATE_FILE, ...)` call is removed here. The file-persistence removal is finished in Task 4 — for now the tests pass because `updateState` write failures are already swallowed. Keeping the removal surgical to this block is fine.

- [ ] **Step 4: Run the auto-reset tests — expect pass**

Run: `npx vitest run tests/extension.test.ts -t "Phase Auto-Reset"`
Expected: PASS (all three).

- [ ] **Step 5: Run the full extension test file**

Run: `npx vitest run tests/extension.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "fix(harness): auto-reset phase on terminal-artifact write"
```

---

### Task 4: Remove global state-file persistence

**Dependencies:** Runs after Task 3 completes (same file: `index.ts`; also deletes sibling files that Tasks 1–3 do not touch)
**Files:**
- Modify: `extensions/agentic-harness/index.ts` (remove all state-file imports, `STATE_FILE` constant, `loadState`/`updateState` calls, and the `session_start` file load)
- Delete: `extensions/agentic-harness/state.ts`
- Delete: `extensions/agentic-harness/tests/state.test.ts`
- Test: `extensions/agentic-harness/tests/extension.test.ts` (add a test that asserts the extension performs no state-file I/O)

- [ ] **Step 1: Write the failing test for no-file-persistence**

In `tests/extension.test.ts`, append this new block at the bottom of the file:

```ts
describe("No Global State File", () => {
  it("extension must not import loadState/updateState from the state module", async () => {
    // Source-level contract: the extension body is not allowed to reference the
    // removed persistence helpers. This guards against accidental reintroduction.
    const { readFile } = await import("fs/promises");
    const src = await readFile(new URL("../index.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/\bloadState\s*\(/);
    expect(src).not.toMatch(/\bupdateState\s*\(/);
    expect(src).not.toMatch(/extension-state\.json/);
  });

  it("session_start must not read any state file — phase always starts idle on a fresh process", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const handlers = events.get("session_start");
    if (!handlers || handlers.length === 0) return; // no-op if not registered

    // Provide a ctx with the minimum surface the handler touches.
    const headerSetters: any[] = [];
    await handlers[0]({ type: "session_start" } as any, {
      cwd: ".",
      ui: {
        setHeader: (fn: any) => headerSetters.push(fn),
        setFooter: vi.fn(),
        notify: vi.fn(),
      },
      model: { name: "test" },
      getContextUsage: () => undefined,
    } as any);

    // Immediately after session_start, phase must be idle (no inheritance from disk).
    const beforeHandlers = events.get("before_agent_start")!;
    const result = await beforeHandlers[0](
      { type: "before_agent_start", prompt: "hello", systemPrompt: "base" },
      { cwd: "." } as any
    );
    expect(result?.systemPrompt).not.toContain("Active Workflow:");
  });
});
```

- [ ] **Step 2: Run the new tests — expect failure**

Run: `npx vitest run tests/extension.test.ts -t "No Global State File"`
Expected: FAIL — `index.ts` currently contains `loadState(`, `updateState(`, and `extension-state.json`.

- [ ] **Step 3: Remove state-file persistence from `index.ts`**

Make the following edits in `extensions/agentic-harness/index.ts`:

**3a.** Remove the state module import at line 13:
```ts
import { loadState, updateState } from "./state.js";
```
Delete the entire line.

**3b.** Remove the `STATE_FILE` constant at line 35:
```ts
const STATE_FILE = join(homedir(), ".pi", "extension-state.json");
```
Delete the entire line.

**3c.** Remove every `updateState(STATE_FILE, ...)` call. They appear in:
- Inside `/clarify` handler (currently line 697)
- Inside `/plan` handler (currently line 722)
- Inside `/ultraplan` handler (currently line 750)
- Inside `/review` handler (currently line 785)
- Inside `/ultrareview` handler (currently line 834)
- Inside `/reset-phase` handler (currently line 982)

For each, delete the entire `updateState(STATE_FILE, { ... }).catch(() => {});` statement. The assignments to `currentPhase` and `activeGoalDocument` on the preceding lines stay.

Example — in `/plan`:
```ts
      currentPhase = "planning";
      updateState(STATE_FILE, { phase: "planning" }).catch(() => {});  // DELETE THIS LINE
      ctx.ui.setStatus("harness", "Agentic planning workflow in progress...");
```
becomes:
```ts
      currentPhase = "planning";
      ctx.ui.setStatus("harness", "Agentic planning workflow in progress...");
```

**3d.** Remove the state load at the top of `session_start` (currently lines 1008-1010):
```ts
    const saved = await loadState(STATE_FILE);
    currentPhase = saved.phase;
    activeGoalDocument = saved.activeGoalDocument;
```
Replace with explicit idle init:
```ts
    currentPhase = "idle";
    activeGoalDocument = null;
```

Do **not** touch:
- `session_compact` handler at lines 653-664 (cross-compaction restore still uses `event.compactionEntry.details`; this is orthogonal).
- The `WorkflowPhase` type (still used).
- `PHASE_GUIDANCE` (still used).

- [ ] **Step 4: Delete the state module and its test**

Run:
```bash
rm extensions/agentic-harness/state.ts
rm extensions/agentic-harness/tests/state.test.ts
```

- [ ] **Step 5: Verify type-check passes**

Run: `npm run build`
Expected: PASS — no dangling import of `state.js`, no TypeScript errors.

- [ ] **Step 6: Run the no-file-persistence tests — expect pass**

Run: `npx vitest run tests/extension.test.ts -t "No Global State File"`
Expected: PASS (both).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: All tests pass. Note: `tests/state.test.ts` is gone, so vitest must not complain about missing files. Confirm no orphan references exist:

```bash
grep -rn "state\.js\|state\.ts" extensions/agentic-harness/tests extensions/agentic-harness/*.ts | grep -v "node_modules\|plan-parser\|validator-template"
```
Expected: no results (empty output).

- [ ] **Step 8: Commit**

```bash
git add -A extensions/agentic-harness/
git commit -m "refactor(harness): drop global state file; phase is per-process in-memory only"
```

---

### Task 5 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run: `npm test`
Expected: ALL PASS — every test in `tests/` passes.

- [ ] **Step 2: Run type-check**

Run: `npm run build`
Expected: PASS (no TypeScript errors, no dangling imports).

- [ ] **Step 3: Verify plan success criteria manually**

Go through each success criterion from this plan:

- [ ] `extensions/agentic-harness/state.ts` no longer exists (`ls extensions/agentic-harness/state.ts` → "No such file").
- [ ] `extensions/agentic-harness/tests/state.test.ts` no longer exists.
- [ ] `extensions/agentic-harness/index.ts` contains no `loadState(`, no `updateState(`, no `extension-state.json`:
  ```bash
  grep -n "loadState\|updateState\|extension-state\.json" extensions/agentic-harness/index.ts
  ```
  Expected: no matches.
- [ ] `isRootSession` gates phase guidance in `before_agent_start` (verify by reading the handler).
- [ ] `SKILL_INVOCATION_RE` exists and is consulted in `before_agent_start`.
- [ ] `PHASE_TERMINAL_DIR` exists and is consulted in `tool_result` for `toolName === "write"` only.
- [ ] `session_compact` handler at lines ~653-664 is unchanged (cross-compaction phase restore still works).

- [ ] **Step 4: Scan for residual state-file references anywhere in the package**

Run:
```bash
grep -rn "extension-state\.json\|loadState\|updateState" extensions/agentic-harness/ --include="*.ts" | grep -v node_modules
```
Expected: no matches (except possibly inside `tests/extension.test.ts` where the negation test asserts their absence in source — that's fine; the test `expect(src).not.toMatch(...)` content will be flagged, which is expected and safe).

- [ ] **Step 5: Full regression sweep**

Run: `npm test`
Expected: No regressions — all pre-existing tests still pass. Confirm total test count has gone **down** by the removed `state.test.ts` cases but has gone **up** by the new tests added in Tasks 1–4. Net change should be positive.

---

## Self-Review

1. **Spec coverage:**
   - Drop global state file → Task 4 ✓
   - Skill-invocation suppression → Task 2 ✓
   - Subagent guard → Task 1 ✓
   - Terminal-artifact auto-reset → Task 3 ✓
   - Multi-session isolation guarantee → implicit in Task 4 (no shared file = no sharing) ✓
   - Test coverage for all four → Tasks 1–4 each include TDD steps ✓

2. **Placeholder scan:** No TBD, TODO, or "implement later" anywhere. All code blocks are complete.

3. **Type consistency:**
   - `WorkflowPhase` is the existing type, used consistently in `PHASE_TERMINAL_DIR` and `currentPhase` assignments.
   - `isRootSession` already exists at line 49 and is reused.
   - `event.prompt` is typed `string` in `BeforeAgentStartEvent`.

4. **Dependency verification:** Tasks 1, 2, 3, 4 all modify `index.ts` → sequential. Task 5 is read-only verification and depends on all prior tasks. No parallel file conflicts.

5. **Verification coverage:** Final Verification Task (Task 5) runs `npm test` and `npm run build`, the discovered highest-level verification. No Task 0 needed — vitest + tsc already cover the project.

## Minimal Checklist

- [x] All tasks have exact file paths
- [x] All steps contain executable code/commands
- [x] No file conflicts between parallel tasks (all sequential on `index.ts`)
- [x] Dependency chain stated for every task
- [x] Plan covers: subagent guard, skill suppression, artifact auto-reset, state file removal
- [x] No placeholders
- [x] Verification Strategy stated in header
- [x] Final Verification Task is the last task
