# roach-pi lightweight native team mode verification

**Date:** 2026-04-27  
**Plan:** `.omx/plans/roach-pi-team-mode-consensus-plan.md`  
**Test spec:** `.omx/plans/test-spec-roach-pi-team-mode.md`

## Scope

This document defines the repeatable verification gate for the lightweight native team-mode MVP. It is intended to be updated with final command output after implementation branches are integrated.

## Acceptance checklist

| Area | Required evidence |
|---|---|
| Team primitives | `extensions/agentic-harness/team.ts` exports task/status types, planning helpers, worker prompt builder, and injectable orchestration helpers. |
| Tool registration | Root sessions register `team`; subagent sessions do not register root-only `team`; `PI_TEAM_WORKER=1` suppresses both `team` and `subagent`. |
| Dispatch guard | Team worker calls set `PI_TEAM_WORKER=1` and cap delegation depth so workers cannot recursively orchestrate. |
| Lifecycle | Tasks move `pending` → `in_progress` → `completed` or `failed`, with owner, summaries, artifacts, and worktree refs retained. |
| Synthesis | Final summary includes goal, counts, per-task status, output summaries, and structured verification evidence. Any failed worker makes the run partial/failed. |
| MVP limits | Generated tasks are dependency-free parallel batches; full dependency scheduling is documented as deferred parity. |
| Documentation | `extensions/agentic-harness/README.md` explains usage, MVP behavior, verification, and deferred parity milestones. |

## Required commands

Run from `extensions/agentic-harness` after integrating the implementation and docs branches:

```bash
npm test
npm run build
```

Expected result:

- `npm test` passes all unit, registration, and e2e-style fake-runner tests. Baseline evidence from the planning lane was 30 test files / 276 tests passing; update this count after final integration if it changes.
- `npm run build` passes TypeScript compilation (`tsc --noEmit`).
- Lint status is explicit: there is currently no `lint` script in `extensions/agentic-harness/package.json`; do not report a lint gate as passing unless a script is added and run.

## Test coverage map

| Test file | Coverage expected |
|---|---|
| `tests/team.test.ts` | Task creation, worker prompt guardrails, worker-count clamp, dependency-free MVP tasks, success/failure synthesis, evidence fields, dispatch env/depth options. |
| `tests/extension.test.ts` | Root `team` registration, subagent/team-worker suppression, existing `subagent` expectations preserved. |
| Fake-runner e2e test | Goal with `workerCount=2` dispatches two workers, synthesizes successful results, and reports failure/partial status when one worker fails. |

## Manual review points

- Confirm no new third-party dependencies were added for team mode.
- Confirm existing `subagent` behavior remains stable outside team-worker context.
- Confirm `extensions/agentic-harness/README.md` contains exactly one `## Lightweight Native Team Mode` section.
- Confirm README deferred parity list includes persistent resume, recorded worker inbox/outbox, heartbeat/status monitoring, staged pipelines, tmux runtime/live visualization, and default worktree-per-worker isolation.
- Confirm the release PR uses a conventional commit type matching the actual change (`feat(agentic-harness)`, `test(agentic-harness)`, `docs(agentic-harness)`, or `ci`).
- Confirm no final report claims full success without the command output above.

## Latest worker-4 docs/release verification

Working directory: `/Users/lit/.pi/agent/git/github.com/tmdgusya/roach-pi/.omx/team/implement-the-remaining-roach/worktrees/worker-4`

- PASS — `grep -n "^## Lightweight Native Team Mode" extensions/agentic-harness/README.md` returned one section at line 61.
- PASS — `cd extensions/agentic-harness && npm test` passed 30 test files / 279 tests after integrating the team-mode contract/registration test updates.
- PASS — `cd extensions/agentic-harness && npm run build` passed TypeScript compilation (`tsc --noEmit`).
- Lint — no `lint` script exists in `extensions/agentic-harness/package.json`; lint gate remains not applicable for this branch.
