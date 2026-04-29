# Team Mode Feature Flag Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Gate team mode (both `/team` slash command and the LLM-callable `team` tool) behind the `PI_ENABLE_TEAM_MODE=1` environment variable, defaulting to OFF.

**Architecture:**
Two-pronged gate matching each entry point's existing convention. The LLM-callable `team` tool already uses **registration-level** gating (`if (isRootSession && !isTeamWorker)`), so we add `&& isTeamModeEnabled` to that condition — the tool simply won't be registered when the flag is unset, hiding it from the LLM. The user-facing `/team` slash command stays registered (so autocompletion still works) but its handler returns a guidance message when the flag is unset. A single new env-var constant `PI_ENABLE_TEAM_MODE_ENV = "PI_ENABLE_TEAM_MODE"` is co-located with the existing `PI_TEAM_WORKER_ENV` in `team.ts`.

**Tech Stack:** TypeScript (ESM), `@mariozechner/pi-coding-agent` extension API, vitest, tsc.

**Work Scope:**
- **In scope:**
  - Add `PI_ENABLE_TEAM_MODE_ENV` constant in `extensions/agentic-harness/team.ts` next to `PI_TEAM_WORKER_ENV`
  - Add `isTeamModeEnabled` flag and gate `pi.registerTool({ name: "team", ... })` registration at `extensions/agentic-harness/index.ts:323`
  - Add handler-level guard at top of `/team` command handler at `extensions/agentic-harness/index.ts:1523` with message `team mode is disabled. Set PI_ENABLE_TEAM_MODE=1 to enable.`
  - Update existing tests in `tests/team-tool.test.ts` and `tests/extension.test.ts` to set `PI_ENABLE_TEAM_MODE=1` in `beforeEach` so they continue to exercise the active-team paths
  - Add new tests covering the gate (tool not registered when unset, handler returns guidance when unset)
  - Update `extensions/agentic-harness/README.md` "Lightweight Native Team Mode" section to document the flag, default state, and behavior when disabled
- **Out of scope:**
  - Conditional registration of the `/team` slash command itself (handler-level guard only)
  - Adding `[experimental]` markers to descriptions
  - Gating internal `team-state`/`team-command` modules (entry points already block downstream code)
  - A general feature-flag framework
  - Toggling via config files, settings.json, or anything other than env var
  - Modifying the root `README.md` (no current team references)

**Verification Strategy:**
- **Level:** test-suite + build (the agentic-harness README itself prescribes this as the team-mode release gate)
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **What it validates:** Full vitest suite (existing team unit/integration tests + new gate tests) plus `tsc --noEmit` type check.

---

## File Structure Mapping

| File | Action | Purpose |
|---|---|---|
| `extensions/agentic-harness/team.ts` | Modify (+1 line near L25) | Export new env-var constant `PI_ENABLE_TEAM_MODE_ENV` |
| `extensions/agentic-harness/index.ts` | Modify (3 locations: import L29, flag definition near L83, registration condition L323, handler guard L1523) | Wire up the gate at both entry points |
| `extensions/agentic-harness/tests/team-tool.test.ts` | Modify | Set `PI_ENABLE_TEAM_MODE=1` in `beforeEach`; add new test cases for handler gate |
| `extensions/agentic-harness/tests/extension.test.ts` | Modify | Set `PI_ENABLE_TEAM_MODE=1` in `beforeEach` for tests asserting team tool registered; add new test case for registration gate |
| `extensions/agentic-harness/README.md` | Modify | Document flag in "Lightweight Native Team Mode" section |

**Parallelism analysis:**
- Tasks modifying `index.ts` (Tasks 3, 4) cannot run in parallel — same file, related sections.
- Task 2 (`team.ts`) must precede Tasks 3 & 4 (they import the new constant).
- Task 5 (README) is in a separate file → can run in parallel with Tasks 2-4.
- Task 1 (tests) modifies test files only → can run in parallel with Tasks 2-5, but its assertions only become meaningful after the source-side tasks finish.

---

## Task 1: Write Failing Tests and Update Existing Test Setup (RED)

**Dependencies:** None (can run in parallel with other tasks, but tests will fail until Tasks 2-4 land)
**Files:**
- Modify: `extensions/agentic-harness/tests/team-tool.test.ts:38-55, 181-216`
- Modify: `extensions/agentic-harness/tests/extension.test.ts` (beforeEach blocks + add gate test)

- [ ] **Step 1: Update `tests/team-tool.test.ts` `beforeEach`/`afterEach` to manage `PI_ENABLE_TEAM_MODE`**

