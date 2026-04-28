# Roach-pi Lightweight Native Team Mode: Remaining Work Staged Plan

Date: 2026-04-27
Owner lane: worker-1 planner — architecture/state/resume planning
Source context:
- `.omx/context/roach-pi-team-mode-remaining-plan-20260427T054319Z.md`
- `.omx/plans/roach-pi-team-mode-consensus-plan.md`
- `extensions/agentic-harness/README.md`
- Current implementation in `extensions/agentic-harness/team.ts`, `index.ts`, `subagent.ts`, `artifacts.ts`, `worktree.ts`, and tests

## Current Baseline Evidence

The MVP already exists as a root-only `team` tool:

- `extensions/agentic-harness/team.ts` defines `TeamTask`, `TeamRunOptions`, `TeamRunSummary`, `TeamVerificationEvidence`, `TeamRuntime`, `createDefaultTeamTasks`, `validateTeamTasks`, `buildTeamWorkerPrompt`, `runTeam`, and formatting/synthesis helpers.
- `extensions/agentic-harness/index.ts` registers `team` only for root sessions when `PI_TEAM_WORKER !== "1"`, suppresses `subagent` in team-worker context, and dispatches team workers through `runAgent` with `PI_TEAM_WORKER=1` and `PI_SUBAGENT_MAX_DEPTH=1`.
- `extensions/agentic-harness/tests/team.test.ts` covers default task creation, worker prompt guardrails, blocked dependency rejection, success synthesis/evidence, and failure synthesis/evidence.
- `extensions/agentic-harness/tests/extension.test.ts` covers root registration plus suppression in subagent/team-worker contexts.
- `extensions/agentic-harness/README.md` documents MVP behavior and defers persistent resume/recovery, inbox/outbox, heartbeat/status, staged pipeline, tmux visualization, and default worktree-per-worker isolation.

This plan keeps the architecture lightweight-native and extends current task records instead of replacing the `runAgent`-backed MVP with an OMX/tmux clone.

## Planning Principles

1. **MVP-first, parity-second:** add one independently testable capability per milestone; avoid introducing a durable runtime before the state model proves useful.
2. **File-backed state as the spine:** persistent resume, messaging, heartbeat, staged pipeline, and worktree policy should all converge on a small run-store abstraction instead of ad hoc files.
3. **Explicit failure and recovery:** no milestone may summarize partial work as success; interrupted/running/stale states must be visible and recoverable.
4. **Runtime invariants over prompt-only rules:** keep `PI_TEAM_WORKER=1` suppression and add tests when new worker surfaces appear.
5. **Reversible increments:** each milestone can be disabled or bypassed through options/defaults without breaking current `team` behavior.

## Milestone DAG

```text
M0 Stabilize contracts
  ├─ M1 File-backed run state + resume foundation        [worker-1]
  │    ├─ M2 Worker status/heartbeat snapshots           [worker-2]
  │    ├─ M3 Inbox/outbox command messaging              [worker-2]
  │    └─ M4 Default/explicit worktree policy hardening  [worker-2]
  ├─ M5 Staged pipeline on top of run state              [worker-1 + worker-3]
  └─ M6 Documentation, release gates, migration notes    [worker-3]
        └─ M7 Optional tmux/live visualization spike     [future, only after M1-M3]
```

Recommended delivery order: **M0 → M1 → M2 → M3/M4 in parallel → M5 → M6**. Treat M7 as a spike, not a committed parity requirement.

## Milestone M0 — Stabilize Current Team Contracts

**Goal:** lock the MVP's public and internal contracts before adding durable state.

**Implementation tasks**
1. Add a short `TeamRunSummary` contract section in `README.md` or a new docs section that names stable fields (`goal`, counts, `success/ok`, `tasks`, `verificationEvidence`).
2. In tests, assert that `TeamRunSummary` remains JSON-serializable and that `TeamTask.id` values are stable (`task-1`, `task-2`, ...).
3. Add one regression test for `formatTeamRunSummary` so later state/resume changes do not accidentally drop structured evidence.

