---
name: long-run
description: Orchestrates multi-day execution of complex tasks through milestones. Each milestone goes through plan-crafting, run-plan (worker-validator), and review-work phases with checkpoint/recovery. Triggers when the user says "long run", "start long run", "execute milestones", or "run all milestones".
---

# Long Run Harness

Orchestrates multi-day execution of complex tasks through a milestone pipeline. Each milestone passes through plan-crafting → run-plan → review-work with checkpoints between milestones for recovery from interruptions.

## Core Principle

Long-running execution must be **resumable, auditable, and fail-safe.** Every state transition is persisted to disk before the next action begins. If execution stops for any reason — rate limit, crash, user pause, context loss — it can resume from the last checkpoint without repeating completed work.

## Hard Gates

1. **Milestones must exist before execution.** Either from `milestone-planning` skill or user-provided. Never generate milestones inline during execution.
2. **State file must be updated before and after every milestone.** No in-memory-only state. If it's not on disk, it didn't happen.
3. **Each milestone must complete the full pipeline.** plan-crafting → run-plan → review-work. No shortcuts. No skipping review-work "because it looked fine."
4. **Failed milestones block dependents.** If M2 depends on M1 and M1 fails review, M2 does not start. Period.
5. **User confirmation required at gate points.** Before starting a new milestone phase (planning, execution, review), check if the user wants to continue, pause, or abort.
6. **Never modify completed milestones.** Once a milestone passes review-work, its files are locked. If a later milestone needs changes to earlier work, that is a new milestone.
7. **Checkpoint after every milestone completion.** Write a checkpoint file recording what was done, test results, and review verdict before proceeding.

## When To Use

- After `milestone-planning` has produced a milestone DAG
- When the user says "long run", "start long run", "execute milestones", or "run all milestones"
- When resuming a previously paused long run session

## When NOT To Use

- When milestones don't exist yet (use `milestone-planning` first)
- When there's only one milestone (use plan-crafting + run-plan directly)
- For quick tasks that don't warrant multi-phase execution

## Input

1. **Harness state directory path** — e.g., `docs/engineering-discipline/harness/<session-slug>/`
2. The directory must contain `state.md` and `milestones/*.md` files

If no state directory exists, ask the user if they want to run `milestone-planning` first.

## Process

### Phase 1: Load and Validate State

1. Read `state.md` from the harness directory
2. Read all milestone files from `milestones/`
3. Validate:
   - All milestones referenced in state.md have corresponding files
   - Dependency DAG is valid (no cycles, topological sort possible)
   - No milestone is in an invalid state (e.g., "executing" without a plan file)
4. Determine current position:
   - Which milestones are completed?
   - Which milestones are ready to start (all dependencies met)?
   - Is this a fresh start or a resume?
5. Present status to the user:

```
## Long Run Status: [Session Name]

**Progress:** N/M milestones completed
**Current phase:** [planning M3 | executing M3 | reviewing M3 | ready to start M3]
**Next up:** [M3, M4 (parallel)]

Completed: M1 ✓, M2 ✓
In progress: M3 (executing)
Pending: M4, M5
```

6. Ask user to confirm: continue, pause, or abort.

### Phase 2: Milestone Execution Loop

For each milestone in topological order:

```
┌─────────────────────────────────────┐
│         Milestone Pipeline          │
│                                     │
│  ┌──────────┐    ┌─────────┐        │
│  │  Plan    │───→│  Run    │        │
│  │ Crafting │    │  Plan   │        │
│  └──────────┘    └────┬────┘        │
│                       │             │
│                  ┌────▼────┐        │
│                  │ Review  │        │
│                  │  Work   │        │
│                  └────┬────┘        │
│                       │             │
│              ┌────────▼────────┐    │
│              │   PASS?         │    │
│              │  Yes → checkpoint│    │
│              │  No  → retry    │    │
│              └─────────────────┘    │
└─────────────────────────────────────┘
```

#### Step 2-1: Gate Check

Before starting a milestone:

1. Verify all dependency milestones have status `completed`
2. Verify no file conflicts with in-progress parallel milestones
3. Update state.md: set milestone status to `planning`
4. Update execution log with timestamp

#### Step 2-2: Plan Crafting Phase

