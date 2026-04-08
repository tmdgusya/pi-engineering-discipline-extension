# Autonomous Dev Beta Known Issues

Date: 2026-04-08
Scope: `extensions/autonomous-dev`
Status: Not ready for unattended/public beta yet. Supervised experimental use only.

## Summary

`autonomous-dev` has improved significantly, but it still has several reliability issues that can leave issues stuck in `autonomous-dev:in-progress`, show misleading HUD state, or keep child workers alive longer than expected.

## Known Issues

### 1. Worker can lock an issue as `in-progress` and then stall
- **Observed behavior:** Issue `#8` in `tmdgusya/roach-pi` was moved to `autonomous-dev:in-progress` and then appeared to stop making meaningful progress for a while.
- **What we saw:** logs showed worker startup and activity, but no final `worker.result`, `issue.completed`, or failure transition for a long time.
- **Impact:** A ready issue can become effectively stuck and stop being picked up again.
- **Likely cause:** nested subagent / child `pi` execution can hang or run much longer than expected without a watchdog.
- **Needed fix:** add worker timeout + recovery policy.

### 2. Stop/cleanup behavior is improved but still not fully trusted in real sessions
- **Observed behavior:** `/autonomous-dev stop` previously did not fully stop background work; recent fixes improved abort behavior, but logs still showed repeated cleanup/session churn and lingering child work patterns.
- **Impact:** Users may believe the engine is stopped while child workers or nested sessions are still alive.
- **Needed fix:** stronger process/session ownership model and explicit cleanup verification.

### 3. Nested child `pi` processes can accumulate
- **Observed behavior:** multiple `pi` child processes remained alive during investigation.
- **Impact:** orphaned or semi-orphaned workers can keep consuming resources, continue work unexpectedly, or confuse status reporting.
- **Needed fix:** tighten worker lifecycle management and add cleanup/reaping for nested child processes.

### 4. Provider/model inheritance can still fail in worker launch paths
- **Observed behavior:** worker runs previously failed with:
  - `No API key found for amazon-bedrock`
- **Status:** model hardcoding was removed and worker preflight checks were added, but this area still needs validation in fresh sessions.
- **Impact:** autonomous runs can fail before real implementation begins.
- **Needed fix:** validate active session provider/model inheritance end-to-end and improve user-facing error handling.

### 5. Historical `Task: ...` child invocation bug existed and must remain guarded
- **Observed behavior:** worker task text was once interpreted as a file path by transient runners (`vite-node`/`tsx`/`ts-node`).
- **Status:** fixed by falling back to `pi` in transient runner contexts.
- **Impact if regressed:** worker cannot start and fails immediately.
- **Needed fix:** keep regression coverage and verify in real runtime after future runner changes.

### 6. HUD busy/idle indicator was misleading during nested subagent work
- **Observed behavior:** when live activity showed `run subagent subagent`, the HUD could still show the orange/idle state.
- **Status:** fixed by switching the visual state logic to use `activeWorkerCount` instead of only `currentActivity` string matching.
- **Impact:** operator confidence drops because the engine appears idle while work is actually running.
- **Needed follow-up:** validate in live sessions after restart.

### 7. `in-progress` issue recovery is incomplete
- **Observed behavior:** if a worker hangs or the session dies at the wrong time, GitHub can still show an issue as `autonomous-dev:in-progress` with no active orchestrator owning it.
- **Impact:** issue queue can deadlock until a human manually restores labels.
- **Needed fix:** implement startup recovery / stale-lock reconciliation.

### 8. Poll cycle still mixes discovery with long-running execution
- **Observed behavior:** empty polls were fast (~0.5s), but issue-processing polls could take ~13s or much longer because worker execution happens inline with polling.
- **Impact:** sluggish UX and harder reasoning about current engine state.
- **Needed fix:** split quick poll/discovery from long-running worker processing.

### 9. Logging is present but not yet sufficient for full nested-worker diagnosis
- **Observed behavior:** JSONL logs are useful, but nested subagent ownership/termination is still hard to reason about from current events alone.
- **Impact:** debugging stuck workers takes longer than it should.
- **Needed fix:** add clearer correlation IDs / worker instance IDs / parent-child process tracing.

## Minimum fixes before calling this a real beta

1. Add worker timeout and abort handling for hung nested execution.
2. Add stale `in-progress` recovery on startup.
3. Ensure stop/shutdown fully tears down nested child workers.
4. Validate provider/model inheritance in a fresh restarted session.
5. Confirm end-to-end success for multiple runs: ready issue -> implementation -> PR/comment/label completion.

## Recommended temporary positioning

Use one of these labels instead of a general beta claim:
- `Experimental`
- `Private Beta`
- `Supervised Beta`

Avoid positioning it as:
- unattended beta
- public beta
- stable beta

## Notes for tomorrow

Suggested debugging order:
1. Reproduce with a fresh restarted `pi` session.
2. Watch `~/.pi/autonomous-dev.log` live while processing a single ready issue.
3. Track nested child `pi` processes during worker execution.
4. Add timeout + stale lock recovery before broader rollout.
