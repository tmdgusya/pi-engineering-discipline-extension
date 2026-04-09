# Autonomous Dev Process Cleanup Review Fixes Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Fix the merge-blocking review issues in the nested worker reaping branch without changing the intended POSIX process-group cleanup behavior.

**Architecture:** Keep the current `runAgent()` ownership model and autonomous-dev integration, but make shutdown accounting truthful and preserve Node’s default signal termination behavior. The fix is limited to lifecycle semantics, result normalization, and regression tests; it does not redesign the logging subsystem or add Windows process-tree reaping.

**Tech Stack:** TypeScript, Node.js child process/signal APIs, pi extension API, Vitest

**Work Scope:**
- **In scope:** restore default `SIGINT`/`SIGTERM` termination behavior in `autonomous-dev`, capture close signals in `runAgent()`, stop masking real post-`agent_end` failures as success, preserve semantic success if cancellation arrives after semantic completion, and add regression tests/fixtures for those cases.
- **Out of scope:** Windows descendant-process reaping, log sink unification between `logger.ts` and direct lifecycle appends, changing the 250ms grace window, or broader autonomous-dev feature work.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npx vitest run`
- **What it validates:** the full extension regression suite passes, including the new autonomous-dev shutdown tests and subagent lifecycle/process-ownership tests.

---

## File Structure Mapping

- **Modify:** `extensions/autonomous-dev/index.ts`
  - Responsibility: autonomous-dev lifecycle hook registration and process cleanup behavior
- **Modify:** `extensions/autonomous-dev/tests/index.test.ts`
  - Responsibility: regression coverage for command registration and signal-cleanup behavior
- **Modify:** `extensions/agentic-harness/subagent.ts`
  - Responsibility: subagent lifecycle tracking, close-signal capture, and final result normalization
- **Modify:** `extensions/agentic-harness/tests/subagent-process.test.ts`
  - Responsibility: end-to-end process ownership and shutdown semantics regression coverage
- **Modify:** `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`
  - Responsibility: process fixture modes that simulate semantic success, abort, and late failure after `agent_end`

## Project Capability Discovery

- **Bundled agents available:** `explorer`, `worker`, `planner`, `plan-worker`, `plan-validator`, `plan-compliance`, review agents
- **Project-specific agents:** none found under `.agents/` or `.pi/agents/`
- **Project-specific skills:** none found under `.agents/skills/` or `.pi/skills/`

Use `plan-worker` for execution and `plan-validator` for independent verification if this plan is run via subagents.

---

### Task 1: Restore default SIGINT/SIGTERM termination behavior in autonomous-dev

**Dependencies:** None (can run in parallel)
**Files:**
- Modify: `extensions/autonomous-dev/index.ts:168-182`
- Test: `extensions/autonomous-dev/tests/index.test.ts:121-140`
- Test: `extensions/autonomous-dev/tests/index.test.ts` (add new regression test near the command-registration block)

- [ ] **Step 1: Add a helper that cleans up and then re-raises the original signal**

In `extensions/autonomous-dev/index.ts`, replace the current `ensureProcessCleanupHooks()` implementation with the block below so the extension still runs cleanup, but does not swallow Node’s default process termination behavior:

```ts
function cleanupAndReraise(signalName: NodeJS.Signals): void {
  cleanupAutonomousDev();
  process.kill(process.pid, signalName);
}

function ensureProcessCleanupHooks(): void {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;

  process.once("exit", () => {
    cleanupAutonomousDev();
  });

  process.once("SIGINT", () => {
    cleanupAndReraise("SIGINT");
  });

  process.once("SIGTERM", () => {
    cleanupAndReraise("SIGTERM");
  });
}
```

- [ ] **Step 2: Keep the existing registration test green**

Run:

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
npx vitest run extensions/autonomous-dev/tests/index.test.ts -t "registers autonomous-dev with a string name and handler when enabled"
```