**Likely files**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/tests/team.test.ts`
- `extensions/agentic-harness/README.md`

**Acceptance criteria**
- Existing team tool behavior is unchanged for calls without new options.
- Tests prove the current summary/task shape is stable and serializable.
- `npm test` and `npm run build` pass from `extensions/agentic-harness`.

**Risks / mitigations**
- Risk: over-freezing internal fields too early.
- Mitigation: mark only externally useful fields as stable; keep helper internals private.

## Milestone M1 — File-backed Run State + Resume Foundation (worker-1 primary)

**Goal:** introduce durable run records that can recover interrupted team runs without implementing a full scheduler yet.

**Implementation tasks**
1. Add a small state module, e.g. `extensions/agentic-harness/team-state.ts`, with pure helpers plus file I/O:
   - `TeamRunRecord` containing `schemaVersion`, `runId`, `goal`, `createdAt`, `updatedAt`, `status`, `options`, `tasks`, `events`, and `summary`.
   - `TeamRunStatus = "created" | "running" | "completed" | "failed" | "cancelled" | "interrupted"`.
   - `createTeamRunRecord`, `recordTeamEvent`, `writeTeamRunRecord`, `readTeamRunRecord`, `listTeamRuns`, `markStaleRunningTasks`.
2. Store state under the existing artifact root pattern to avoid a new global store: default `.pi/agent/runs/<rootRunId>/team-run.json`, with an overridable env var such as `PI_TEAM_RUN_STATE_ROOT` only if tests need isolation.
3. Extend `runTeam` through injected persistence callbacks rather than hard-wiring file writes into core orchestration:
   - `runtime.persistRun?(record)`
   - `runtime.loadRun?(runId)`
   - `runtime.now?()` for deterministic tests.
4. Add optional `runId` and `resumeRunId` to `TeamRunOptions`; keep default non-resume path backward-compatible.
5. On resume, initially support conservative recovery only:
   - completed/failed tasks remain terminal;
   - `in_progress` tasks older than a stale threshold are marked `interrupted`/`pending` according to explicit resume mode;
   - dependency scheduling remains deferred.
6. Surface resume state in summary notes and final synthesis.

**Likely files**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/team-state.ts` (new)
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/types.ts` only if shared metadata needs a reusable type
- `extensions/agentic-harness/tests/team-state.test.ts` (new)
- `extensions/agentic-harness/tests/team.test.ts`

**Tests**
- Pure creation test: run record gets stable IDs/timestamps with injected clock.
- Persistence test: write/read round trip preserves tasks/events/summary.
- Resume test: completed task is skipped or retained, stale `in_progress` task is made retryable/visible.
- Backward compatibility test: `runTeam({ goal })` still works with no persistence callbacks.
- Build/typecheck.

**Acceptance criteria**
- Team runs can emit a durable `team-run.json` when persistence is enabled.
- A run can be loaded by `resumeRunId` and produces a clear summary if any task was interrupted.
- No current `team` caller is required to use persistence.
- Interrupted state is never counted as success.

**Risks / mitigations**
- Risk: resume semantics become a hidden scheduler.
- Mitigation: do not add dependency execution in M1; only persist and conservatively mark stale/terminal states.
- Risk: file write races from parallel workers.
- Mitigation: only the root team orchestrator writes the run record in M1; workers still report through `runAgent` results.

## Milestone M2 — Worker Status and Heartbeat Snapshots (worker-2 primary)

**Goal:** make currently running worker state visible without adding live control messages yet.

**Implementation tasks**
1. Extend `TeamTask`/run events with `startedAt`, `updatedAt`, `completedAt`, and optional `heartbeatAt`.
2. Add a root-side heartbeat/update loop in `runTeam` similar to `index.ts` parallel heartbeat, but persisted through the M1 run store.
3. Normalize task lifecycle events: `task_created`, `task_started`, `task_progress`, `task_completed`, `task_failed`, `task_interrupted`.
4. Surface heartbeat/status counts in `emitProgress` and final summary notes.

**Likely files**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/team-state.ts`
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/tests/team.test.ts`
- `extensions/agentic-harness/tests/team-state.test.ts`

**Tests**
- Injected clock verifies lifecycle timestamps update monotonically.
- Fake runner with delayed promise emits/persists in-progress heartbeat before completion.
- Stale heartbeat is not treated as success.

**Acceptance criteria**
- A root user can inspect the run record and see pending/running/completed/failed tasks.
- Heartbeats are root-owned and do not require worker processes to write shared files.

**Risks / mitigations**
- Risk: too much progress noise.
- Mitigation: throttle persisted heartbeat events; keep summary-level counts in UI updates.

## Milestone M3 — Worker Inbox/Outbox Messaging (worker-2 primary)

**Goal:** add minimal message records for root-to-worker instructions and worker-to-root reports, while preserving non-interactive subagent execution.

**Implementation tasks**
1. Add message types in `team-state.ts`: `TeamMessage { id, runId, taskId, from, to, kind, body, createdAt, deliveredAt? }`.
2. Start with **pre-dispatch inbox** only: root embeds task-specific messages into worker prompt and durable state before `runAgent` starts.
3. Add **post-run outbox** extraction: worker final report is stored as an outbox message linked to the task result.
4. Defer true live mid-run messaging until a process protocol exists; document this explicitly.
5. Ensure `PI_TEAM_WORKER=1` still suppresses recursive tools in any prompt/message path.

**Likely files**
- `extensions/agentic-harness/team-state.ts`
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/tests/team-state.test.ts`
- `extensions/agentic-harness/tests/team.test.ts`
- `extensions/agentic-harness/README.md`

