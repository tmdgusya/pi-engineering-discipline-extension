# Team Mode Result-First Summary Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Improve the `team` tool success/failure result so users first see what was done, which files changed, whether verification passed, and whether any blockers remain.

**Architecture:** Keep team execution behavior unchanged and improve only the formatting layer. `runTeam()` will still produce the same task records and verification evidence, while `formatTeamRunSummary()` will render a result-first TL;DR before detailed worker reports and structured evidence. Lightweight parsing helpers in `team.ts` will extract common worker report sections such as changed files, verification, and blockers from existing worker summaries.

**Tech Stack:** TypeScript, Vitest, existing agentic-harness team orchestration code.

**Work Scope:**
- **In scope:** Result-first `team` tool output, output/file summary extraction from worker reports, concise verification/blocker summary, preserving detailed worker report and structured evidence below the TL;DR, unit tests for the new format.
- **Out of scope:** Changing worker execution, changing tmux/native backend selection, changing durable team state schema, changing `/team` slash command parsing, changing `terminate` behavior in `index.ts`.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test -- team.test.ts && npm run build`
- **What it validates:** The focused team-mode tests pass, the new result-first summary formatting behaves as specified, and TypeScript type-checking succeeds.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/tests/team.test.ts`
  - Add regression coverage for result-first formatting.
  - Update existing formatting assertions only if necessary to account for new headings while preserving structured evidence.
- Modify `extensions/agentic-harness/team.ts`
  - Add private formatting helpers near `formatTeamRunSummary()`.
  - Rework `formatTeamRunSummary()` so it starts with concise result-oriented sections and moves worker details below.
- No new runtime files are required.
- No durable state schema changes are required.

## Project Capability Discovery

- Bundled agents available: `explorer`, `worker`, `planner`, `plan-worker`, `plan-validator`, `plan-compliance`, and reviewer agents.
- Relevant project tests: `extensions/agentic-harness/tests/team.test.ts` with Vitest.
- Relevant commands from `extensions/agentic-harness/package.json`:
  - `npm test -- team.test.ts`
  - `npm run build`

---

## Success Criteria

- Team tool formatted output starts with a concise status line and a `## Summary` section before any worker details.
- The top summary includes the goal, backend, completed/total task count, failed count, and blocked count.
- The top summary includes an `## Outputs` section populated from worker `Changed files` / `Changed files`-style report sections when present.
- The top summary includes an `## Verification` section with PASS/FAIL from `verificationEvidence` and worker-reported checks when present.
- The top summary includes an `## Risks / Blockers` section that says `- None reported.` when no blocker/failure details are found.
- Detailed per-worker reports and existing structured evidence are still present below the top summary.
- Focused Vitest tests and TypeScript build pass.

---

### Task 1: Add Result-First Summary Tests

**Dependencies:** None (can run first)

**Files:**
- Modify: `extensions/agentic-harness/tests/team.test.ts`

- [ ] **Step 1: Add a regression test for result-first formatting**

In `extensions/agentic-harness/tests/team.test.ts`, inside the existing `describe("runTeam", () => { ... })` block near the current `formats structured verification evidence without dropping refs or failure details` test, add this test:

```ts
  it("formats team results with a result-first summary before worker details", () => {
    const [task1, task2] = createDefaultTeamTasks("Draw architecture", 2, "worker");
    task1.status = "completed";
    task1.resultSummary = [
      "# Worker 1 Final Report",
      "",
      "## Changed files",
      "- `TEAM_ARCH.md` — added a Mermaid flowchart.",
      "",
      "## Verification performed",
      "- `git diff --check` — PASS.",
      "",
      "## Blockers/risks",
      "- none",
    ].join("\n");
    task2.status = "completed";
    task2.resultSummary = [
      "# Worker 2 Final Report",
      "",
      "## Changed files",
      "- `docs/engineering-discipline/harness/team-mode-architecture.md` — added a Mermaid flowchart.",
      "",
      "## Verification",
      "- `python3` sanity check — PASS.",
      "",
      "## Blockers/risks",
      "- None.",
    ].join("\n");

    const summary = synthesizeTeamRun("Draw architecture", [task1, task2], [
      fakeResult("worker", "prompt", task1.resultSummary),
      fakeResult("worker", "prompt", task2.resultSummary),
    ]);

    const formatted = formatTeamRunSummary(summary);

    expect(formatted).toMatch(/^Team completed: 2\/2 tasks completed for goal: Draw architecture/);
    expect(formatted.indexOf("## Summary")).toBeLessThan(formatted.indexOf("## Worker Details"));
    expect(formatted.indexOf("## Outputs")).toBeLessThan(formatted.indexOf("## Worker Details"));
    expect(formatted).toContain("- Goal: Draw architecture");
    expect(formatted).toContain("- Backend: native");
    expect(formatted).toContain("- `TEAM_ARCH.md` — added a Mermaid flowchart.");
    expect(formatted).toContain("- `docs/engineering-discipline/harness/team-mode-architecture.md` — added a Mermaid flowchart.");
    expect(formatted).toContain("- PASS: 2/2 worker tasks completed.");
    expect(formatted).toContain("- `git diff --check` — PASS.");
    expect(formatted).toContain("- `python3` sanity check — PASS.");
    expect(formatted).toContain("## Risks / Blockers");
    expect(formatted).toContain("- None reported.");
    expect(formatted).toContain("## Worker Details");
    expect(formatted).toContain("# Worker 1 Final Report");
    expect(formatted).toContain("Structured verification evidence:");
  });
```