Expected: PASS, and the existing assertions about registering `exit`, `SIGINT`, and `SIGTERM` listeners still succeed.

- [ ] **Step 3: Add a regression test that proves the signal handler re-raises the signal**

In `extensions/autonomous-dev/tests/index.test.ts`, add the following test inside the `describe("autonomous-dev extension command registration", ...)` block, after the existing registration test:

```ts
it("re-raises SIGINT after cleanup so process termination semantics are preserved", async () => {
  process.env.PI_AUTONOMOUS_DEV = "1";
  const onceSpy = vi.spyOn(process, "once");
  const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as any);
  const { default: registerExtension } = await import("../index.js");
  const pi = createPiMock();

  registerExtension(pi);

  const sigintHandler = onceSpy.mock.calls.find(([event]) => event === "SIGINT")?.[1] as (() => void) | undefined;
  expect(sigintHandler).toBeTypeOf("function");

  sigintHandler?.();

  expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");
});
```

- [ ] **Step 4: Run the autonomous-dev test file**

Run:

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
npx vitest run extensions/autonomous-dev/tests/index.test.ts
```

Expected: PASS, including the new signal re-raise regression test.

- [ ] **Step 5: Commit Task 1**

```bash
git add extensions/autonomous-dev/index.ts extensions/autonomous-dev/tests/index.test.ts
git commit -m "fix(autonomous-dev): preserve default signal termination behavior"
```

---

### Task 2: Make subagent shutdown accounting truthful and stop masking real failures

**Dependencies:** None (can run in parallel)
**Files:**
- Modify: `extensions/agentic-harness/subagent.ts:177-188`
- Modify: `extensions/agentic-harness/subagent.ts:298-499`
- Modify: `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs:8-52`
- Test: `extensions/agentic-harness/tests/subagent-process.test.ts:54-142`

- [ ] **Step 1: Extend close-event bookkeeping so `runAgent()` knows why the child stopped**

In `extensions/agentic-harness/subagent.ts`, update `RunLifecycleEvent` and the `runAgent()` local state so the close handler preserves both exit code and terminating signal:

```ts
export interface RunLifecycleEvent {
  phase: "spawned" | "terminating" | "closed";
  runId: string;
  parentRunId?: string;
  rootRunId: string;
  owner?: string;
  pid: number;
  pgid?: number;
  reason?: string;
  signal?: NodeJS.Signals;
  exitCode?: number | null;
}
```

Inside `runAgent()`, add these locals next to `let wasAborted = false;`:

```ts
let wasAborted = false;
let semanticTerminationRequested = false;
let closeSignal: NodeJS.Signals | undefined;
const lifecycleWrites: Promise<void>[] = [];
```

- [ ] **Step 2: Mark semantic-success reaping separately from abort-driven termination**

In the `flushLine()` branch that starts the grace timer, set a dedicated flag before terminating the process group:

```ts
graceTimer = setTimeout(() => {
  if (!didClose && !settled && result.sawAgentEnd) {
    semanticTerminationRequested = true;
    requestTermination("agent_end_grace_elapsed");
  }
}, AGENT_END_GRACE_MS);
```

Keep `abortHandler` setting `wasAborted = true`, but do not set `semanticTerminationRequested` there.

- [ ] **Step 3: Update the close handler so logs record the real signal and raw exit code**

Replace the current `proc.on("close", ...)` block in `extensions/agentic-harness/subagent.ts` with:

```ts
proc.on("close", (code, signalName) => {
  didClose = true;
  closeSignal = signalName ?? undefined;

  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.trim()) flushLine(line);
    }
  }

  if (pid > 0) {
    emitLifecycle({
      phase: "closed",
      runId: resolvedOwnership.runId,
      parentRunId: resolvedOwnership.parentRunId,
      rootRunId: resolvedOwnership.rootRunId,
      owner: resolvedOwnership.owner,
      pid,
      pgid,
      signal: closeSignal,
      exitCode: code ?? null,
    });
  }

  if (code !== null) {
    finish(code);
    return;
  }

  if (closeSignal === "SIGTERM") {
    finish(143);
    return;
  }

  if (closeSignal === "SIGKILL") {
    finish(137);
    return;
  }

  finish(1);
});
```

- [ ] **Step 4: Tighten final result normalization so only expected semantic reaping becomes success**

Replace the normalization block near the end of `runAgent()` with:

```ts
result.exitCode = exitCode;

