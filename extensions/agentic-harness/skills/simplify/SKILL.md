---
name: simplify
description: Review changed code for reuse opportunities, quality issues, and inefficiencies using three parallel review agents, then fix any issues found. Triggers when the user says "simplify", "clean up the code", "review the changes", or after run-plan execution when code quality verification is needed.
---

# Simplify

Reviews all changed files through three parallel agents — reuse, quality, and efficiency — then fixes any issues found.

## Core Principle

Changed code is the only review target. Each review dimension runs independently, sees the full diff, and reports findings without knowledge of the other agents' results. The main agent aggregates and applies fixes.

## Hard Gates

1. **Identify changes before reviewing.** Always run `git diff` (or `git diff HEAD` if there are staged changes) first. Never review without knowing what changed.
2. **All three agents must run in parallel.** Sequential execution of the three review agents is prohibited. Dispatch all three concurrently in a single message.
3. **Each agent receives the full diff.** Do not split or filter the diff per agent. Every agent sees every change.
4. **Fix issues directly.** This skill produces code changes, not just a report. If a finding is actionable, fix it.
5. **Skip false positives silently.** If a finding is not worth addressing, move on. Do not argue with the finding or explain why it was skipped.
6. **Do not expand scope beyond the diff.** Review only the changed code. Do not refactor untouched code, even if it has the same issues.

## When To Use

- After any implementation work when code quality verification is needed
- When the user says "simplify", "clean up", "review the changes", or "check the code"
- After run-plan execution, before review-work, as an intermediate quality pass
- When the user suspects duplicated logic, inefficiencies, or hacky patterns in recent changes

## When NOT To Use

- When there are no changes (no diff output)
- When the user wants a full codebase audit (this skill reviews only the diff)
- When the user wants only formatting or linting fixes
- When the goal is plan verification (use `review-work` instead)

## Process

### Phase 1: Identify Changes

1. Run `git diff` to see unstaged changes
2. If no output, run `git diff HEAD` to check staged changes
3. If still no output, check for recently modified files that the user mentioned or that were edited earlier in this conversation
4. If no changes can be identified, notify the user and stop

Capture the full diff output — this is the input for all three agents.

### Phase 2: Launch Three Review Agents in Parallel

Dispatch all three agents concurrently using the `subagent` tool's parallel mode (`tasks` array). Each agent receives the full diff and its review prompt below.

**Dispatch example:**

```
tasks: [
  { agent: "worker", task: "[full diff + Code Reuse Review prompt]" },
  { agent: "worker", task: "[full diff + Code Quality Review prompt]" },
  { agent: "worker", task: "[full diff + Efficiency Review prompt]" }
]
```

**What to provide to each agent:**
- The full diff output from Phase 1
- The agent's review prompt (copied verbatim from the corresponding section below)

**What NOT to provide:**
- Other agents' findings (agents run independently)
- Instructions to fix issues (agents only report findings)

#### Agent 1: Code Reuse Review

Provide this prompt to the agent:

> You are reviewing a code diff for reuse opportunities. Your job is to find new code that duplicates functionality already in the codebase.
>
> For each change in the diff:
>
> 1. **Search for existing utilities and helpers** that could replace newly written code. Search utility directories (`utils/`, `helpers/`, `lib/`, `common/`, `shared/`), files adjacent to the changed ones, and files imported by the changed files.
> 2. **Flag any new function that duplicates existing functionality.** Report the new function, the existing function, and where the existing one lives.
> 3. **Flag inline logic that could use an existing utility.** Common candidates: hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, manual array/object transformations, date/time formatting done inline.
> 4. **Flag reimplemented standard library features.** Check if the change reimplements something available in the language's standard library or in already-installed dependencies.
>
> For each finding, report:
> - **Reuse opportunity:** [brief description]
> - New code: [file:line] — [what was written]
> - Existing: [file:line] — [what already exists]
> - Suggestion: [how to replace]
>
> If no reuse issues are found, report: "No reuse issues found."

#### Agent 2: Code Quality Review

Provide this prompt to the agent:

