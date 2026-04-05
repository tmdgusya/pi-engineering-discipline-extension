---
name: milestone-planning
description: Decomposes complex, multi-day tasks into optimized milestones using parallel reviewer agents (ultraplan). Spawns 5 independent reviewers that analyze the problem from different angles, then synthesizes their findings into a milestone dependency DAG. Triggers when the user says "plan milestones", "break this into milestones", "ultraplan", or when long-run harness needs milestone generation.
---

# Milestone Planning (Ultraplan)

Decomposes a complex task into milestones by spawning 5 parallel reviewer agents, synthesizing their independent analyses, and producing a milestone dependency DAG.

## Core Principle

Milestones are the unit of long-running execution. A bad milestone decomposition cascades into days of wasted work. Therefore milestone generation must be adversarial — multiple independent perspectives must challenge each other before milestones are locked.

## Hard Gates

1. **All 5 reviewer agents must run in parallel.** Sequential execution is prohibited. Dispatch all 5 concurrently using the `subagent` tool's parallel mode (`tasks` array).
2. **Each reviewer receives the full problem statement.** Do not split or filter the problem per reviewer. Every reviewer sees everything.
3. **Reviewers must not see each other's findings.** Each reviewer operates independently. No cross-pollination during the review phase.
4. **Synthesis must address every reviewer's concern.** The synthesis agent must explicitly respond to each finding — accepted, rejected with reason, or deferred to a specific milestone.
5. **Every milestone must have measurable success criteria.** "Working correctly" is not a criterion. Specific test commands, file existence checks, or behavioral assertions are required.
6. **Milestone dependencies must form a DAG.** Circular dependencies are a plan failure. Every milestone must have a clear topological ordering.
7. **Do not generate milestones for trivial tasks.** If the problem can be solved in a single plan-crafting cycle (fewer than ~8 tasks), tell the user to use plan-crafting directly.
8. **Reviewer outputs must be passed verbatim to the synthesis agent.** Do not summarize, filter, or reframe. Copy each reviewer's full output into the designated placeholder. The main agent must not editorialize the handoff.

## When To Use

- When the user presents a complex, multi-day task
- When the long-run harness needs milestone decomposition
- When the user says "plan milestones", "break this into milestones", or "ultraplan"
- When a task clearly requires multiple independent implementation phases

## When NOT To Use

- Single-day tasks (use plan-crafting directly)
- Tasks with fewer than ~8 implementation steps
- When milestones are already defined and the user wants execution (use long-run)
- When work scope is still ambiguous (use clarification first)

## Input

The skill requires a **clear problem statement** as input. This can come from:

1. A Context Brief file produced by the `clarification` skill (preferred)
2. A direct, detailed request from the user (must include goal, scope, constraints)

If the input is ambiguous, return to the `clarification` skill before proceeding.

## Process

### Phase 1: Problem Framing

Before dispatching reviewers, frame the problem:

1. Read the input (Context Brief or user request)
2. Identify: goal, scope boundaries, technical constraints, success criteria
3. If a codebase is involved, dispatch an Explore agent to map relevant architecture
4. Compose the **Problem Brief** — a self-contained document that each reviewer will receive:

```markdown
## Problem Brief

**Goal:** [What must be achieved]

**Scope:**
- In: [What is included]
- Out: [What is explicitly excluded]

**Technical Context:**
[Relevant architecture, existing code, constraints]

**Constraints:**
[Time, compatibility, dependencies, performance requirements]

**Success Criteria:**
[Specific, measurable outcomes]

**Verification Strategy:**
- **Level:** [e2e | integration | skill/agent | test-suite | build-only]
- **Command:** [exact command to run the verification]
- **What it validates:** [what passing this verification proves]
```

### Phase 2: Parallel Reviewer Dispatch

Dispatch all 5 reviewer agents concurrently using the `subagent` tool's parallel mode (`tasks` array). Each receives the full Problem Brief and its reviewer-specific prompt.

**Dispatch example:**

Use the `subagent` tool with the `tasks` parameter to run all 5 reviewers in parallel:

```
tasks: [
  { agent: "reviewer-feasibility", task: "[Problem Brief + feasibility prompt]" },
  { agent: "reviewer-architecture", task: "[Problem Brief + architecture prompt]" },
  { agent: "reviewer-risk", task: "[Problem Brief + risk prompt]" },
  { agent: "reviewer-dependency", task: "[Problem Brief + dependency prompt]" },
  { agent: "reviewer-user-value", task: "[Problem Brief + user-value prompt]" }
]
```