**Tests**
- Inbox messages are persisted before worker dispatch.
- Worker output becomes a durable outbox/final-report message.
- Formatting includes message IDs without leaking implementation-only paths.

**Acceptance criteria**
- Run records preserve leader instructions and worker reports per task.
- Documentation states that live bidirectional messaging is deferred.

**Risks / mitigations**
- Risk: users expect live chat with workers.
- Mitigation: name it "recorded inbox/outbox" in this milestone; reserve live control for M7/spike.

## Milestone M4 — Worktree Policy Hardening (worker-2 primary)

**Goal:** make worker isolation safer and more predictable before turning it on by default.

**Implementation tasks**
1. Add a `worktreePolicy?: "off" | "on" | "auto"` option while keeping current `worktree?: boolean` as compatibility sugar.
2. Define `auto` as: use worktrees for multi-worker code-editing tasks when git root is available; stay off for read-only/planning tasks unless requested.
3. Ensure every task summary includes `logicalCwd`, `worktreePath`, `worktreeDiffFile`, and cleanup status when applicable.
4. Add cleanup failure handling to final synthesis risks.

**Likely files**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/subagent.ts` only if metadata/options need small additions
- `extensions/agentic-harness/worktree.ts`
- `extensions/agentic-harness/tests/team.test.ts`
- `extensions/agentic-harness/tests/worktree.test.ts`
- `extensions/agentic-harness/README.md`

**Tests**
- `worktree: true` remains compatible.
- `worktreePolicy: off/on/auto` maps to expected `runAgent` input.
- Cleanup failure appears in evidence/summary and does not masquerade as success.

**Acceptance criteria**
- Worktree policy is explicit and documented.
- No default-on worktree behavior ships until tests prove cleanup/diff capture across success and failure.

**Risks / mitigations**
- Risk: auto policy misclassifies read-only vs code-editing goals.
- Mitigation: start with explicit `on/off`; add conservative `auto` only if easy to test.

## Milestone M5 — Staged Pipeline on Top of Run State (worker-1 + worker-3)

**Goal:** support a lightweight staged team pipeline without creating a separate runtime.

**Implementation tasks**
1. Model stages as run-record metadata: `TeamStage = "plan" | "prd" | "exec" | "verify" | "fix"`.
2. Add optional `pipeline?: TeamStage[]` or `mode?: "batch" | "pipeline"` to `TeamRunOptions`; default remains current batch mode.
3. Implement stage transition helpers over the M1 state store:
   - `createStageTasks(stage, previousSummary)`
   - `completeStage(stage, summary)`
   - `nextStage(record)`
4. Keep first pipeline version sequential by stage and parallel within stage.
5. Require verification stage to consume prior summaries and fail the overall run if verification fails.

**Likely files**
- `extensions/agentic-harness/team.ts`
- `extensions/agentic-harness/team-state.ts`
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/tests/team-pipeline.test.ts` (new) or `team.test.ts`
- `extensions/agentic-harness/README.md`

**Tests**
- Pipeline stages execute in order with fake runners.
- Failed `verify` stage makes overall run failed.
- Resume can continue from the next incomplete stage.
- Default batch behavior is unchanged.

**Acceptance criteria**
- Users can request staged team execution without tmux.
- Stage results and verification evidence are durable in the run record.
- Pipeline is optional and reversible.

**Risks / mitigations**
- Risk: stage decomposition becomes model-dependent and flaky.
- Mitigation: start with deterministic stage scaffolds and fake-runner tests; let worker prompts carry the rich goal context.

## Milestone M6 — Testing, Docs, and Release Gates (worker-3 primary)

**Goal:** make the expanded team mode safe to release and easy to operate.

**Implementation tasks**
1. Add an acceptance matrix to `README.md` mapping deferred parity items to shipped/deferred status.
2. Add examples for:
   - batch team run;
   - persisted run;
   - resume;
   - staged pipeline;
   - explicit worktree policy.
3. Add a troubleshooting section for stale/interrupted runs and cleanup failures.
4. Add release checklist in docs: `npm test`, `npm run build`, targeted tests (`team`, `team-state`, `worktree`, `extension`).
5. Update changelog/release notes only at final integration time.

**Likely files**
- `extensions/agentic-harness/README.md`
- `README.md` only if root docs should advertise team mode
- `CHANGELOG.md` only during release PR
- tests as needed for docs examples if a docs smoke harness exists

**Tests / verification**
- `npm test`
- `npm run build`
- Optional grep/smoke that documented option names match TypeBox schema names.