> You are reviewing a code diff for quality issues. Your job is to find hacky patterns, unnecessary complexity, and abstraction boundary violations.
>
> Check for these patterns:
>
> 1. **Redundant state:** new variables that are always derived from another variable, caches that store what could be computed on access, event listeners or observers that could be direct function calls.
> 2. **Parameter sprawl:** functions that gained a new boolean flag parameter, functions with more than 4 parameters after the change, multiple parameters that are always passed together and should be a single object.
> 3. **Copy-paste with slight variation:** two or more blocks that differ by only 1-2 lines, repeated conditional structures with different field names, similar error handling blocks across multiple locations.
> 4. **Leaky abstractions:** accessing private fields or internal state from outside the module, passing implementation details across module boundaries, changes that make one module depend on another's internal structure.
> 5. **Stringly-typed code:** new string comparisons against values already defined as constants, new string literals matching existing enum or union type values, magic strings appearing in multiple places without a shared constant.
> 6. **Unnecessary comments:** comments explaining WHAT the code does, narrating the change, or referencing a task. Delete these. Keep only comments that explain non-obvious WHY — hidden constraints, subtle invariants, workarounds. Example to delete: `// increment counter` above `counter++`. Example to keep: `// Redis returns nil for both "key missing" and "value is empty" — we must distinguish`.
>
> For each finding, report:
> - **Quality issue:** [category]
> - Location: [file:line]
> - Problem: [what is wrong]
> - Suggestion: [how to fix]
>
> If no quality issues are found, report: "No quality issues found."

#### Agent 3: Efficiency Review

Provide this prompt to the agent:

> You are reviewing a code diff for efficiency issues. Your job is to find unnecessary work, missed concurrency, and resource management problems. Do not optimize prematurely — flag only what is clearly unnecessary or clearly mismanaged.
>
> Check for these patterns:
>
> 1. **Unnecessary work:** the same value computed multiple times in a loop, the same file read more than once, the same API call made repeatedly when the result could be cached or batched, database queries inside loops that could be a single query with WHERE IN.
> 2. **Missed concurrency:** multiple `await` calls in sequence where the operations are independent, sequential file reads that could be parallelized, independent API calls executed one after another.
> 3. **Hot-path bloat:** synchronous file I/O added to a request handler, new computation in a render function that could be memoized, new initialization logic added to module load time.
> 4. **Recurring no-op updates:** state setters called on every interval tick without checking if the value changed, store dispatches firing on every event without a change-detection guard, wrapper functions that take updater callbacks but do not honor "no change" returns — add a change-detection guard so downstream consumers are not notified when nothing changed.
> 5. **Unnecessary existence checks (TOCTOU):** `if (existsSync(path)) { readFileSync(path) }` — operate directly and handle the error instead.
> 6. **Memory issues:** collections that grow without bound, event listeners registered without corresponding removal, subscriptions without cleanup in dispose/destroy handlers, large objects held in closure scope longer than needed.
> 7. **Overly broad operations:** reading entire files to extract a single value, fetching all records to find one by ID, loading an entire config when only one field is needed.
>
> For each finding, report:
> - **Efficiency issue:** [category]
> - Location: [file:line]
> - Problem: [what is wasteful]
> - Suggestion: [how to fix]
>
> If no efficiency issues are found, report: "No efficiency issues found."

### Phase 3: Fix Issues

1. Wait for all three agents to complete
2. Aggregate findings from all three agents
3. Deduplicate overlapping findings (different agents may flag the same code)
4. For each actionable finding:
   - Apply the minimal fix that addresses the finding
   - Do not bundle unrelated improvements into the same change
   - Do not expand the fix beyond what was flagged
5. For each false positive: skip silently
6. Run the test suite to verify no regressions were introduced
7. If tests fail after a fix: revert that fix, report it as a finding that needs manual attention
8. Briefly summarize what was fixed (or confirm the code was already clean)

## When To Stop

- No changes detected in Phase 1 — notify user and stop
- All three agents report no findings — confirm code is clean
- Fixes introduce test failures that cannot be resolved without expanding scope — stop, report the regression, suggest `systematic-debugging`

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Reviewing without running git diff first | Reviews code that may not have changed, wastes time on irrelevant findings |
| Running agents sequentially | Unnecessary delay; violates Hard Gate #2 |
| Giving each agent only part of the diff | Agent misses cross-cutting issues that span multiple files |
| Reporting findings without fixing them | Defeats the purpose of the skill; user must do manual work |
| Arguing with or explaining skipped findings | Wastes context and time; skip and move on |
| Reviewing unchanged code "while we're here" | Scope creep; violates Hard Gate #6 |
| Fixing issues without running tests afterward | May introduce regressions silently |
| Bundling "while I'm here" improvements into fixes | Mixes review fixes with unrelated changes; muddles the diff |

## Minimal Checklist

- [ ] Ran git diff to identify changes
- [ ] Dispatched all three agents in parallel (single message)
- [ ] Each agent received the full diff
- [ ] Aggregated findings from all three agents
- [ ] Applied fixes for actionable findings
- [ ] Skipped false positives without argument
- [ ] Ran tests after fixes — no regressions
- [ ] Summarized results to the user

## Transition

After simplification is complete:

- If this was a post-implementation quality pass → suggest transitioning to `review-work` for independent plan verification
- If issues were found and fixed → user may want to run `simplify` again to verify the fixes are clean
- If a bug was discovered during review → suggest `systematic-debugging`

This skill itself **does not invoke the next skill.** It reports results and lets the user decide the next step.