Reviewers are read-only analysts — they do not modify code. If a reviewer appears stuck (no response after extended time), this is likely a rate limit or timeout — see Phase 2.5 for failure handling.

#### Reviewer 1: Feasibility Analyst

```
You are a feasibility analyst reviewing a problem decomposition.

## Problem Brief
{PROBLEM_BRIEF}

## Your Task

Analyze the feasibility of solving this problem. For each major component:

1. **Technical feasibility:** Can this be built with the stated tech stack?
   Identify any components that require research, prototyping, or may not
   be possible as described.

2. **Effort estimation:** Classify each component as:
   - Small (1-3 tasks, < 1 plan cycle)
   - Medium (4-8 tasks, 1 plan cycle)
   - Large (9+ tasks, multiple plan cycles → candidate for milestone)
   - Uncertain (requires spike/prototype before estimation)

3. **Risk of underestimation:** Flag components that appear simple but
   have hidden complexity (integration points, edge cases, data migration,
   backward compatibility).

4. **Suggested milestone boundaries:** Based on effort and risk, suggest
   where natural milestone boundaries should fall. A milestone should be
   independently deliverable and testable.

## Output Format

For each suggested milestone:
- **Name:** [milestone name]
- **Effort:** [Small/Medium/Large/Uncertain]
- **Feasibility risk:** [Low/Medium/High] — [reason]
- **Key deliverable:** [what this milestone produces]

Also list:
- **Spike candidates:** Components needing prototype before planning
- **Underestimation risks:** Components likely harder than they appear
```

#### Reviewer 2: Architecture Analyst

```
You are an architecture analyst reviewing a problem decomposition.

## Problem Brief
{PROBLEM_BRIEF}

## Your Task

Analyze the architectural implications and suggest milestone boundaries
that respect architectural constraints.

1. **Interface boundaries:** Identify the key interfaces, contracts, and
   APIs that must be defined. Milestones should align with interface
   boundaries — one milestone should not half-define an interface.

2. **Data flow:** Map how data flows through the system. Milestones that
   cut across data flows create integration risk.

3. **Dependency direction:** Identify which components depend on which.
   Milestones should be ordered so dependencies are built before dependents.

4. **Incremental deliverability:** Each milestone should leave the system
   in a working state. No milestone should produce a half-built component
   that only works after the next milestone.

5. **Existing pattern alignment:** Where possible, milestones should follow
   existing patterns in the codebase rather than introducing new patterns.

## Output Format

For each suggested milestone:
- **Name:** [milestone name]
- **Architectural rationale:** [why this is a natural boundary]
- **Interfaces defined:** [what contracts this milestone establishes]
- **Depends on:** [which milestones must complete first]
- **Leaves system in working state:** [Yes/No — explain]

Also list:
- **Interface risks:** Interfaces that may need revision after initial implementation
- **Pattern conflicts:** Where the proposed work conflicts with existing patterns
```

#### Reviewer 3: Risk Analyst

```
You are a risk analyst reviewing a problem decomposition.

## Problem Brief
{PROBLEM_BRIEF}

## Your Task

Identify risks that could derail multi-day execution and suggest milestone
ordering that minimizes cumulative risk.

1. **Integration risk:** Which components have the highest risk of not
   working together? These should be integrated early, not in the last
   milestone.

2. **Ambiguity risk:** Which requirements are most likely to change or
   be misunderstood? These should be tackled early so course corrections
   are cheap.

3. **Dependency risk:** Which external dependencies (APIs, libraries,
   services) are least reliable? Milestones depending on them should
   include fallback plans.

4. **Regression risk:** Which changes are most likely to break existing
   functionality? These milestones need heavier test coverage.

5. **Recovery cost:** If a milestone fails validation, how expensive is
   it to redo? High-cost milestones should be smaller and more frequent.

## Output Format

For each identified risk:
- **Risk:** [description]
- **Severity:** [Low/Medium/High/Critical]
- **Affected milestone(s):** [which milestones]
- **Mitigation:** [how to structure milestones to reduce this risk]

Overall risk-ordered milestone sequence:
1. [milestone] — [why first: highest ambiguity / integration risk / ...]
2. [milestone] — [why second]
...
```

#### Reviewer 4: Dependency Analyst