**Acceptance criteria**
- Docs distinguish MVP, shipped post-MVP capabilities, and intentionally deferred tmux/live-runtime features.
- Release checklist is executable by a new maintainer.

**Risks / mitigations**
- Risk: docs promise live behavior not implemented.
- Mitigation: use precise terms: "persisted state", "resume", "recorded inbox/outbox", not "live worker chat".

## Milestone M7 — Optional tmux / Live Visualization Spike (future only)

**Goal:** decide whether native run records plus pi UI updates are enough, or whether a tmux-like visualization is worth porting.

**Entry criteria**
- M1-M3 are shipped and used at least once.
- Clear user need for live panes/control exists.
- State model is stable enough to drive visualization.

**Spike tasks**
1. Prototype a read-only monitor that tails `team-run.json` and displays task status.
2. Compare pi-native UI updates vs external tmux panes.
3. Do not add command/control until read-only monitor proves useful.

**Likely files**
- Separate CLI/helper file only if needed; avoid changing core `team.ts` in spike.

**Acceptance criteria**
- Written recommendation: keep native only, add read-only monitor, or invest in live runtime.

## Cross-lane Staffing Plan

### Worker 1 — Architecture / state / resume

Own:
- M0 contract stabilization.
- M1 `team-state.ts` and `runTeam` persistence/resume integration.
- M5 pipeline state architecture with worker-3 test/docs support.

Recommended role: `architect` for state design review, then `executor` for implementation, `verifier` for resume edge cases.

### Worker 2 — Messaging / status / worktree

Own:
- M2 heartbeat/status snapshots.
- M3 recorded inbox/outbox.
- M4 worktree policy hardening.

Recommended role: `executor` with `test-engineer` support for lifecycle/status tests.

### Worker 3 — Testing / docs / release

Own:
- M6 docs/release gates.
- Cross-milestone acceptance matrix.
- Pipeline/resume test harness hardening.
- Final verification report.

Recommended role: `test-engineer` + `writer` + `verifier`.

## Team Launch Hints

For a coordinated implementation team after this plan is approved:

```text
Worker 1: Implement M0-M1 architecture/state/resume from .omx/plans/roach-pi-team-mode-remaining-work-staged-plan.md. Own team-state.ts, runTeam persistence integration, and state tests. Do not edit docs beyond state/resume sections unless coordinating with worker-3.

Worker 2: Implement M2-M4 messaging/status/worktree policy from the plan. Own lifecycle timestamps, heartbeat snapshots, recorded inbox/outbox, worktree option mapping, and targeted tests.

Worker 3: Implement M6 and cross-cutting verification/docs. Own README acceptance matrix, release checklist, docs examples, and final test/build evidence. Coordinate with worker-1 on M5 pipeline tests.
```

Suggested sequencing:
1. Start worker-1 on M0-M1 first.
2. Start worker-3 in parallel on test harness inventory and docs outline.
3. Start worker-2 after M1 state record shape is drafted, or let worker-2 implement against a small interface stub reviewed by worker-1.
4. Integrate M2/M3/M4 only after state tests pass.
5. Add M5 pipeline once persisted state and status events are stable.

## Verification Plan

Minimum per milestone:

```bash
cd extensions/agentic-harness
npm test
npm run build
```

Targeted checks to add/run as milestones land:

```bash
cd extensions/agentic-harness
npm test -- tests/team.test.ts
npm test -- tests/team-state.test.ts
npm test -- tests/extension.test.ts
npm test -- tests/worktree.test.ts
```

End-to-end fake-runner evidence required before release:
- persisted batch run succeeds;
- persisted batch run with one failed worker reports failed/partial;
- resume of interrupted run never reports success until retry/completion;
- pipeline verify failure fails the overall run;
- `PI_TEAM_WORKER=1` still suppresses recursive orchestration tools.

## Open Questions for the Lead / Product Owner

- Should persisted run state be enabled by default immediately in M1, or introduced behind an option first? Recommended: option first, default on only after one release.
- Should `resumeRunId` retry stale `in_progress` tasks automatically, or require an explicit retry flag? Recommended: require explicit retry flag for first release.
- Is tmux/live visualization a hard parity target or only a possible future spike? Recommended: spike only after persisted state proves useful.

## Definition of Done for the Remaining Work Epic

- Current MVP batch behavior remains backward-compatible.
- Durable run records support inspectable status and conservative resume.
- Worker messages/reports are recorded in state, with live chat explicitly deferred.
- Heartbeat/status snapshots distinguish running, stale, failed, completed, and interrupted tasks.
- Worktree policy is explicit, tested, and documented.
- Optional staged pipeline is implemented over the same state model.
- Documentation and tests clearly separate shipped features from deferred tmux/live-runtime parity.
