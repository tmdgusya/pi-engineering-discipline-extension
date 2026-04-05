---
name: clean-ai-slop
description: Corrective cleanup of AI-generated code — removes LLM-specific patterns while preserving behavior. Use when the user says "clean up", "deslop", "slop", "clean AI code", or when you spot LLM-generated code smells after any generation session.
---

# AI Slop Cleaner

A corrective discipline for cleaning AI-generated code. Runs after code generation — whether from `run-plan`, a manual session, or any other source.

The core problem: LLMs produce code that works but carries distinctive smells. Over-commenting, unnecessary abstractions, defensive paranoia for impossible scenarios, verbose naming. Left unchecked, these accumulate into a codebase that is harder to read and maintain than hand-written code.

This skill removes those smells systematically, one category at a time, without changing behavior.

## Hard Gates

These rules have no exceptions.

1. **Lock behavior before cleaning.** Run existing tests. If coverage is insufficient, add regression tests for the code you're about to touch. No test coverage, no cleanup.
2. **One smell category per pass.** Do not mix dead code removal with naming fixes. Complete one pass, verify, then start the next.
3. **Run tests after every pass.** If tests fail, revert the pass and investigate. Do not proceed to the next category.
4. **Stay in scope.** Only touch files that were generated or modified by AI. Do not expand into "nearby" code that looks like it could use improvement.
5. **Preserve behavior exactly.** If a cleanup changes observable behavior — even if you think the new behavior is "better" — revert it. Behavior changes require a separate task.

## When To Use

- After `run-plan` completes and the implementation works but reads like AI wrote it
- After any significant code generation session
- When reviewing AI-generated PRs
- When the user explicitly asks to clean up or deslop code

## When NOT To Use

- Code that was written by humans (different smells, different treatment)
- When tests don't exist and can't be added quickly (lock behavior first)
- Mid-implementation — finish the feature, then clean

## Smell Categories

Passes execute in this order. Each pass completes fully before the next begins.

### Pass 1: Dead Code

Remove code that serves no purpose.

- Unused imports
- Unused variables and parameters
- Unreachable branches
- Commented-out code blocks
- Empty error handlers that swallow exceptions

Detection: compiler warnings, linter output, IDE grayed-out symbols. Trust the tooling.

### Pass 2: Over-Commenting

Remove comments that restate what the code already says.

Targets:

- `// Initialize the counter` above `let counter = 0`
- `// Return the result` above `return result`
- JSDoc that repeats the function signature with no additional insight
- Section dividers that add no information (`// --- Helper Functions ---`)
- File headers that describe what is obvious from the filename

Keep: comments that explain *why*, not *what*. Comments about non-obvious constraints. Links to external documentation or issues.

### Pass 3: Unnecessary Abstractions

Remove indirection that serves no purpose.

Targets:

- Helper functions called exactly once (inline them)
- Wrapper classes that delegate everything to one inner object
- Configuration objects for things that will never be configured
- Factory functions that always produce the same thing
- Interface/type definitions used by a single implementation with no plans for more

Test: if removing the abstraction makes the code shorter *and* equally readable, it was unnecessary.

### Pass 4: Defensive Paranoia

Remove error handling for scenarios that cannot occur.

Targets:

- Null checks on values that are guaranteed non-null by the type system
- Try-catch blocks around code that cannot throw
- Validation of internal function parameters (validate at system boundaries only)
- Fallback values for required fields
- Redundant type assertions

Keep: validation at system boundaries (user input, external APIs, file I/O). Error handling where the runtime genuinely can fail.

### Pass 5: Verbose Naming

Shorten names that carry redundant information.

Targets:

- `getUserDataFromDatabase` → `getUser` (where else would it come from?)
- `userAccountStatus` → `status` (when used inside a `User` class, the prefix is redundant)
- `handleButtonClickEvent` → `onClick`
- `responseDataObject` → `response`
- `tempVariableForCalculation` → `temp` or inline it

Rule: a name should be as short as possible while remaining unambiguous in its scope. Longer scope = longer name. Short scope = short name.

### Pass 6: LLM Filler

Remove artifacts of LLM generation style.

Targets:

- Emoji in code, comments, or commit messages (unless the project uses them intentionally)
- Conversational tone in comments ("Let's", "Now we need to", "Great!")
- Excessive `console.log` / `print` statements added "for debugging"
- Redundant type annotations where inference handles it
- Overly structured code that follows a template pattern rather than the natural shape of the problem

## Process

```text
1. Identify scope (which files to clean)
2. Run existing tests — all must pass before starting
3. Add regression tests if coverage is thin
4. Execute Pass 1 → verify → commit
5. Execute Pass 2 → verify → commit
6. ... continue through all relevant passes
7. Run full test suite
8. Report summary of changes
```

Not every pass applies to every codebase. Skip passes that have zero findings. But execute in order — never jump ahead.

## Anti-Patterns

| Impulse | Why It Fails |
|---|---|
| "I'll clean everything in one big pass" | Mixed changes are impossible to debug when tests break |
| "This abstraction is bad, let me redesign it" | Redesign is a separate task, not cleanup |
| "Tests pass, so I'll skip the per-pass verification" | A later pass may interact with an earlier change |
| "This code nearby also looks sloppy" | Scope creep. Only clean what's in scope |
| "The behavior is wrong anyway, I'll fix it while cleaning" | Behavior changes require their own task with their own tests |
| "I don't need regression tests, the code is simple" | Simple code breaks too. Lock behavior first |

## Red Flags

Stop and reconsider if you catch yourself thinking:

- "This is taking too long, let me batch the remaining passes"
- "I'll just quickly fix this other file too"
- "The tests are probably fine, I don't need to run them again"
- "This behavior should be different anyway"
- "I don't need tests for this — it's just removing comments"

## Completion Standard

Cleanup is done when:

- All applicable passes have been executed in order
- Tests passed after every individual pass
- Full test suite passes at the end
- No behavior has changed
- Changes are scoped to the identified files only

If any of these are not met, the cleanup is not complete.

## Minimal Checklist

During cleanup, verify against this list:

- [ ] Behavior is locked with tests before starting
- [ ] Current pass targets one smell category only
- [ ] Tests passed after the current pass
- [ ] No files outside the defined scope were touched
- [ ] No behavior was changed

## Transition

After cleanup is complete:

- If the code was generated by `run-plan` → report results to the user
- If implementation discipline was lacking during generation → consider applying `karpathy` in future sessions to prevent slop at the source