```
You are a dependency analyst reviewing a problem decomposition.

## Problem Brief
{PROBLEM_BRIEF}

## Your Task

Map all dependencies — between milestones, between files, between external
systems — and verify that the proposed decomposition respects them.

1. **File conflict analysis:** List all files that will be created or
   modified. Identify files touched by multiple milestones — these create
   ordering constraints.

2. **Interface dependency graph:** Map which milestones produce interfaces
   that other milestones consume. Draw the dependency DAG.

3. **External dependency mapping:** List external systems, APIs, libraries,
   or services each milestone depends on. Flag any that require setup,
   credentials, or may be unavailable.

4. **Shared state identification:** Identify shared state (databases,
   config files, global settings) that multiple milestones modify.
   These require strict ordering.

5. **Parallelization opportunities:** Identify milestones with zero
   dependencies between them — these can run concurrently.

## Output Format

**Dependency DAG:**
```
M1 (no deps) ─┬─→ M3 (depends on M1, M2)
M2 (no deps) ─┘         │
                         └─→ M4 (depends on M3)
```

**File conflict matrix:**
| File | Milestones | Ordering constraint |
|------|-----------|-------------------|
| path/to/file | M1, M3 | M1 before M3 |

**Parallelizable groups:**
- Group A: [M1, M2] — no shared files, no interface deps
- Group B: [M4, M5] — after Group A completes

**External dependencies:**
- [dependency]: required by [milestones], setup needed: [yes/no]
```

#### Reviewer 5: User Value Analyst

```
You are a user value analyst reviewing a problem decomposition.

## Problem Brief
{PROBLEM_BRIEF}

## Your Task

Ensure milestone ordering maximizes early value delivery and maintains
user motivation throughout multi-day execution.

1. **Value ordering:** Which milestones deliver the most visible,
   user-facing value? These should come early to provide feedback
   and maintain confidence.

2. **Demo-ability:** After each milestone, can the user see/test
   something meaningful? Milestones that produce only internal
   infrastructure with no visible output erode confidence.

3. **Feedback loops:** Which milestones benefit most from early user
   feedback? These should be prioritized so corrections are cheap.

4. **Minimum viable milestone:** What is the smallest first milestone
   that proves the approach works? This validates the overall direction
   before investing in the full plan.

5. **Abort points:** After which milestones could the user reasonably
   decide to stop and still have something useful? Mark these as
   natural checkpoints.

## Output Format

**Value-ordered milestone sequence:**
1. [milestone] — **Value:** [what user sees] — **Demo:** [how to verify]
2. [milestone] — **Value:** [what user sees] — **Demo:** [how to verify]
...

**Minimum viable milestone:** [which milestone and why]

**Natural abort points:** [milestones after which stopping is reasonable]

**Low-value milestones:** [milestones that could be cut if time is short]
```

### Phase 2.5: Reviewer Failure Handling

After dispatching all 5 reviewers, wait for all to complete. If any reviewer fails:

1. **Timeout or error:** Re-dispatch the failed reviewer once with the same prompt. If it fails again, proceed without it.
2. **Empty or unusable output:** If a reviewer returns fewer than 3 sentences or clearly did not address the Problem Brief, re-dispatch once. If still unusable, proceed without it.
3. **Proceeding with fewer than 5 reviewers:** Log the missing perspective(s) in the synthesis handoff. The synthesis agent must note the gap in its Conflict Resolution Log: "Missing perspective: [reviewer name] — [reason]. Milestone plan may have blind spot in [area]."
4. **Minimum viable count:** At least 3 of 5 reviewers must succeed. If fewer than 3 complete successfully, stop and report to user — the problem may be too ambiguous for automated review.

### Phase 3: Synthesis

After all 5 reviewers complete, dispatch a **Synthesis Agent** that receives all 5 reviewer outputs and produces the final milestone plan.

**Verbatim handoff rule (Hard Gate equivalent):** The main agent must copy each reviewer's full output into the designated `{..._OUTPUT}` placeholder without summarizing, filtering, reframing, or adding commentary. This is the same principle as the run-plan validator's fixed template — the main agent has read all 5 outputs and may unconsciously bias the synthesis by selective framing. Verbatim copy eliminates this channel.

**What must NOT happen during handoff:**
- Summarizing a reviewer's output ("The feasibility analyst mainly said...")
- Filtering out findings the main agent considers irrelevant
- Adding framing language ("Pay special attention to the risk analyst's concerns about...")
- Reordering findings by perceived importance

The synthesis agent prompt:

