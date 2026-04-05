---
name: karpathy
description: Behavioral guardrails to prevent common LLM coding mistakes — enforces surgical changes, assumption verification, and scope discipline before and during implementation. Use when implementing features, modifying code, or when you notice yourself about to make changes without reading the existing code first.
---

# Karpathy Guidelines

A preventive thinking discipline for code implementation. Activates before and during code writing to block the most common mistakes LLMs make when generating code.

This is not about performance (that's `rob-pike`) or debugging (that's `systematic-debugging`). This is about the act of writing code itself — reading before writing, changing only what's asked, verifying instead of assuming, and defining what "done" means before starting.

## Hard Gates

These rules have no exceptions.

1. **Read before you write.** Do not modify a file you haven't read. Do not modify a function without understanding the callers. Do not modify a module without understanding its role.
2. **Scope to the request.** Change what was asked. Nothing more. No "while I'm here" improvements, no opportunistic refactoring, no adding features that weren't requested.
3. **Verify, don't assume.** If you think a function does X, read it. If you think a type has field Y, check it. If you think a test covers scenario Z, find it. Assumptions are the primary source of LLM coding errors.
4. **Define success before starting.** Before writing any code, state what "done" looks like in concrete, verifiable terms. If you can't define it, you don't understand the task yet.

## When To Use

- Before implementing any feature or change
- When modifying existing code
- During code review (as a mental checklist)
- When you catch yourself generating code without having read the surrounding context

## When NOT To Use

- Greenfield projects with no existing code to read (gates 1 and 3 still apply to dependencies)
- Pure documentation changes
- Performance optimization (use `rob-pike` instead)

## The Five Rules

### Rule 1: Make Surgical Changes

Every change should be the minimum edit that achieves the goal.

**Before writing, ask:**

- What is the smallest change that solves this?
- Am I touching files that don't need to change?
- Am I adding code that wasn't requested?

**Prohibited additions unless explicitly requested:**

- Type annotations on code you didn't change
- Docstrings on functions you didn't change
- Comments on logic you didn't change
- Error handling for scenarios that aren't part of the task
- Refactoring of surrounding code
- "Improvements" you noticed along the way

One task, one change. If you discover something else that needs fixing, note it — don't fix it now.

### Rule 2: Read The Existing Code

LLMs generate code based on patterns. Codebases have their own patterns. These often conflict.

**Before modifying any file:**

1. Read the file
2. Identify the conventions it uses (naming, error handling, patterns, structure)
3. Match those conventions exactly in your changes

**Before modifying any function:**

1. Find all callers
2. Understand the contract (what goes in, what comes out, what side effects)
3. Ensure your change doesn't break the contract

**Before adding a new file:**

1. Check if similar functionality exists elsewhere
2. Follow the project's file organization pattern
3. Use the same naming conventions as neighboring files

Do not invent new patterns. Follow the ones that exist.

### Rule 3: Verify Assumptions

Every assumption is a potential bug. The most dangerous assumptions are the ones that feel obvious.

**Common assumptions that cause failures:**

| Assumption | Verification |
|---|---|
| "This function returns X" | Read the function |
| "This field is always present" | Check the type definition and upstream producers |
| "This test covers that case" | Read the test |
| "This import path is correct" | Check the file exists at that path |
| "This API accepts these parameters" | Read the API definition or documentation |
| "This library works this way" | Check the version and docs |
| "This config value is set" | Check the actual config |

When in doubt, grep. When confident, grep anyway.

### Rule 4: Define Success Criteria

Before writing code, state what "done" means.

Format:

```text
Done when:
- [ ] <specific, verifiable condition>
- [ ] <specific, verifiable condition>
- [ ] <specific, verifiable condition>
```

Bad criteria:
- "The feature works" (not verifiable)
- "Code is clean" (subjective)
- "Tests pass" (which tests? what do they verify?)

Good criteria:
- "POST /api/users returns 201 with valid payload and 400 with missing email"
- "Existing tests in user.test.ts still pass"
- "New test covers the null-brand edge case from issue #42"

If you can't write specific criteria, you don't understand the task. Go back and clarify.

### Rule 5: Don't Solve Problems That Don't Exist

LLMs love to anticipate future needs. This produces code that is more complex than necessary.

**Block these impulses:**

- "What if someone calls this with null?" — Is that possible in the current code? If not, don't guard against it.
- "This should be configurable" — Is configuration needed now? If not, hardcode it.
- "We might need to support multiple backends" — Do we have multiple backends? If not, don't abstract.
- "This could be a generic utility" — Is it used in more than one place? If not, keep it specific.
- "Let me add a feature flag" — Was a feature flag requested? If not, just change the code.

Build for what is needed today. Tomorrow's problems will have tomorrow's context.

## Anti-Patterns

| Impulse | Rule Violated | Response |
|---|---|---|
| "Let me quickly refactor this while I'm here" | Rule 1 | One task, one change. Note it for later. |
| "I know how this works, I'll just write the fix" | Rule 2 | Read first. Your mental model may be wrong. |
| "This probably takes a string" | Rule 3 | Check the type. "Probably" means you don't know. |
| "I'll know it's done when it works" | Rule 4 | Define concrete criteria before starting. |
| "Let me make this extensible for future use" | Rule 5 | Build for now. Extensibility is a future task. |
| "The code around this is messy, let me clean it" | Rule 1 | Not your task. File a separate issue. |
| "I'll add some helpful logging" | Rule 1 | Was logging requested? If not, don't add it. |

## Red Flags

Stop and re-read the rules if you catch yourself thinking:

- "This is obvious, I don't need to read the code"
- "I'll just add a few extra things while I'm at it"
- "This should probably handle edge case X" (without checking if X can occur)
- "Let me improve the type safety here too"
- "I know what this function does"
- "This needs better error handling" (without evidence of errors occurring)
- "The naming is inconsistent, let me fix it across the file"

## Minimal Checklist

During implementation, verify against this list:

- [ ] I read the files I'm modifying before changing them
- [ ] My changes are scoped to what was requested
- [ ] I verified my assumptions about types, APIs, and behavior
- [ ] I defined concrete success criteria before starting
- [ ] I'm not solving hypothetical future problems
- [ ] I'm following existing project conventions, not inventing new ones
- [ ] Every new line of code is necessary for the task

## Completion Standard

Implementation is disciplined when:

- All changes are within the requested scope
- No assumptions were made without verification
- Success criteria were defined and met
- No speculative code was added
- Existing conventions were followed

If any of these are not met, the implementation needs revision.

## Transition

After implementation is complete:

- If AI-generated code smells remain → use `clean-ai-slop` to run a corrective pass
- If a bug is discovered → use `systematic-debugging` to investigate
- If performance is a concern → use `rob-pike` before optimizing
