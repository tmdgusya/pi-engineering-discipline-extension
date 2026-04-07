---
name: agentic-systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior. Enforces a strict reproduce-first, root-cause-first, failing-test-first debugging workflow before fixing.
---

# Systematic Debugging

A strict debugging workflow. Use when dealing with bugs, test failures, or unexpected behavior.

Three core purposes:

1. Fix the cause, not the symptom.
2. Prevent guess-based fixes.
3. Lock the failure with a test before fixing.

## Hard Gates

These rules have no exceptions.

0. **Attempt reproduction FIRST, before any analysis.**
   - If you do not know how to reproduce the bug, **stop and ask the user**.
   - Use available tools (e.g., `ask_user_question`) to ask: "How can I reproduce this bug? What steps, inputs, or conditions trigger it?"
   - Do not proceed to analysis until you have either reproduced the failure or asked the user for reproduction guidance.

1. **Do not fix until you have a reproducible or observable state.**
2. **Do not fix until you have stated a root-cause hypothesis.**
3. **Do not fix until you have a failing test or equivalent reproduction mechanism.**
4. **Verify only one hypothesis at a time.**
5. **No "while I'm here" refactoring during a fix.**
6. **If three fix attempts fail, suspect a structural issue before applying another patch.**

Violating this process is considered a debugging failure.

## When To Use

Use this skill in the following situations:

- When a test fails
- When a bug occurs in production or locally
- When a response, state, rendering, or query result differs from expectations
- When investigating performance degradation, timeouts, race conditions, or intermittent failures
- When something breaks again after being fixed at least once

The following excuses are not accepted:

- "It looks simple, I'll just fix it directly"
- "No time, let's patch it and move on"
- "It's probably this, let me just change it"

## Required Output Contract

When using this skill, the following items must be locked internally:

1. **Problem statement**: Define what went wrong in one sentence
2. **Reproduction path**: How to reproduce or observe the failure
3. **Evidence**: Actual observed results
4. **Root-cause hypothesis**: Why you believe this problem occurs
5. **Failing guard**: One of: failing test, reproduction script, or log verification
6. **Fix**: A single fix targeting the root cause
7. **Verification**: Reproduction path and related test results after the fix

If any of these seven items are missing, the work is not done.

## Workflow

Follow the steps below in order.

### Phase 0. Attempt Reproduction (MANDATORY First Step)

**Before anything else, try to reproduce the bug.**

1. Run the failing test or command if one exists
2. If no test exists, write a minimal script to trigger the bug
3. Check recent code changes, file states, and environment

**If you cannot figure out how to reproduce:**

→ Stop immediately. Do not proceed to analysis.
→ Use `ask_user_question` to ask the user:
   - "How can I reproduce this issue? What are the exact steps?"
   - "What input or environment triggers this bug?"
   - "Does this happen consistently or intermittently?"

**If reproduction environment is too complex to set up:**

→ Ask the user: "The reproduction environment seems complex. Would you like me to create a plan for setting up the test environment?"
→ If the user agrees, use the `agentic-plan-crafting` skill to plan the environment setup.
→ If the user declines, document the required environment and proceed with caution (gathering evidence via logs, code analysis, etc.).

---

### Phase 1. Define The Problem

First, condense the problem.

- What is the expected behavior
- What is the observed behavior
- What is the scope of impact
- Is it always reproducible or intermittent

Output format:

```text
Problem: <expected> but got <actual> under <condition>
```

Do not mix symptoms with speculation.

```text
Good: Product detail API returns 500 when brand is null.
Bad: Serializer is broken because brand mapping seems wrong.
```

### Phase 2. Reproduce Or Instrument

You must be able to see the failure again before fixing it.

Priority:

1. Reproduce with existing tests
2. Reproduce with a minimal integration test
3. Reproduce with a unit test
4. Observe via reproduction script or command
5. Observe after adding logs/instrumentation

Rules:

- Make the reproduction path as small as possible.
- Even if the bug is only visible in the UI, prefer reproducing at a lower layer if possible.
- For intermittent failures, increase observability by adding logs, capturing inputs, timestamps, and concurrency conditions.
- If reproduction fails, do not proceed to fixing — increase observability instead.