```
You are a milestone synthesis agent. You have received analyses from 5
independent reviewers who each examined the same problem from a different
angle. Your job is to produce the final milestone decomposition.

## Reviewer Outputs

### Feasibility Analysis
{FEASIBILITY_OUTPUT}

### Architecture Analysis
{ARCHITECTURE_OUTPUT}

### Risk Analysis
{RISK_OUTPUT}

### Dependency Analysis
{DEPENDENCY_OUTPUT}

### User Value Analysis
{USER_VALUE_OUTPUT}

## Your Task

1. **Cross-reference findings.** Identify where reviewers agree and
   where they conflict. Agreements are high-confidence decisions.
   Conflicts require resolution.

2. **Resolve conflicts explicitly.** For each conflict:
   - State the conflict
   - State your resolution
   - State why (which reviewer's reasoning is stronger in this case)

3. **Produce the milestone DAG.** Each milestone must have:
   - Name
   - Goal (1 sentence)
   - Success criteria (measurable, specific)
   - Dependencies (which milestones must complete first)
   - Files affected (from dependency analysis)
   - Risk level (from risk analysis)
   - Estimated effort (from feasibility analysis)
   - User value (from value analysis)

4. **Validate the DAG.** Verify:
   - No circular dependencies
   - Valid topological ordering exists
   - No file conflicts between parallel milestones
   - Each milestone leaves system in working state
   - First milestone is the minimum viable milestone

5. **Produce execution order.** List milestones in execution order,
   marking which can run in parallel.

## Output Format

## Conflict Resolution Log

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| [description] | [decision] | [why] |

## Milestone DAG

### M1: [Name]
- **Goal:** [one sentence]
- **Success Criteria:**
  - [ ] [specific, measurable criterion]
  - [ ] [specific, measurable criterion]
- **Dependencies:** None
- **Files:** [list]
- **Risk:** [Low/Medium/High]
- **Effort:** [Small/Medium/Large]
- **User Value:** [what user sees after completion]
- **Abort Point:** [Yes/No]

### M2: [Name]
...

## Execution Order

```
Phase 1 (parallel): M1, M2
Phase 2 (after Phase 1): M3
Phase 3 (parallel): M4, M5
```

## Rejected Proposals

| Proposal | Source | Reason for rejection |
|----------|--------|---------------------|
| [what was proposed] | [which reviewer] | [why rejected] |
```

### Phase 3.5: Integration Verification Milestone

After synthesis, the main agent **automatically appends** an Integration Verification Milestone as the final milestone in the DAG. This milestone is not generated by reviewers or synthesis — it is a structural guarantee.

```markdown
### M_final: Integration Verification

- **Goal:** Validate that all milestones work together as a complete system
- **Success Criteria:**
  - [ ] Highest-level project verification passes (e2e, integration, or discovered verification)
  - [ ] All milestone success criteria remain valid after full integration
  - [ ] No regressions in pre-existing functionality
  - [ ] Cross-milestone interfaces are exercised end-to-end
- **Dependencies:** ALL other milestones
- **Files:** None (read-only verification — no new code)
- **Risk:** Medium (integration issues between independently-verified milestones)
- **Effort:** Small (verification only, no implementation)
- **User Value:** Confidence that the system works as a whole, not just per-milestone
- **Abort Point:** No (this is the final gate)
```

**Verification Discovery:** During Phase 1 (Problem Framing), run the same verification discovery as plan-crafting:
1. Search for e2e tests → integration tests → verification skills/agents → test suite → build+lint
2. Record the result in the Problem Brief under a `Verification Strategy` section
3. The Integration Verification Milestone uses this discovered verification as its primary check

**If no verification infrastructure exists:** The Integration Verification Milestone's plan-crafting phase (during long-run execution) will create the necessary verification as Task 0, same as plan-crafting's behavior.

### Phase 3.6: Independent DAG Validation

After appending the Integration Verification Milestone, the **main agent** independently validates the full DAG structure (including M_final) before presenting to the user. Do not rely on the synthesis agent's self-reported validation.

1. **Circular dependency check:** For each milestone, trace its dependency chain. If any milestone appears as both an ancestor and a descendant of another, the DAG is invalid. Reject and re-dispatch synthesis with the specific cycle identified.
2. **File conflict check for parallel milestones:** For milestones with no dependency relationship, verify their "Files Affected" lists do not overlap. If they overlap, they cannot run in parallel — add a dependency or flag for user decision.
3. **Orphan check:** Every milestone except the first must have at least one dependency, OR be explicitly marked as independently parallelizable with rationale.
4. **Success criteria check:** Every milestone must have at least 2 measurable success criteria. "Working correctly" or similar vague criteria trigger re-dispatch.

If validation fails: re-dispatch synthesis with the specific error(s) as additional constraint. Do not present an invalid DAG to the user.

### Phase 4: User Review and Lock

**Milestone count guard:** The recommended milestone count is 3-7 for most projects. If the synthesis produces more than 7, present a warning: "This plan has N milestones. Consider whether the problem should be split into separate projects." If more than 10, require explicit user approval to proceed.