Open `extensions/agentic-harness/tests/team-tool.test.ts`. Update lines 38-55:

```typescript
const originalEnv = {
  PI_SUBAGENT_DEPTH: process.env.PI_SUBAGENT_DEPTH,
  PI_TEAM_WORKER: process.env.PI_TEAM_WORKER,
  PI_ENABLE_TEAM_MODE: process.env.PI_ENABLE_TEAM_MODE,
};

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_TEAM_WORKER;
  process.env.PI_ENABLE_TEAM_MODE = "1";
  teamMock.runTeam.mockReset();
  teamMock.cleanupActiveTeamTmuxResources.mockClear();
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
```

- [ ] **Step 2: Add new test cases to `tests/team-tool.test.ts`**

Append to the `describe("/team command registration", () => { ... })` block in `team-tool.test.ts` (insert before the closing `});` at line 216):

```typescript
  it("handler shows guidance and does not send a message when PI_ENABLE_TEAM_MODE is unset", async () => {
    delete process.env.PI_ENABLE_TEAM_MODE;
    const { mockPi, commands } = createMockPi();
    extension(mockPi);
    const cmd = commands.get("team");
    const ctx = makeCtx();
    await cmd.handler('goal="ship the API client"', ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("team mode is disabled"),
      "error",
    );
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("handler shows guidance when PI_ENABLE_TEAM_MODE is a non-\"1\" value", async () => {
    process.env.PI_ENABLE_TEAM_MODE = "true";
    const { mockPi, commands } = createMockPi();
    extension(mockPi);
    const cmd = commands.get("team");
    const ctx = makeCtx();
    await cmd.handler('goal="x"', ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("team mode is disabled"),
      "error",
    );
    expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Update `tests/extension.test.ts` env-handling to manage `PI_ENABLE_TEAM_MODE`**

Open `extensions/agentic-harness/tests/extension.test.ts`. The file has a single top-level `originalSubagentEnv` snapshot (L29-35), a top-level `beforeEach` (L37-43), and a top-level `afterAll` (L45-50) that all tests inherit. We add `PI_ENABLE_TEAM_MODE` to all three.

Replace lines 29-43:

```typescript
const originalSubagentEnv = {
  PI_SUBAGENT_DEPTH: process.env.PI_SUBAGENT_DEPTH,
  PI_SUBAGENT_MAX_DEPTH: process.env.PI_SUBAGENT_MAX_DEPTH,
  PI_SUBAGENT_STACK: process.env.PI_SUBAGENT_STACK,
  PI_SUBAGENT_PREVENT_CYCLES: process.env.PI_SUBAGENT_PREVENT_CYCLES,
  PI_TEAM_WORKER: process.env.PI_TEAM_WORKER,
};

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_SUBAGENT_MAX_DEPTH;
  delete process.env.PI_SUBAGENT_STACK;
  delete process.env.PI_SUBAGENT_PREVENT_CYCLES;
  delete process.env.PI_TEAM_WORKER;
});
```

With:

```typescript
const originalSubagentEnv = {
  PI_SUBAGENT_DEPTH: process.env.PI_SUBAGENT_DEPTH,
  PI_SUBAGENT_MAX_DEPTH: process.env.PI_SUBAGENT_MAX_DEPTH,
  PI_SUBAGENT_STACK: process.env.PI_SUBAGENT_STACK,
  PI_SUBAGENT_PREVENT_CYCLES: process.env.PI_SUBAGENT_PREVENT_CYCLES,
  PI_TEAM_WORKER: process.env.PI_TEAM_WORKER,
  PI_ENABLE_TEAM_MODE: process.env.PI_ENABLE_TEAM_MODE,
};

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_SUBAGENT_MAX_DEPTH;
  delete process.env.PI_SUBAGENT_STACK;
  delete process.env.PI_SUBAGENT_PREVENT_CYCLES;
  delete process.env.PI_TEAM_WORKER;
  process.env.PI_ENABLE_TEAM_MODE = "1";
});
```

The existing `afterAll` at L45-50 already restores everything in `originalSubagentEnv`, so adding `PI_ENABLE_TEAM_MODE` to that object is sufficient — no `afterAll` change needed.

For tests that need to assert behavior with the flag unset (Step 4 below), use the same `try/finally` style as the existing `prevDepth` pattern on L86-98.

- [ ] **Step 4: Add new test cases for registration-level gate to `tests/extension.test.ts`**

Insert these two tests inside the `describe("Extension Registration", () => { ... })` block (which spans L74-256). Place them immediately after the existing test `should NOT register recursive orchestration tools in team-worker context` (which ends at L212) so they sit alongside the other registration-gating tests:

```typescript
  it("should NOT register team tool when PI_ENABLE_TEAM_MODE is unset", () => {
    const prev = process.env.PI_ENABLE_TEAM_MODE;
    delete process.env.PI_ENABLE_TEAM_MODE;
    try {
      const { mockPi, tools } = createMockPi();
      extension(mockPi);
      expect(tools.get("team")).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.PI_ENABLE_TEAM_MODE;
      else process.env.PI_ENABLE_TEAM_MODE = prev;
    }
  });

  it("should NOT register team tool when PI_ENABLE_TEAM_MODE is a non-\"1\" value", () => {
    const prev = process.env.PI_ENABLE_TEAM_MODE;
    process.env.PI_ENABLE_TEAM_MODE = "true";
    try {
      const { mockPi, tools } = createMockPi();
      extension(mockPi);
      expect(tools.get("team")).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.PI_ENABLE_TEAM_MODE;
      else process.env.PI_ENABLE_TEAM_MODE = prev;
    }
  });
