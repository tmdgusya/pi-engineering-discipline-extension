# Subagent Integration Test Hardening Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Add deeper integration coverage for `context: "fork"` positive-path launch behavior and `runAgent` artifact-output orchestration.

**Architecture:** This is a test-only hardening plan. The existing `runAgent` fixture process will be extended to record launch arguments and to write artifact output through `PI_SUBAGENT_OUTPUT_FILE`; `tests/subagent-process.test.ts` will add end-to-end assertions that exercise the real `runAgent` spawn/orchestration path rather than only helper functions.

**Tech Stack:** TypeScript, Node.js ESM fixtures, Vitest, existing `runAgent` process fixture tests.

**Work Scope:**
- **In scope:** Extend the existing subagent process fixture; add positive-path `context: "fork"` integration test; add artifact output end-to-end integration test; run targeted and full verification.
- **Out of scope:** Production behavior changes unless a new test exposes a real defect; Pi core/session API implementation changes; adding new dependencies; changing artifact helper path policy; changing worktree behavior.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm ci && npm run build && npm test`
- **What it validates:** TypeScript compilation and the complete Vitest suite, including the new integration tests for fork launch arguments/env propagation and artifact output readback.

**Project Capability Discovery:**
- Bundled agents available through the harness: `explorer`, `worker`, `planner`, `plan-worker`, `plan-validator`, `plan-compliance`, and reviewer agents.
- Relevant project skills available in this repository: `agentic-run-plan`, `agentic-review-work`, `agentic-systematic-debugging`.
- Workers may execute this plan directly; no external agent is required.

---

## File Structure Mapping

| File | Responsibility | Planned Changes |
|---|---|---|
| `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs` | Child-process fixture used by `runAgent` integration tests | Record `process.argv` and context/artifact env vars in fixture state; add `write-output` mode that writes to `PI_SUBAGENT_OUTPUT_FILE`. |
| `extensions/agentic-harness/tests/subagent-process.test.ts` | End-to-end tests for `runAgent` process orchestration | Add fork positive-path test and artifact output orchestration test. |

No production source file is expected to change for this plan. If production code must change to make the tests pass, stop and document the failure before modifying production code.

---

## Task 1: Add `context: "fork"` Positive-Path Integration Test

**Dependencies:** None

**Files:**
- Modify: `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`
- Modify: `extensions/agentic-harness/tests/subagent-process.test.ts`

- [ ] **Step 1: Extend the fixture state with argv and context env capture**

In `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`, replace the existing `updateState({ ... })` block with this exact block:

```js
updateState({
  parentPid: process.pid,
  mode,
  argv: process.argv.slice(2),
  runId: process.env.PI_SUBAGENT_RUN_ID,
  parentRunId: process.env.PI_SUBAGENT_PARENT_RUN_ID,
  rootRunId: process.env.PI_SUBAGENT_ROOT_RUN_ID,
  owner: process.env.PI_SUBAGENT_OWNER,
  contextMode: process.env.PI_SUBAGENT_CONTEXT_MODE,
  artifactDir: process.env.PI_SUBAGENT_ARTIFACT_DIR,
  outputFile: process.env.PI_SUBAGENT_OUTPUT_FILE,
  progressFile: process.env.PI_SUBAGENT_PROGRESS_FILE,
  grandchildPid: grandchild.pid,
});
```

Expected result: the fixture records the exact CLI flags and env values seen by the spawned process without changing behavior for existing tests.

- [ ] **Step 2: Add the fork positive-path test**

In `extensions/agentic-harness/tests/subagent-process.test.ts`, insert the following test inside the existing `describe.runIf(process.platform !== "win32")("runAgent process ownership", () => { ... })` block, after the `keeps semantic success when abort arrives after agent_end` test and before the `kills owned descendants when aborted` test:

```ts
  it("passes --fork and the parent session id when context fork is requested", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-fork-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");
    const originalForkSession = process.env.PI_SUBAGENT_FORK_SESSION;

    process.argv = [process.execPath, fixtureScript];
    process.env.PI_SUBAGENT_FORK_SESSION = "parent-session-123";

    try {
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
        task: "success-hang",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "root-fork-run", owner: "test-suite" },
        extraEnv: {
          FIXTURE_STATE_FILE: stateFile,
        },
        contextMode: "fork",
        makeDetails: (results) => ({ mode: "single", results }),
      });

      await waitFor(() => !!loadState(stateFile).grandchildPid, 2000);
      const state = loadState(stateFile);
      trackedPids.add(state.parentPid);
      trackedPids.add(state.grandchildPid);

      expect(result.exitCode).toBe(0);
      expect(result.contextMode).toBe("fork");
      expect(state.contextMode).toBe("fork");
      expect(state.argv).toContain("--fork");
      expect(state.argv).toContain("parent-session-123");
      expect(state.argv).not.toContain("--no-session");
    } finally {
      if (originalForkSession === undefined) delete process.env.PI_SUBAGENT_FORK_SESSION;
      else process.env.PI_SUBAGENT_FORK_SESSION = originalForkSession;
    }
  });