- [ ] **Step 2: Run the new focused test and verify it fails before implementation**

Run:

```bash
cd extensions/agentic-harness && npm test -- team.test.ts -t "formats team results with a result-first summary before worker details"
```

Expected: FAIL because the current `formatTeamRunSummary()` starts with `summary.finalSynthesis` and does not render `## Summary`, `## Outputs`, `## Risks / Blockers`, or `## Worker Details` in the required order.

- [ ] **Step 3: Do not change implementation in this task**

Confirm only `extensions/agentic-harness/tests/team.test.ts` has changed:

```bash
git diff -- extensions/agentic-harness/tests/team.test.ts
```

Expected: diff shows the single new Vitest test above.

---

### Task 2: Implement Result-First Team Summary Formatting

**Dependencies:** Runs after Task 1 completes

**Files:**
- Modify: `extensions/agentic-harness/team.ts`

- [ ] **Step 1: Add worker-summary extraction helpers above `formatTeamRunSummary()`**

In `extensions/agentic-harness/team.ts`, immediately before the existing `export function formatTeamRunSummary(summary: TeamRunSummary): string {` declaration, add these helpers:

```ts
function normalizeWorkerReportItem(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (/^[-*]\s+(none|none\.|no blockers|no blockers\.|n\/a)$/i.test(trimmed)) return undefined;
  if (/^(none|none\.|no blockers|no blockers\.|n\/a)$/i.test(trimmed)) return undefined;
  if (/^#{1,6}\s+/.test(trimmed)) return undefined;
  if (/^[-*]\s+/.test(trimmed)) return trimmed;
  return `- ${trimmed}`;
}

function uniqueItems(items: string[]): string[] {
  return Array.from(new Set(items));
}

function extractWorkerReportSection(summaryText: string | undefined, headingMatchers: RegExp[]): string[] {
  if (!summaryText) return [];
  const lines = summaryText.split(/\r?\n/);
  const items: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)\s*$/);
    if (heading) {
      collecting = headingMatchers.some((matcher) => matcher.test(heading[1].trim()));
      continue;
    }
    if (!collecting) continue;
    const item = normalizeWorkerReportItem(line);
    if (item) items.push(item);
  }

  return uniqueItems(items);
}

function collectWorkerOutputs(tasks: TeamTask[]): string[] {
  return uniqueItems(tasks.flatMap((task) => extractWorkerReportSection(task.resultSummary, [
    /^(changed files|files changed|outputs?|changed files\/outputs?)$/i,
  ])));
}

function collectWorkerVerification(tasks: TeamTask[]): string[] {
  return uniqueItems(tasks.flatMap((task) => extractWorkerReportSection(task.resultSummary, [
    /^(verification|verification performed|checks|tests)$/i,
  ])));
}

function collectWorkerRisks(tasks: TeamTask[]): string[] {
  const reportedRisks = tasks.flatMap((task) => extractWorkerReportSection(task.resultSummary, [
    /^(blockers|blockers\/risks|risks|remaining blockers)$/i,
  ]));
  const taskFailures = tasks
    .filter((task) => task.errorMessage)
    .map((task) => `- ${task.id}: ${task.errorMessage}`);
  return uniqueItems([...reportedRisks, ...taskFailures]);
}

function formatWorkerDetails(tasks: TeamTask[]): string[] {
  return tasks.map((task) => [
    `### ${task.id} (${task.owner}, ${task.agent}): ${task.status}`,
    task.resultSummary || "No worker report captured.",
    task.terminal?.attachCommand ? `Attach: ${task.terminal.attachCommand}` : undefined,
    task.errorMessage ? `Error: ${task.errorMessage}` : undefined,
  ].filter(Boolean).join("\n"));
}
```

- [ ] **Step 2: Replace `formatTeamRunSummary()` with result-first output**

Replace the existing `formatTeamRunSummary()` function with this implementation:

```ts
export function formatTeamRunSummary(summary: TeamRunSummary): string {
  const evidence = summary.verificationEvidence;
  const outputs = collectWorkerOutputs(summary.tasks);
  const workerVerification = collectWorkerVerification(summary.tasks);
  const risks = collectWorkerRisks(summary.tasks);
  const statusWord = summary.success ? "completed" : "finished with failures";
  const verificationStatus = evidence.passed ? "PASS" : "FAIL";

  return [
    `Team ${statusWord}: ${summary.completedCount}/${summary.taskCount} tasks completed for goal: ${summary.goal}`,
    "",
    "## Summary",
    `- Goal: ${summary.goal}`,
    `- Backend: ${summary.backendUsed}`,
    `- Tasks: ${summary.completedCount}/${summary.taskCount} completed, ${summary.failedCount} failed, ${summary.blockedCount} blocked.`,
    `- Result: ${summary.success ? "All worker tasks completed." : "One or more worker tasks did not complete successfully."}`,
    "",
    "## Outputs",
    ...(outputs.length > 0 ? outputs : ["- No changed files or outputs were reported by workers."]),
    "",
    "## Verification",
    `- ${verificationStatus}: ${summary.completedCount}/${summary.taskCount} worker tasks completed.`,
    ...(workerVerification.length > 0 ? workerVerification : ["- No worker-reported verification commands were captured."]),
    "",
    "## Risks / Blockers",
    ...(risks.length > 0 ? risks : ["- None reported."]),
    "",
    "## Worker Details",
    ...formatWorkerDetails(summary.tasks),
    "",
    "Structured verification evidence:",
    `- checksRun: ${evidence.checksRun.join("; ") || "none"}`,
    `- passed: ${evidence.passed} (${evidence.passedChecks.join("; ") || "none"})`,
    `- failed: ${evidence.failed} (${evidence.failedChecks.join("; ") || "none"})`,
    `- artifactRefs: ${evidence.artifactRefs.join("; ") || "none"}`,
    `- worktreeRefs: ${evidence.worktreeRefs.join("; ") || "none"}`,
    `- notes: ${evidence.notes.join("; ") || "none"}`,
  ].join("\n");
}
```

- [ ] **Step 3: Run the focused new test**

Run:

```bash
cd extensions/agentic-harness && npm test -- team.test.ts -t "formats team results with a result-first summary before worker details"
```

Expected: PASS.

- [ ] **Step 4: Run the full team test file**

Run:

```bash
cd extensions/agentic-harness && npm test -- team.test.ts
```

Expected: PASS. If an existing assertion fails because it expects old wording near `formatTeamRunSummary()`, update the assertion only to preserve the same semantic requirement under the new result-first layout.

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: PASS with no TypeScript errors.

---

### Task 3 (Final): End-to-End Verification

**Dependencies:** Runs after Task 1 and Task 2 complete

**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification for this plan**

Run:

```bash
cd extensions/agentic-harness && npm test -- team.test.ts && npm run build
```

Expected: ALL PASS.

- [ ] **Step 2: Verify plan success criteria manually**

Check the final formatted output by reading the `formatTeamRunSummary()` test and implementation:

- [ ] Output starts with `Team completed:` or `Team finished with failures:`.
- [ ] `## Summary` appears before `## Worker Details`.
- [ ] `## Outputs` appears before `## Worker Details`.
- [ ] `## Verification` appears before `## Worker Details`.
- [ ] `## Risks / Blockers` appears before `## Worker Details`.
- [ ] Worker details still include the full worker report text.
- [ ] `Structured verification evidence:` is still present.