const hasSemanticOutput = result.sawAgentEnd && !!getFinalOutput(result.messages).trim();
const endedViaSemanticReap = semanticTerminationRequested && hasSemanticOutput && (closeSignal === "SIGTERM" || closeSignal === "SIGKILL");

if (endedViaSemanticReap) {
  result.exitCode = 0;
  if (result.stopReason === "error") result.stopReason = undefined;
  result.errorMessage = undefined;
} else if (wasAborted) {
  result.exitCode = 130;
  result.stopReason = "aborted";
  result.errorMessage = "Subagent was aborted.";
} else if (result.exitCode > 0) {
  if (!result.stopReason) result.stopReason = "error";
  if (!result.errorMessage && result.stderr.trim()) result.errorMessage = result.stderr.trim();
}
```

This preserves success for the expected post-`agent_end` reap path, but stops converting unrelated post-`agent_end` failures into success. It also ensures a late abort does not override already-completed semantic success.

- [ ] **Step 5: Add a fixture mode that emits `agent_end` and then exits with code 1**

In `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`, replace the bottom section starting at `const assistantMessage = { ... }` with this block:

```js
const assistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: mode === "success-hang" ? "fixture complete" : mode === "agent-end-fail" ? "fixture failed after completion" : "fixture waiting" }],
};

console.log(JSON.stringify({ type: "message_end", message: assistantMessage }));
if (mode === "success-hang" || mode === "agent-end-fail") {
  console.log(JSON.stringify({ type: "agent_end", messages: [assistantMessage] }));
}

if (mode === "agent-end-fail") {
  setTimeout(() => {
    process.exit(1);
  }, 25);
} else {
  const keepAlive = setInterval(() => {
    // keep process and descendant alive until parent kills the process group
  }, 1000);

  const shutdown = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
```

- [ ] **Step 6: Extend the process-ownership test file with two regressions**

In `extensions/agentic-harness/tests/subagent-process.test.ts`, add the following tests inside the existing POSIX-only `describe.runIf(...)` block.

First, add a log-truthfulness assertion to the existing success test by parsing the closed event rather than only searching for substrings:

```ts
const events = readFileSync(logFile, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const closedEvent = events.find((event) => event.phase === "closed");
expect(closedEvent).toMatchObject({
  phase: "closed",
  runId: "root-success-run",
  signal: "SIGTERM",
  exitCode: null,
});
```

Then add this failure-regression test:

```ts
it("does not convert a post-agent_end failure into success", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-agent-end-fail-"));
  tempDirs.push(tempDir);
  const stateFile = join(tempDir, "state.json");

  process.argv = [process.execPath, fixtureScript];

  const result = await runAgent({
    agent: {
      name: "fixture",
      description: "fixture agent",
      filePath: fixtureScript,
      source: "project",
      systemPrompt: "",
      tools: [],
    },
    agentName: "fixture",
    task: "agent-end-fail",
    cwd: tempDir,
    depthConfig: resolveDepthConfig(),
    ownership: { runId: "root-agent-end-fail", owner: "test-suite" },
    extraEnv: {
      FIXTURE_STATE_FILE: stateFile,
    },
    makeDetails: (results) => ({ mode: "single", results }),
  });

  expect(result.exitCode).toBe(1);
  expect(result.stopReason).toBe("error");
});
```

Finally add this late-abort regression test:

```ts
it("keeps semantic success when abort arrives after agent_end", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-late-abort-"));
  tempDirs.push(tempDir);
  const stateFile = join(tempDir, "state.json");

  process.argv = [process.execPath, fixtureScript];
  const controller = new AbortController();

  const runPromise = runAgent({
    agent: {
      name: "fixture",
      description: "fixture agent",
      filePath: fixtureScript,
      source: "project",
      systemPrompt: "",
      tools: [],
    },
    agentName: "fixture",
    task: "success-hang",
    cwd: tempDir,
    depthConfig: resolveDepthConfig(),
    ownership: { runId: "root-late-abort", owner: "test-suite" },
    extraEnv: {
      FIXTURE_STATE_FILE: stateFile,
    },
    signal: controller.signal,
    makeDetails: (results) => ({ mode: "single", results }),
  });

  await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
  controller.abort();
  const result = await runPromise;

  expect(result.exitCode).toBe(0);
  expect(result.stopReason).not.toBe("aborted");
});
```

- [ ] **Step 7: Run the focused harness lifecycle tests**

Run:

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
npx vitest run extensions/agentic-harness/tests/subagent-process.test.ts extensions/agentic-harness/tests/subagent.test.ts
```