```

Expected result: this test exercises the real `runAgent` spawn path and verifies that `contextMode: "fork"` produces `--fork parent-session-123`, propagates `PI_SUBAGENT_CONTEXT_MODE=fork`, and does not add `--no-session`.

- [ ] **Step 3: Run the targeted fork test**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/subagent-process.test.ts -t "passes --fork"
```

Expected: PASS. If it fails because the fixture does not receive `--fork`, inspect `buildPiArgs` in `extensions/agentic-harness/subagent.ts` but do not change production code unless the failure proves the existing implementation violates the planned behavior.

- [ ] **Step 4: Run the full subagent process fixture file**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/subagent-process.test.ts
```

Expected: PASS for all tests in `tests/subagent-process.test.ts`.

- [ ] **Step 5: Commit Task 1 changes**

Run:

```bash
git add extensions/agentic-harness/tests/fixtures/subagent-parent.mjs extensions/agentic-harness/tests/subagent-process.test.ts
git commit -m "test: cover fork context launch path"
```

Expected: a commit containing only the fixture capture change and the fork positive-path test. If the repository workflow does not allow commits in this environment, record the intended commit message in the execution notes and continue without committing.

---

## Task 2: Add `runAgent` Artifact Output Orchestration Integration Test

**Dependencies:** Runs after Task 1 completes because this task modifies the same fixture and test file.

**Files:**
- Modify: `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`
- Modify: `extensions/agentic-harness/tests/subagent-process.test.ts`

- [ ] **Step 1: Import `mkdirSync` in the fixture**

In `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`, change the first import from:

```js
import { existsSync, readFileSync, writeFileSync } from "fs";
```

to:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
```

Expected result: the fixture can create the artifact output directory before writing the final answer file.

- [ ] **Step 2: Add `write-output` fixture behavior**

In `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs`, insert the following block immediately after the `console.log(JSON.stringify({ type: "message_end", message: assistantMessage }));` line and before the existing `if (mode === "success-hang" || mode === "agent-end-fail") {` block:

```js
if (mode === "write-output" && process.env.PI_SUBAGENT_OUTPUT_FILE) {
  mkdirSync(dirname(process.env.PI_SUBAGENT_OUTPUT_FILE), { recursive: true });
  writeFileSync(process.env.PI_SUBAGENT_OUTPUT_FILE, "artifact final answer", "utf8");
  console.log(JSON.stringify({ type: "agent_end", messages: [assistantMessage] }));
  process.exit(0);
}
```

Expected result: when the task is `write-output`, the child process writes `artifact final answer` to the output file specified by `runAgent` and exits successfully.

- [ ] **Step 3: Add the artifact output orchestration test**

In `extensions/agentic-harness/tests/subagent-process.test.ts`, insert this test inside the same `describe.runIf(process.platform !== "win32")("runAgent process ownership", () => { ... })` block, after the fork test added in Task 1 and before the `kills owned descendants when aborted` test:

```ts
  it("reads artifact output written by the child process", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "subagent-process-output-"));
    tempDirs.push(tempDir);
    const stateFile = join(tempDir, "state.json");
    const originalArtifactRoot = process.env.PI_SUBAGENT_ARTIFACT_ROOT;

    process.argv = [process.execPath, fixtureScript];
    process.env.PI_SUBAGENT_ARTIFACT_ROOT = join(tempDir, ".runs");

    try {
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
        task: "write-output",
        cwd: tempDir,
        depthConfig: resolveDepthConfig(),
        ownership: { runId: "root-output-run", owner: "test-suite" },
        extraEnv: {
          FIXTURE_STATE_FILE: stateFile,
        },
        output: "final.md",
        makeDetails: (results) => ({ mode: "single", results }),
      });

      const state = loadState(stateFile);

      expect(result.exitCode).toBe(0);
      expect(result.artifacts?.artifactDir).toBe(join(tempDir, ".runs", "root-output-run", "subagents", "fixture-root-output-run"));
      expect(result.artifacts?.outputFile).toBe(join(result.artifacts!.artifactDir, "final.md"));
      expect(state.outputFile).toBe(result.artifacts?.outputFile);
      expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "artifact final answer" }]);
    } finally {
      if (originalArtifactRoot === undefined) delete process.env.PI_SUBAGENT_ARTIFACT_ROOT;
      else process.env.PI_SUBAGENT_ARTIFACT_ROOT = originalArtifactRoot;
    }
  });
```