1. Present the synthesized milestone plan to the user
2. Show the conflict resolution log — the user must see where reviewers disagreed
3. Show the execution order with parallelization
4. Show the total milestone count with the count guard warning if applicable
5. Ask the user to approve, modify, or reject the milestone plan
5. If approved: save the milestone plan to the harness state directory
6. If modifications requested: apply changes and re-present
7. If rejected: return to Phase 1 with updated constraints

### Phase 5: Save Milestone Artifacts

Save all artifacts to the harness state directory:

```
docs/engineering-discipline/harness/<session-slug>/
├── state.md                  # Master state file
├── milestones/
│   ├── M1-<name>.md          # Individual milestone definition
│   ├── M2-<name>.md
│   └── ...
└── reviews/
    ├── feasibility.md
    ├── architecture.md
    ├── risk.md
    ├── dependency.md
    ├── user-value.md
    └── synthesis.md
```

**state.md format:**

```markdown
# Long Run State: [Session Name]

**Created:** YYYY-MM-DD HH:MM
**Last Updated:** YYYY-MM-DD HH:MM
**Status:** milestone-planning-complete | executing | paused | completing | completed | failed

**Verification Strategy:**
- **Level:** [e2e | integration | skill/agent | test-suite | build-only]
- **Command:** [exact verification command]
- **What it validates:** [what passing proves]

## Milestones

| ID | Name | Status | Attempts | Dependencies | Plan File | Review File |
|----|------|--------|----------|-------------|-----------|-------------|
| M1 | [name] | pending | 0 | — | — | — |
| M2 | [name] | pending | 0 | M1 | — | — |
| M3 | [name] | pending | 0 | M1, M2 | — | — |

Status values: pending | planning | executing | validating | completed | failed | skipped
Attempts: number of plan-execute-review cycles attempted (incremented at each Step 2-3 start)

## Execution Log

| Timestamp | Event | Details |
|-----------|-------|---------|
| YYYY-MM-DD HH:MM | milestones-locked | N milestones approved by user |
```

**Individual milestone file (M1-<name>.md) format:**

```markdown
# Milestone: [Name]

**ID:** M1
**Status:** pending
**Dependencies:** [None | M1, M2, ...]
**Risk:** [Low/Medium/High]
**Effort:** [Small/Medium/Large]

## Goal

[One sentence goal]

## Success Criteria

- [ ] [Specific, measurable criterion]
- [ ] [Specific, measurable criterion]
- [ ] [Specific, measurable criterion]

## Files Affected

- Create: [files to create]
- Modify: [files to modify]

## User Value

[What the user sees/can test after this milestone]

## Abort Point

[Yes/No — can user stop here and have something useful?]

## Notes

[Any special considerations from reviewer analysis]
```

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Running reviewers sequentially | Wastes time; reviewers are independent |
| Skipping synthesis and just merging reviewer outputs | Conflicts go unresolved; milestone boundaries are incoherent |
| Accepting milestones without measurable success criteria | Cannot validate completion; "done" becomes subjective |
| Creating milestones too large (>12 tasks each) | Exceeds single plan-crafting cycle; risk of context loss |
| Creating milestones too small (1-2 tasks each) | Overhead of plan-crafting + run-plan + review-work exceeds the work itself |
| Creating more than 10 milestones without user approval | Compounding risk across milestones; likely needs project split |
| Ignoring reviewer conflicts | Unresolved conflicts surface during execution when they're expensive to fix |
| Not saving reviewer outputs | Loses the reasoning behind milestone decisions; cannot audit later |
| Letting user skip approval | User discovers misalignment mid-execution after days of work |

## Minimal Checklist

- [ ] Problem Brief composed with goal, scope, constraints, success criteria
- [ ] All 5 reviewers dispatched in parallel (single message)
- [ ] Each reviewer received the full Problem Brief
- [ ] Synthesis agent received all 5 reviewer outputs
- [ ] All reviewer conflicts explicitly resolved
- [ ] Every milestone has measurable success criteria
- [ ] Milestone DAG has no circular dependencies
- [ ] First milestone is the minimum viable milestone
- [ ] Integration Verification Milestone appended as final milestone
- [ ] User approved the milestone plan
- [ ] All artifacts saved to harness state directory

## Transition

After milestone planning is complete:

- To begin execution → `long-run` skill
- If ambiguity discovered → return to `clarification` skill
- If task is too small for milestones → use `plan-crafting` directly

This skill itself **does not invoke the next skill.** It ends by presenting the milestone plan and letting the user choose the next step.