```

The `try/finally` mirrors the existing `prevDepth` pattern on L86-98 of the same file.

- [ ] **Step 5: Run tests to verify new tests fail and existing tests still pass**

Run: `cd extensions/agentic-harness && npm test -- team-tool extension`

Expected:
- 4 new tests FAIL (2 in `team-tool.test.ts`, 2 in `extension.test.ts`) — handler does not yet emit "team mode is disabled" message; tool is registered regardless of `PI_ENABLE_TEAM_MODE`.
- All previously-passing tests in these files still PASS (the `PI_ENABLE_TEAM_MODE=1` setup is currently a no-op against unmodified source).

If a previously-passing test now fails, stop and report — that means the env-management changes in Steps 1 and 3 broke something unintentionally.

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/tests/team-tool.test.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "test: add failing tests for PI_ENABLE_TEAM_MODE gate

Constraint: gate must work for both LLM-callable team tool (registration-level)
and /team slash command handler (handler-level)
Confidence: high
Scope-risk: narrow
Tested: new tests intentionally fail; existing tests unaffected by env=1 setup"
```

---

## Task 2: Add `PI_ENABLE_TEAM_MODE_ENV` Constant

**Dependencies:** None (can run in parallel)
**Files:**
- Modify: `extensions/agentic-harness/team.ts:25`

- [ ] **Step 1: Add the constant next to `PI_TEAM_WORKER_ENV`**

Open `extensions/agentic-harness/team.ts`. Locate line 25:

```typescript
export const PI_TEAM_WORKER_ENV = "PI_TEAM_WORKER";
```

Replace with:

```typescript
export const PI_TEAM_WORKER_ENV = "PI_TEAM_WORKER";
export const PI_ENABLE_TEAM_MODE_ENV = "PI_ENABLE_TEAM_MODE";
```

- [ ] **Step 2: Verify build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add extensions/agentic-harness/team.ts
git commit -m "feat: add PI_ENABLE_TEAM_MODE_ENV constant for team mode gate

Confidence: high
Scope-risk: narrow"
```

---

## Task 3: Gate the LLM-Callable `team` Tool at Registration

**Dependencies:** Runs after Task 2 completes (imports new constant)
**Files:**
- Modify: `extensions/agentic-harness/index.ts:29` (import)
- Modify: `extensions/agentic-harness/index.ts:83` (add `isTeamModeEnabled` flag)
- Modify: `extensions/agentic-harness/index.ts:323` (registration condition)

- [ ] **Step 1: Update import to include `PI_ENABLE_TEAM_MODE_ENV`**

In `extensions/agentic-harness/index.ts`, locate line 29:

```typescript
import { PI_TEAM_WORKER_ENV, cleanupActiveTeamTmuxResources, formatTeamRunSummary, runTeam, type TeamBackend, type TeamRunSummary } from "./team.js";
```

Replace with:

```typescript
import { PI_ENABLE_TEAM_MODE_ENV, PI_TEAM_WORKER_ENV, cleanupActiveTeamTmuxResources, formatTeamRunSummary, runTeam, type TeamBackend, type TeamRunSummary } from "./team.js";
```

- [ ] **Step 2: Add `isTeamModeEnabled` flag near `isTeamWorker`**

Locate line 83:

```typescript
  const isTeamWorker = process.env[PI_TEAM_WORKER_ENV] === "1";
```

Replace with:

```typescript
  const isTeamWorker = process.env[PI_TEAM_WORKER_ENV] === "1";
  const isTeamModeEnabled = process.env[PI_ENABLE_TEAM_MODE_ENV] === "1";