Expected result: this test proves the real child process receives `PI_SUBAGENT_OUTPUT_FILE`, writes to it, and `runAgent` reads that file back into the final assistant message.

- [ ] **Step 4: Run the targeted artifact output test**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/subagent-process.test.ts -t "reads artifact output"
```

Expected: PASS. If it fails because the expected artifact directory differs, inspect `createArtifactContext` sanitization rules and update the test expectation only if the implementation's existing path semantics are correct.

- [ ] **Step 5: Run the full subagent process fixture file**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/subagent-process.test.ts
```

Expected: PASS for all tests in `tests/subagent-process.test.ts`.

- [ ] **Step 6: Commit Task 2 changes**

Run:

```bash
git add extensions/agentic-harness/tests/fixtures/subagent-parent.mjs extensions/agentic-harness/tests/subagent-process.test.ts
git commit -m "test: cover artifact output orchestration"
```

Expected: a commit containing only the fixture output mode and the artifact output integration test. If the repository workflow does not allow commits in this environment, record the intended commit message in the execution notes and continue without committing.

---

## Task 3 (Final): End-to-End Verification

**Dependencies:** Runs after Task 1 and Task 2 complete.

**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run:

```bash
cd extensions/agentic-harness && npm ci && npm run build && npm test
```

Expected: ALL PASS. The expected Vitest count must be at least 264 tests because this plan adds two tests to the existing 262-test suite.

- [ ] **Step 2: Verify plan success criteria**

Manually check each criterion:

- [ ] `tests/subagent-process.test.ts` contains a test named `passes --fork and the parent session id when context fork is requested`.
- [ ] The fork test asserts `result.contextMode === "fork"`.
- [ ] The fork test asserts child fixture argv contains `--fork` and `parent-session-123`.
- [ ] The fork test asserts child fixture argv does not contain `--no-session`.
- [ ] `tests/subagent-process.test.ts` contains a test named `reads artifact output written by the child process`.
- [ ] The artifact output test asserts `PI_SUBAGENT_OUTPUT_FILE` was observed by the fixture.
- [ ] The artifact output test asserts the final result message includes `artifact final answer` read back from the output file.
- [ ] `extensions/agentic-harness/tests/fixtures/subagent-parent.mjs` keeps existing modes `success-hang`, `agent-end-fail`, and `abort-hang` working.
- [ ] No production files were changed unless a test exposed a verified implementation defect.

- [ ] **Step 3: Check for residual artifacts**

Run:

```bash
git status --short
```

Expected: only the planned test fixture/test file changes are present unless production changes were explicitly justified by a failing test.

- [ ] **Step 4: Record final verification result**

Append a short note to the execution summary or task tracker with:

```markdown
Final verification for subagent integration test hardening:
- `cd extensions/agentic-harness && npm ci && npm run build && npm test`: PASS
- Added fork positive-path integration coverage.
- Added artifact output orchestration integration coverage.
```

---

## Self-Review

**Spec coverage:**
- `context: "fork"` positive-path integration test is covered by Task 1.
- `runAgent` artifact output orchestration integration test is covered by Task 2.
- Final full verification is covered by Task 3.

**Placeholder scan:** No `TBD`, `TODO`, `implement later`, or unspecified edge handling remains in this plan.

**Type consistency:** Test code uses existing imports already present in `tests/subagent-process.test.ts`: `mkdtempSync`, `readFileSync`, `rmSync`, `tmpdir`, `join`, `runAgent`, and `resolveDepthConfig`. Fixture code uses existing `dirname` import and adds `mkdirSync` to the existing `fs` import.

**Dependency verification:** Task 1 and Task 2 both modify `subagent-parent.mjs` and `subagent-process.test.ts`, so Task 2 correctly depends on Task 1. Task 3 depends on both implementation tasks.

**Verification coverage:** The plan includes a final verification task using the discovered project-level command `cd extensions/agentic-harness && npm ci && npm run build && npm test`.