- [ ] **Step 3: Check the final diff**

Run:

```bash
git diff -- extensions/agentic-harness/team.ts extensions/agentic-harness/tests/team.test.ts
```

Expected: diff only contains test additions/updates and formatting helper changes for team result summaries.

- [ ] **Step 4: Check formatting hygiene**

Run:

```bash
git diff --check -- extensions/agentic-harness/team.ts extensions/agentic-harness/tests/team.test.ts
```

Expected: no output and exit code 0.

---

## Self-Review

- **Spec coverage:** The plan covers the clarified requirement: improve the `team` tool's own output, not only the main orchestrator's ad-hoc response. The top of the result becomes work-summary-first with outputs, verification, and blockers.
- **Placeholder scan:** No placeholders are present. Every task contains exact paths, exact commands, expected outcomes, and concrete code snippets.
- **Type consistency:** All new helpers use existing `TeamTask` and `TeamRunSummary` types in `team.ts`. The test uses existing imports: `createDefaultTeamTasks`, `synthesizeTeamRun`, `formatTeamRunSummary`, and `fakeResult`.
- **Dependency verification:** Task 1 modifies only `team.test.ts`; Task 2 modifies only `team.ts` but depends on Task 1 for TDD. Final verification is read-only and depends on both.
- **Verification coverage:** Final verification runs the focused team test file and TypeScript build using the discovered project commands.