```

- [ ] **Step 3: Tighten the team-tool registration condition**

Locate line 323:

```typescript
  if (isRootSession && !isTeamWorker) {
    pi.registerTool({
      name: "team",
```

Replace with:

```typescript
  if (isRootSession && !isTeamWorker && isTeamModeEnabled) {
    pi.registerTool({
      name: "team",
```

(Only the `if` line changes; the body is unchanged.)

- [ ] **Step 4: Run tests — registration-gate tests should now pass**

Run: `cd extensions/agentic-harness && npm test -- extension`

Expected:
- The 2 new `should NOT register team tool when PI_ENABLE_TEAM_MODE is...` tests PASS.
- All other `extension.test.ts` tests PASS (because `beforeEach` sets `PI_ENABLE_TEAM_MODE=1` for the active-team cases).
- Handler-gate tests in `team-tool.test.ts` may still FAIL — that's expected; they're addressed in Task 4.

- [ ] **Step 5: Verify build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/agentic-harness/index.ts
git commit -m "feat: gate team tool registration on PI_ENABLE_TEAM_MODE

Hide the LLM-callable team tool from agents when team mode is not explicitly
enabled. Registration-level gate matches the existing isRootSession/isTeamWorker
pattern.

Confidence: high
Scope-risk: narrow
Tested: extension.test.ts gate cases (unit)"
```

---

## Task 4: Gate the `/team` Slash Command Handler

**Dependencies:** Runs after Task 3 completes (same file `index.ts`)
**Files:**
- Modify: `extensions/agentic-harness/index.ts:1523-1529` (handler entry)

- [ ] **Step 1: Add the env guard at the top of the handler**

In `extensions/agentic-harness/index.ts`, locate lines 1523-1529:

```typescript
    handler: async (args, ctx) => {
      const parsed = parseTeamArgs(args ?? "");
      const isFollowUp = isTeamFollowUpCommand(parsed);
      if (!parsed.goal && !isFollowUp) {
        ctx.ui.notify("/team requires a goal, or follow-up mode: /team resume=<runId> command=<worker|taskId> message=\"...\"", "error");
        return;
      }
```

Replace with:

```typescript
    handler: async (args, ctx) => {
      if (process.env[PI_ENABLE_TEAM_MODE_ENV] !== "1") {
        ctx.ui.notify("team mode is disabled. Set PI_ENABLE_TEAM_MODE=1 to enable.", "error");
        return;
      }
      const parsed = parseTeamArgs(args ?? "");
      const isFollowUp = isTeamFollowUpCommand(parsed);
      if (!parsed.goal && !isFollowUp) {
        ctx.ui.notify("/team requires a goal, or follow-up mode: /team resume=<runId> command=<worker|taskId> message=\"...\"", "error");
        return;
      }
```

(Only the new 4-line `if` block is inserted at the top of the handler body; everything else is identical.)

- [ ] **Step 2: Run tests — handler-gate tests should now pass**

Run: `cd extensions/agentic-harness && npm test -- team-tool`

Expected:
- The 2 new `handler shows guidance...` tests PASS.
- All other `team-tool.test.ts` tests PASS (including the `forwards a structured prompt to pi.sendUserMessage on confirmed run` test, because `beforeEach` sets `PI_ENABLE_TEAM_MODE=1`).

- [ ] **Step 3: Verify build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add extensions/agentic-harness/index.ts
git commit -m "feat: gate /team slash command handler on PI_ENABLE_TEAM_MODE

The handler now returns a guidance message when the flag is unset, instead of
proceeding to confirm/dispatch. Slash command remains registered so completions
and discoverability are unaffected.

Confidence: high
Scope-risk: narrow
Tested: team-tool.test.ts handler-gate cases (unit)"
```

---

## Task 5: Update README

**Dependencies:** None (can run in parallel with Tasks 1-4)
**Files:**
- Modify: `extensions/agentic-harness/README.md:59-95` (header of "Lightweight Native Team Mode" section, and L112 area near `PI_TEAM_WORKER`)

- [ ] **Step 1: Add an "Enabling team mode" callout immediately under the section heading**

In `extensions/agentic-harness/README.md`, locate line 59:

```markdown
## Lightweight Native Team Mode

The `team` tool coordinates a small, bounded batch of existing pi subagents from the root session. Use it when a goal can be split into independent worker assignments and you want one synthesized result with task lifecycle status and explicit verification evidence. Use `subagent` directly for one-off delegation when you do not need team task records, lifecycle status, or final synthesis.
```

Replace with:

```markdown
## Lightweight Native Team Mode

> **Disabled by default.** Team mode is gated behind the `PI_ENABLE_TEAM_MODE` environment variable. Set `PI_ENABLE_TEAM_MODE=1` to enable both the LLM-callable `team` tool and the `/team` slash command. When unset, the `team` tool is not registered (hidden from the agent), and invoking `/team` returns the guidance message `team mode is disabled. Set PI_ENABLE_TEAM_MODE=1 to enable.` The `/team` command itself remains registered so it appears in completions and help output.

The `team` tool coordinates a small, bounded batch of existing pi subagents from the root session. Use it when a goal can be split into independent worker assignments and you want one synthesized result with task lifecycle status and explicit verification evidence. Use `subagent` directly for one-off delegation when you do not need team task records, lifecycle status, or final synthesis.
```

- [ ] **Step 2: Mention the activation flag near the existing `PI_TEAM_WORKER` line for symmetry**

Locate line 112:

```markdown
- Runs team workers with `PI_TEAM_WORKER=1`, which suppresses recursive orchestration tools such as `team` and `subagent` inside workers.
```

Replace with:

```markdown
- Activated only when the root session has `PI_ENABLE_TEAM_MODE=1` (default off). Runs team workers with `PI_TEAM_WORKER=1`, which suppresses recursive orchestration tools such as `team` and `subagent` inside workers.
```

- [ ] **Step 3: Verify the README still satisfies `extension.test.ts` content assertions**

`extension.test.ts:161-166` asserts the README contains specific strings (`backend: "auto"` description, tmux-related phrases, `sandbox`). None of those strings live in the section we edited, but verify by running:

Run: `cd extensions/agentic-harness && npm test -- extension`
Expected: PASS (including the README content assertions in `should expose the documented team tool parameter contract`).

- [ ] **Step 4: Commit**

```bash
git add extensions/agentic-harness/README.md
git commit -m "docs: document PI_ENABLE_TEAM_MODE feature flag

Add disabled-by-default callout to the team mode section header and reference
the flag alongside the existing PI_TEAM_WORKER documentation.

Confidence: high
Scope-risk: narrow"
```

---

## Task 6 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `cd extensions/agentic-harness && npm test`
Expected: ALL PASS — no regressions in any existing test, plus the 4 new gate tests pass.

- [ ] **Step 2: Run type check / build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS (`tsc --noEmit` exits 0).

- [ ] **Step 3: Verify plan success criteria**

Manually walk through each criterion from the brief:

- [ ] Criterion 1: When `PI_ENABLE_TEAM_MODE` is unset or any value other than `"1"`, calling `/team` produces only the guidance notify; no worker spawned, no `team-run.json` written. (Validated by `team-tool.test.ts` handler-gate tests.)
- [ ] Criterion 2: When `PI_ENABLE_TEAM_MODE=1`, `/team` and the `team` tool behave exactly as before. (Validated by all pre-existing tests passing under `beforeEach` env=1.)
- [ ] Criterion 3: Existing test suite passes after env-handling changes. (Step 1 above.)
- [ ] Criterion 4: `/team` command remains registered (visible in completions/help) regardless of the flag. (Validated by `tests/team-tool.test.ts:183 registers the team slash command...` continuing to pass even with the env unset path — confirmed by inspecting the test, which does not rely on `PI_ENABLE_TEAM_MODE` for command registration.)
- [ ] Criterion 5: README clearly documents the gate, activation, and disabled behavior. (Manually re-read the edited section in `extensions/agentic-harness/README.md`.)

- [ ] **Step 4: Sanity check against runtime expectation (optional manual smoke)**

If a `pi` CLI is conveniently available locally, run an interactive sanity check (skip if not available — unit tests already cover behavior):

```bash
# Without flag — slash command should reject
PI_ENABLE_TEAM_MODE= pi    # then type: /team goal="hello"
# Expected: notify "team mode is disabled. Set PI_ENABLE_TEAM_MODE=1 to enable."

# With flag — slash command should proceed normally
PI_ENABLE_TEAM_MODE=1 pi   # then type: /team goal="hello"
# Expected: confirmation prompt as before
```

If this smoke step is impractical in the worker's environment, note that and rely on the unit tests.

- [ ] **Step 5: Confirm no commits were skipped**

Run: `git log --oneline -10` and verify the four commits from Tasks 1, 2, 3, 4, 5 are present (test, feat, feat, feat, docs). If Task 1 produced no commit (because the worker batched), make sure the test changes are not orphaned.

If everything passes, the plan is complete. Otherwise, surface the failing item with full output.