1. Compose a Context Brief from the milestone definition:
   - Goal → from milestone file
   - Scope → files affected from milestone file
   - Success Criteria → from milestone file
   - Constraints → inherited from the parent problem + completed milestone context
   - **Completed milestone context contract:** From each completed predecessor, include ONLY:
     - Files created/modified (from checkpoint's "Files Changed" list)
     - Interface contracts established (function signatures, API shapes, type definitions)
     - Success criteria that were verified as met
   - Do NOT include: execution logs, review documents, worker/validator output, or full checkpoint contents
   - **Note:** Context Briefs composed from milestone definitions omit the Complexity Assessment section, since routing has already been determined by the milestone-planning phase. The brief goes directly to plan-crafting without re-routing.
2. Invoke the `plan-crafting` skill pattern:
   - Create a plan document at `docs/engineering-discipline/plans/YYYY-MM-DD-<milestone-name>.md`
   - The plan must satisfy all milestone success criteria
   - The plan must not modify files outside the milestone's scope
3. Update state.md: record plan file path for this milestone
4. **User gate:** Present the plan and ask for approval before execution

#### Step 2-3: Run Plan Phase

1. Update state.md: set milestone status to `executing`, increment `Attempts` counter by 1
2. Execute the plan using the `run-plan` skill pattern:
   - Worker-validator loop for each task
   - Parallel execution for independent tasks
   - Information-isolated validators
3. If run-plan reports failure after 3 retries on any task:
   - Update state.md: set milestone status to `failed`
   - Record failure details in execution log
   - **Stop and report to user.** Do not proceed to dependent milestones.
4. If all tasks complete: proceed to review phase

#### Step 2-4: Review Work Phase

1. Update state.md: set milestone status to `validating`
2. Invoke the `review-work` skill pattern:
   - Information-isolated review against the plan document
   - Binary PASS/FAIL verdict
3. **If PASS:**
   - Update state.md: set milestone status to `completed`
   - Write checkpoint file (see Checkpoint Format below)
   - Update execution log
   - Proceed to next milestone
4. **If FAIL:**
   - Record review findings in execution log
   - **Retry decision (based on `Attempts` counter in state.md, which persists across crashes):**
     - If Attempts == 1: return to Step 2-3 with review feedback (re-execute same plan)
     - If Attempts == 2: return to Step 2-2 (re-plan with review feedback as constraint)
     - If Attempts >= 3: set status to `failed`, stop, report to user

#### Step 2-5: Cross-Milestone Integration Check

After a milestone passes review-work but **before** writing the checkpoint, verify that the milestone's output integrates correctly with all previously completed milestones:

1. **Run the project's highest-level verification** (from state.md's Verification Strategy or rediscover using plan-crafting's Verification Discovery order)
2. **Check cross-milestone interfaces:** If the completed milestone defines or consumes interfaces from predecessor milestones, verify they are compatible (function signatures match, API contracts hold, types align)

**If integration check passes:** Proceed to checkpoint.

**If integration check fails — Cross-Milestone Failure Response:**

The milestone passed its own review-work (internal correctness) but breaks integration with other milestones. This is a boundary problem.

1. **Diagnose (attempt 1):**
   - Read the failure output
   - Identify which interface boundary or interaction is broken
   - Determine if the fix belongs to the current milestone or requires a corrective milestone
   - If fixable within current milestone scope: dispatch a targeted fix worker → re-run review-work → re-run integration check
   - If the fix is outside current milestone scope: proceed to escalation

2. **Diagnose (attempt 2):**
   - If the first fix didn't resolve it, re-analyze
   - Apply a second targeted fix
   - Re-run integration check

3. **Escalate to user (after 2 failed attempts):**
   - Report: which milestones are involved, what integration boundary failed, what fixes were tried
   - Options: add corrective milestone, rollback to checkpoint, accept and continue (user acknowledges the integration gap)
   - Log the user's decision in state.md execution log

#### Step 2-6: Checkpoint

After a milestone passes review:

Write `checkpoints/M<N>-checkpoint.md`:

```markdown
# Checkpoint: M<N> — [Milestone Name]

**Completed:** YYYY-MM-DD HH:MM
**Duration:** [time from planning start to review pass]
**Attempts:** [number of plan-execute-review cycles]

## Plan File
`docs/engineering-discipline/plans/YYYY-MM-DD-<name>.md`

## Review File
`docs/engineering-discipline/reviews/YYYY-MM-DD-<name>-review.md`

## Test Results
[Full test suite status at checkpoint time]

## Files Changed
[List of files created/modified in this milestone]

## State After Milestone
[Brief description of system state — what works now that didn't before]
```

### Phase 3: Parallel Milestone Execution

When multiple milestones have all dependencies satisfied and no file conflicts:

1. Identify parallelizable milestone group
2. Run plan-crafting for ALL parallel milestones first (sequentially — plans are lightweight)
3. Present ALL plans together for batch approval: "Milestones M3 and M4 can run in parallel. Here are both plans. Approve each individually."
4. User approves or rejects each plan independently. Only approved milestones proceed to execution. Rejected milestones return to Step 2-2 while approved ones execute.
5. If all approved, dispatch each milestone's pipeline concurrently:
   - Each milestone runs run-plan → review-work (plan already approved in step 3)
   - Each runs in a separate working directory (`cwd` parameter on the `subagent` tool) to prevent file conflicts
   - After both complete and pass review, merge changes back
4. If either fails: handle independently (the other can continue if no dependency)

**Worktree merge protocol:**
1. Both milestones pass review in their respective worktrees
2. Check for file conflicts between worktree changes
3. If no conflicts: merge sequentially (M_lower first, then M_higher)
4. If conflicts detected: stop, report to user, request manual resolution
5. After merge: run full test suite on merged result
6. If tests fail: stop, report to user

### Phase 4: Completion

After all milestones are completed (including the Integration Verification Milestone from milestone-planning):

1. Update state.md: set overall status to `completing`
2. **Final E2E Gate:** Run the project's highest-level verification one final time on the fully integrated codebase
3. **Run full test suite** for regression check
4. **If Final E2E Gate fails:**
   - Diagnose: identify which milestone's output is the likely cause
   - Create a corrective milestone via Mid-Execution Correction procedure
   - Execute corrective milestone through the full pipeline (plan-crafting → run-plan → review-work)
   - Re-run E2E Gate after correction
   - If 2 corrective attempts fail: escalate to user with full diagnosis
5. **If Final E2E Gate passes:** Update state.md: set overall status to `completed`
6. Generate completion summary:

```markdown
# Long Run Complete: [Session Name]

**Started:** YYYY-MM-DD
**Completed:** YYYY-MM-DD
**Total milestones:** N
**Total attempts:** [sum of all milestone attempts]

## Milestone Summary

| Milestone | Status | Attempts | Duration |
|-----------|--------|----------|----------|
| M1: [name] | ✓ completed | 1 | 2h |
| M2: [name] | ✓ completed | 2 | 4h |
| ...

## Final Test Suite
[PASS/FAIL — N passed, M failed]

## Files Changed (Total)
[Aggregated list across all milestones]
```

4. Present to user and suggest `simplify` for a final code quality pass

## Recovery Protocol

When resuming a paused or interrupted session:

1. Read state.md to determine last known state
2. For each milestone, determine recovery action:

| Last Status | Recovery Action |
|-------------|----------------|
| `pending` | Start normally |
| `planning` | Restart plan-crafting (plan file may be incomplete) |
| `executing` | Check run-plan progress; resume or restart |
| `validating` | Restart review-work (review may be incomplete) |
| `completed` | Skip (already checkpointed) |
| `failed` | Present failure to user; ask whether to retry or skip (see Skip Rules below) |
| `skipped` | Skip (user previously chose to skip this milestone) |

3. For `executing` milestones: check if tasks in the plan have checkboxes marked. Resume from the first unchecked task.
4. Read the `Attempts` counter from state.md to determine retry budget remaining. Do not reset the counter on resume — it persists across crashes to prevent infinite retry loops.
5. Present recovery plan to user before proceeding.

## Mid-Execution Correction

If execution reveals that a completed milestone's output is incorrect or a new milestone is needed:

1. **Pause execution** — do not continue with dependent milestones
2. **Log the discovery** in state.md execution log: what was found, which milestone triggered the discovery
3. **User decision required:** present the situation and options:
   - **Add corrective milestone:** Create a new milestone definition (the user writes the goal and success criteria, or re-run milestone-planning for just the new scope). Insert it into the DAG with appropriate dependencies. Resume execution from the new milestone.
   - **Re-plan from a checkpoint:** Roll back to a completed milestone's checkpoint, mark subsequent milestones as `pending`, reset their `Attempts` to 0, and restart from that point.
   - **Abort:** Set overall status to `failed` and stop.
4. **New milestones follow the same pipeline** — plan-crafting → run-plan → review-work. No shortcuts even for "quick fixes."
5. **Completed milestones are never modified** (Hard Gate #6 still applies). The corrective milestone produces new files or overwrites with a full plan cycle.

## Skip Rules

When a user chooses to skip a failed milestone:

1. Set milestone status to `skipped` in state.md
2. Log the skip event with user's reason in execution log
3. **Dependents of a skipped milestone are also blocked by default** — same as `failed`. The DAG contract is: dependents run only after prerequisites are `completed`.
4. The user may explicitly unblock a dependent by acknowledging the missing prerequisite: "Proceed with M4 despite M2 being skipped." Log this override in the execution log.
5. If the user unblocks a dependent, add a note to that milestone's Context Brief during plan-crafting: "Prerequisite M2 was skipped. The following outputs are missing: [list from M2's success criteria]."

**Skipped milestones cannot be un-skipped.** If the user wants to attempt the milestone later, create a new milestone with the same goal.

## Duration Guard

If a single milestone's total active time (from planning start to review completion) becomes excessive:

1. **Soft limit:** If a milestone has been in `planning` or `executing` status for more than what appears to be a proportionally large share of the overall work, pause and report to user: "Milestone M3 has been in progress for an extended period. Continue, re-scope, or abort?"
2. **Hard limit on attempts:** The 3-attempt limit (F1) bounds retry loops. But if even a single attempt's plan-crafting generates more than 15 tasks, pause and report: "This milestone's plan has N tasks — it may be too large for a single milestone. Consider splitting."
3. **Purpose:** Prevent a single runaway milestone from consuming the entire execution budget or running indefinitely on flaky tests.

## Context Window Management

Long-running sessions will hit context window limits. Pi automatically compresses old messages (context compaction). The harness must be designed to survive this:

1. **Never rely on conversation memory for state.** All state lives in `state.md` and milestone files on disk. If the context is compressed, the harness re-reads state files — no information is lost.
2. **Each milestone is a fresh context boundary.** When starting a new milestone's plan-crafting, the worker subagent starts with a clean context. It receives only the milestone definition and completed predecessor context (see F8 contract) — not the full conversation history.
3. **Checkpoint files are the source of truth.** If context is lost mid-milestone, recovery reads the checkpoint files, not compressed conversation summaries.
4. **Avoid accumulating large inline state.** Do not build up a running summary of all milestones in the conversation. Instead, reference state.md and checkpoint files by path.

## Rate Limit Handling

Long-running sessions will encounter rate limits. Pi has built-in retry with exponential backoff. The harness should work with this, not against it:

1. **Let pi handle transient rate limits.** Short 429/529 errors are retried automatically with backoff. Do not preemptively save state on every API error.
2. **Save state on persistent rate limits.** If a rate limit persists beyond the automatic retry window (you'll see repeated "rate limit" messages), record current state to disk immediately.
3. Log the rate limit event in execution log with timestamp.
4. Report to user: "Rate limit hit. State saved. Resume with `long-run` when ready."
5. Do NOT add manual retry loops on top of pi's built-in retry — this causes retry amplification.
6. **Subagent bail:** Subagent processes may bail on 529 overload errors instead of retrying. This is why Phase 2.5 reviewer failure handling exists — reviewer failures are often transient rate limits, not permanent errors.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Generating milestones inline instead of using milestone-planning | Milestones lack adversarial review; poor decomposition |
| Skipping review-work for "simple" milestones | Undetected defects compound across milestones |
| Continuing after a milestone fails | Dependent milestones build on broken foundation |
| Not updating state.md between phases | Crash loses progress; cannot resume |
| Modifying completed milestone files | Breaks checkpoint invariant; invalidates reviews |
| Running parallel milestones without directory isolation | File conflicts corrupt both milestones |
| Auto-retrying on rate limit | Wastes quota; user may prefer to wait |
| Skipping user gates between milestones | User loses control of multi-day execution |
| Merging worktrees without conflict check | Silent data loss if files overlap |
| Skipping cross-milestone integration check | Milestones pass independently but break each other at boundaries |
| Retrying E2E failures indefinitely without user escalation | 2-attempt limit exists to avoid budget waste on misdiagnosed problems |

## Minimal Checklist

- [ ] State directory exists with valid state.md and milestone files
- [ ] Dependency DAG validated (no cycles)
- [ ] Current position determined (fresh start or resume)
- [ ] User confirmed continuation at session start
- [ ] Each milestone goes through plan-crafting → run-plan → review-work
- [ ] State.md updated before and after every phase transition
- [ ] Checkpoint written after every successful milestone
- [ ] Failed milestones block dependents
- [ ] Parallel milestones use directory isolation
- [ ] Cross-milestone integration check passes after each milestone
- [ ] Final E2E Gate passes at completion
- [ ] Full test suite passes at completion

## Transition

After long run completion:

- For final code quality pass → `simplify` skill
- If issues found in completion testing → `systematic-debugging` skill
- If user wants to extend with more milestones → `milestone-planning` skill

This skill itself **does not invoke the next skill.** It reports completion and lets the user decide the next step.