Expected: PASS, including the new close-signal, post-`agent_end` failure, and late-abort regressions.

- [ ] **Step 8: Commit Task 2**

```bash
git add extensions/agentic-harness/subagent.ts extensions/agentic-harness/tests/fixtures/subagent-parent.mjs extensions/agentic-harness/tests/subagent-process.test.ts
git commit -m "fix(agentic-harness): make subagent shutdown accounting truthful"
```

---

### Task 3 (Final): Full verification and review closure

**Dependencies:** Runs after Task 1 and Task 2 complete
**Files:** None (read-only verification)

- [ ] **Step 1: Run the highest-level verification command**

Run:

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
npx vitest run
```

Expected: ALL PASS.

- [ ] **Step 2: Run build checks for the touched packages**

Run:

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/agentic-harness && npm run build
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension/extensions/autonomous-dev && npm run build
```

Expected: both commands exit 0 with no TypeScript errors.

- [ ] **Step 3: Verify the review success criteria manually**

Confirm each item below before declaring the work done:
- [ ] `autonomous-dev` cleanup hooks still run on session shutdown and process exit.
- [ ] Receiving `SIGINT` or `SIGTERM` no longer leaves the host process alive because of extension-installed listeners.
- [ ] `runAgent()` lifecycle logs record whether the child closed by exit code or by signal.
- [ ] A child that emits `agent_end` and then fails with a real non-zero exit is reported as failed.
- [ ] A child that semantically completed and is then reaped by the grace-timer path is still reported as success.
- [ ] A late abort after semantic completion does not incorrectly downgrade a completed run to `aborted`.

- [ ] **Step 4: Inspect the final diff before merge**

Run:

```bash
cd /home/roach/.pi/agent/extensions/pi-engineering-discipline-extension
git diff --stat origin/main...HEAD
```

Expected: only the planned files are changed for this fix set.

---

## Self-Review

- **Spec coverage:** The plan covers the three merge-critical findings from review: swallowed process termination in `autonomous-dev`, inaccurate close-event/lifecycle accounting, and false success normalization after `agent_end`. It also covers the late-abort edge case called out in review. Windows process-tree cleanup and log-sink unification are intentionally excluded and documented as out of scope.
- **Placeholder scan:** No `TODO`, `TBD`, or “figure it out” steps remain. Every code-changing step contains concrete code or exact commands.
- **Type consistency:** `RunLifecycleEvent.signal` is reused for closed-event signals; no new inconsistent property names are introduced. `cleanupAndReraise()` is referenced consistently.
- **Dependency verification:** Task 1 and Task 2 modify disjoint file sets and can run in parallel. Task 3 depends on both.
- **Verification coverage:** The plan includes a declared verification strategy and a final verification task using `npx vitest run`, plus package build checks.