What to do when reproduction is not possible:

1. Record input values
2. Check for environment differences
3. Check recent changes
4. Add logs at boundary points
5. Search for smaller conditions that produce the same symptom

### Phase 3. Gather Evidence

Collect only observable facts.

Always check:

- Full error messages and stack traces
- Failing input values
- Recently changed files or commits
- Environment/configuration differences
- Call paths and data flow

For multi-component problems, check at each boundary.

Examples:

- controller -> application -> service -> repository
- client -> API -> external service
- scheduler -> batch service -> database

At each boundary, check:

- What came in
- What went out
- What values were transformed
- Under what conditions it breaks

Do not fix until you have pinpointed the problem location.

### Phase 4. Isolate Root Cause

Formulate exactly one cause candidate.

Format:

```text
Hypothesis: <root cause> because <evidence>
```

Qualities of a good hypothesis:

- Points to a single cause
- Connects to observed evidence
- Can be disproved with a small experiment

Examples of bad hypotheses:

- "There seems to be some async issue somewhere"
- "The whole serialization layer seems unstable"

Trace the cause back to the source. If the error appears deep in the stack, trace the origin of the input, not the symptom.

### Phase 5. Lock The Failure

Lock the failure before fixing.

Priority:

1. Automated failing test
2. Add a regression case to existing tests
3. Minimal reproduction script
4. Temporary verification via logs/assertions

Rules:

- Create an automated test whenever possible.
- It must fail before the fix.
- It must pass on the same path after the fix.
- The test name must reveal what broke.

If an automated test is feasible, use the `test-driven-development` skill alongside this one.

### Phase 6. Implement A Single Fix

The fix addresses only one hypothesis.

Allowed:

- Minimal code change that directly addresses the cause
- Minimal supporting changes needed for verification

Forbidden:

- Bundling multiple seemingly related fixes
- Combining refactoring with the fix
- Sneaking in formatting/cleanup/renaming
- Adding null-guards without evidence
- Swallowing exceptions

If the fix fails, immediately return to Phase 1 or Phase 3. The previous hypothesis was wrong.

### Phase 7. Verify And Close

All of the following must be satisfied before closing:

1. The original reproduction path no longer fails.
2. The new failing guard passes.
3. Related tests are not broken.
4. You can explain that the fix blocks the cause, not the symptom.

For intermittent bugs, a single pass is not enough. Verification under repeated runs or varying conditions is required.

## Stop Conditions

Stop and reframe in the following situations.

### 1. Reproduction Failed

If reproduction fails after multiple attempts:

- Check if observability is insufficient.
- Check if there are environment differences.
- Check if the problem definition is wrong.

Changing code without reproduction is forbidden.

### 2. Three Failed Fixes

If three consecutive fixes miss the mark, conclude:

- The current understanding is wrong, or
- The problem is likely structural — shared state, boundary design, responsibility separation

From this point, a "fourth patch" is not the answer — a structural discussion is needed.

### 3. No Failing Guard

If you cannot create a failing test or equivalent reproduction mechanism, do not declare completion. At minimum, leave behind the reproduction command and observed results.

## Red Flags

If any of the following thoughts arise, stop immediately and return to an earlier phase.

- "I'll just change this one line and it should work"
- "I'll check the logs later, let me fix it first"
- "I'll add the test later"
- "Let me fix this and that together at once"
- "The error is gone, so I don't need to know the cause"

## Minimal Checklist

Use this checklist for self-verification during execution.

- [ ] Attempted reproduction FIRST (or asked user for reproduction method)
- [ ] Defined the problem in one sentence
- [ ] Reproduced or made the failure observable
- [ ] Collected evidence
- [ ] Created a single root-cause hypothesis
- [ ] Created a failing guard before fixing
- [ ] Applied only a single fix
- [ ] Verified via the same path after fixing

## Completion Standard

The completion criterion for this skill is not "the code changed."

Completion criteria:

- The problem definition is clear
- The failure was locked before fixing
- The fix is connected to the root cause
- Verification results remain

Without these four, debugging is not finished.
