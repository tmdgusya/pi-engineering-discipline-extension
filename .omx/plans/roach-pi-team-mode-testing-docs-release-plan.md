# roach-pi team mode remaining plan: testing, docs, and release lane

**Owner lane:** worker-3 / planner  
**Date:** 2026-04-27  
**Scope:** Testing, documentation, and release readiness for post-MVP lightweight native team mode.  
**Inputs reviewed:**

- `.omx/context/roach-pi-team-mode-remaining-plan-20260427T054319Z.md` from leader state
- `.omx/plans/roach-pi-team-mode-consensus-plan.md` from leader state
- `extensions/agentic-harness/README.md`
- Current implementation touchpoints: `extensions/agentic-harness/team.ts`, `extensions/agentic-harness/index.ts`, `extensions/agentic-harness/tests/team.test.ts`, `extensions/agentic-harness/tests/extension.test.ts`, `.releaserc.mjs`, `.github/workflows/release.yml`, `docs/engineering-discipline/reviews/2026-04-27-roach-pi-team-mode-verification.md`

## Current evidence baseline

- The MVP already has a native `team` helper in `extensions/agentic-harness/team.ts` with task records, worker prompt guardrails, `PI_TEAM_WORKER` env guard, success/failure synthesis, structured verification evidence, and fake-runner tests.
- The root extension registers `team` only for root non-team-worker sessions and suppresses recursive `team`/`subagent` registration when `PI_TEAM_WORKER=1`.
- Existing team tests cover stable task ids/owners, worker-count clamping, worker prompt guardrails, dependency rejection, fake success synthesis, and failed-worker synthesis.
- Existing extension tests cover root `team` registration, subagent-context suppression, and team-worker recursive-orchestration suppression.
- `extensions/agentic-harness/README.md` documents lightweight native team mode, but the section is duplicated; docs should be consolidated before release.
- Release automation uses semantic-release on `main`; root release workflow currently runs `npm ci` and `npx semantic-release`, while extension-local verification remains `npm test` and `npm run build` from `extensions/agentic-harness`.
- Verification run in this worker worktree after `npm ci`:
  - PASS: `npm test` in `extensions/agentic-harness` — 30 files, 276 tests passed.
  - PASS: `npm run build` in `extensions/agentic-harness` — `tsc --noEmit` completed with exit code 0.
  - Lint: no lint script exists in `extensions/agentic-harness/package.json`; use tests/build plus docs review unless a lint script is added later.

## Non-goals for this lane

- Do not implement state/resume, inbox/outbox, heartbeat/status, dependency scheduling, tmux runtime, or default worktree policy directly in this lane.
- Do not redesign `runAgent` or team dispatch semantics unless worker-1/worker-2 plans introduce an accepted contract change.
- Do not add new dependencies for docs/test/release hardening unless explicitly approved.

## Milestone dependency map

```text
M0 baseline evidence
  -> M1 test contract hardening
  -> M2 docs consolidation
  -> M3 release/CI gate
  -> M4 post-MVP parity test scaffolds

Worker-1 architecture/state-resume plan feeds M4 state/resume test cases.
Worker-2 messaging/status/worktree plan feeds M4 messaging/status/worktree test cases and M2 docs updates.
```

## Milestones

### M0 — Preserve baseline verification evidence

**Goal:** Capture the current MVP test/build state before follow-up planning branches change behavior.

**Files likely touched:**

- `docs/engineering-discipline/reviews/2026-04-27-roach-pi-team-mode-verification.md`
- Optional new release note/checklist under `docs/engineering-discipline/reviews/` or `.omx/plans/`

**Implementation tasks:**

1. Update the verification document with the latest command results once implementation branches are integrated.
2. Record no-lint-script status explicitly so release reviewers do not expect an unavailable lint gate.
3. Keep command evidence separate from generated semantic-release changelog content.

**Acceptance criteria:**

- Verification doc includes exact commands, working directory, pass/fail result, and known gaps.
- It states that `npm test` covers 30 files / 276 tests at the current baseline, or updates those counts after integration.
- It states `npm run build` maps to `tsc --noEmit`.
- It states lint is not available unless a later branch adds a lint script.

**Verification:**

- `cd extensions/agentic-harness && npm test`
- `cd extensions/agentic-harness && npm run build`
- Manual read of the verification doc for stale counts/claims.

### M1 — Harden the team-mode regression contract

**Goal:** Make tests describe the intended post-MVP contract clearly enough that worker-1/worker-2 changes can extend behavior without regressing MVP invariants.

**Files likely touched:**

- `extensions/agentic-harness/tests/team.test.ts`
- `extensions/agentic-harness/tests/extension.test.ts`
- Potentially `extensions/agentic-harness/tests/worktree.test.ts` if worker-2 adds default/team worktree policy

**Implementation tasks:**

1. Add or preserve explicit assertions that a partial team run cannot be reported as full success when any worker fails.
2. Add focused assertions for `verificationEvidence` shape: checks run, pass/fail booleans, artifact refs, worktree refs, and notes.
3. Preserve root/subagent/team-worker registration tests whenever index registration changes.
4. When worker-1 introduces persistent state/resume, add regression tests that resumed tasks retain terminal statuses and do not rerun completed workers unless explicitly requested.
5. When worker-2 introduces messaging/status/worktree behavior, add tests for status transitions and worktree-ref propagation without launching real model processes.

**Acceptance criteria:**

- Tests fail if `team` is registered inside `PI_TEAM_WORKER=1` context.
- Tests fail if `subagent` becomes available inside `PI_TEAM_WORKER=1` context.
- Tests fail if failed workers produce `summary.ok === true` or `summary.success === true`.
- Tests remain deterministic and avoid real `pi`/model subprocess calls for the team e2e path.
- New state/messaging/worktree tests are introduced only after the corresponding lane contracts exist.

**Verification:**

- `cd extensions/agentic-harness && npm test -- tests/team.test.ts tests/extension.test.ts`
- Full follow-up: `cd extensions/agentic-harness && npm test`
- `cd extensions/agentic-harness && npm run build`

### M2 — Consolidate team-mode documentation

**Goal:** Provide one clear user-facing team-mode section plus a short release-facing limitation/deferred-parity note.

**Files likely touched:**

- `extensions/agentic-harness/README.md`
- Root `README.md` only if root-level package docs should expose the new tool
- `docs/engineering-discipline/reviews/2026-04-27-roach-pi-team-mode-verification.md`

**Implementation tasks:**

1. Remove the duplicate `## Lightweight Native Team Mode` section in `extensions/agentic-harness/README.md` by merging the best details into one section.
2. Keep the user-facing docs short: purpose, when to use `team` vs `subagent`, parameter shape, MVP behavior, and verification checklist.
3. Keep deferred parity explicit: persistent resume, worker inbox/outbox, heartbeat/status monitoring, staged pipeline, tmux runtime/visualization, and default worktree-per-worker isolation.
4. Add a compatibility note that MVP team mode is a dependency-free parallel batch, not a dependency scheduler.
5. After worker-1/worker-2 plans land, append links or subsections for state/resume, messaging/status, and worktree policy only when the implementation exists.

**Acceptance criteria:**

- `extensions/agentic-harness/README.md` contains exactly one `## Lightweight Native Team Mode` section.
- The section includes an example invocation with `goal`, `workerCount`, `agent`, `worktree`, and optional `maxOutput`.
- The docs do not promise resume/messaging/heartbeat/tmux/worktree defaults before those features are implemented.
- Verification checklist matches actual package scripts.

**Verification:**

- `grep -n "^## Lightweight Native Team Mode" extensions/agentic-harness/README.md` returns one line.
- Manual docs review against `team.ts` and `index.ts` parameter names.
- `cd extensions/agentic-harness && npm test && npm run build` after docs-only changes to catch accidental formatting/import changes if files beyond docs were touched.

### M3 — Define the release gate for team-mode follow-up PRs

**Goal:** Make release readiness repeatable and compatible with existing semantic-release automation.

**Files likely touched:**

- `.github/workflows/release.yml` if CI should also run extension-local tests before semantic-release
- `.releaserc.mjs` only if package release assets or notes need adjustment
- `CONTRIBUTING.md` or `extensions/agentic-harness/README.md` if contributor verification instructions should mention team mode

**Implementation tasks:**

1. Decide whether release workflow should run extension-local `npm ci`, `npm test`, and `npm run build` before `semantic-release`; if yes, add a minimal CI step scoped to `extensions/agentic-harness`.
2. Keep semantic-release package assets aligned with existing release policy; do not hand-edit `CHANGELOG.md` for normal feature notes.
3. Use conventional commits for release classification:
   - `feat(agentic-harness): ...` for user-visible team features
   - `test(agentic-harness): ...` for coverage-only changes
   - `docs(agentic-harness): ...` for docs-only changes
   - `ci: ...` for workflow gates
4. Add a release checklist entry requiring the verification document and README deferred-parity list to be current before merging post-MVP team-mode PRs.

**Acceptance criteria:**

- Release gate runs the same extension-local commands that the plan asks maintainers to trust, or explicitly documents why release CI stays root-only.
- No release step requires live external model calls.
- Release notes can distinguish MVP team mode from deferred parity features.
- If `.github/workflows/release.yml` changes, root `npm ci` and extension-local `npm ci` cache behavior is considered so CI does not accidentally skip extension dependencies.

**Verification:**

- Static review of `.github/workflows/release.yml` for working directories and command order.
- `cd extensions/agentic-harness && npm ci && npm test && npm run build` locally or in CI.
- If workflow changes are made, inspect GitHub Actions result before merging.

### M4 — Add post-MVP parity test scaffolds after worker-1/worker-2 contracts land

**Goal:** Turn the other lanes' accepted contracts into deterministic tests and docs before implementation grows too broad.

**Dependencies:** worker-1 state/resume plan and worker-2 messaging/status/worktree plan.

**Files likely touched:**

- New tests under `extensions/agentic-harness/tests/`, likely `team-state.test.ts`, `team-messaging.test.ts`, or extensions to `team.test.ts`
- `extensions/agentic-harness/README.md`
- Verification docs under `docs/engineering-discipline/reviews/`

**Implementation tasks:**

1. For state/resume: test serialization shape, resume of partial runs, completed-task skip behavior, failed-task retry policy, and corrupt-state handling.
2. For messaging/status: test inbox/outbox data shape, heartbeat/status snapshots, and worker failure visibility without tmux.
3. For worktree policy: test explicit `worktree: true`, default policy once chosen, artifact/worktree ref synthesis, and cleanup/reuse behavior.
4. For staged pipeline: define separate tests for phase transitions before adding any model-driven plan/PRD/exec/verify/fix prompts.
5. Keep each parity test initially fake-runner/file-backed so CI remains deterministic.

**Acceptance criteria:**

- Each parity feature has tests for happy path, failure/partial path, and recovery or explicit non-support.
- Tests do not depend on a real `pi` subprocess or external model response.
- README describes only shipped behavior; planned behavior stays in docs/plans until implemented.
- New tests preserve existing MVP invariants from M1.

**Verification:**

- Targeted test files for each parity area.
- Full `npm test` and `npm run build` before handoff.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| README duplicate sections diverge | Users see conflicting MVP behavior | Consolidate to one section in M2 and add grep-based acceptance check. |
| Tests overfit current implementation and block state/messaging evolution | Slower follow-up work | Assert public contracts, not private helper structure; add new tests only after worker-1/worker-2 contracts land. |
| Release CI does not run extension-local tests | Broken team mode can be released | Add or explicitly document extension-local release gate in M3. |
| Fake e2e tests miss real subprocess integration issues | Runtime regressions escape unit tests | Keep fake-runner tests for CI determinism; add optional manual smoke script/checklist for real `team` tool once stable. |
| Docs promise deferred parity too early | User trust and release notes degrade | Use “deferred parity” language until implementation and tests exist. |
| Worktree default changes surprise users | Dirty working trees or unexpected branches | Require worker-2 policy plus docs/release note before changing default worktree behavior. |

## Suggested team staffing

- **Testing lane owner (test-engineer):** M1 and M4 deterministic regression tests. Medium reasoning; high if state/resume semantics are added.
- **Docs/release owner (writer or planner):** M2 README consolidation and verification docs. Medium reasoning.
- **CI/release owner (build-fixer or git-master):** M3 workflow and semantic-release gate. Medium reasoning; high if workflow failures occur.
- **Verifier:** independent final pass after integration. Run full commands, inspect docs for duplicate sections/stale promises, and confirm acceptance matrix.

## Final release readiness checklist

- [ ] `extensions/agentic-harness/README.md` has one team-mode section and lists only shipped behavior as shipped.
- [ ] Deferred parity list is present and unchanged unless features actually shipped.
- [ ] `docs/engineering-discipline/reviews/2026-04-27-roach-pi-team-mode-verification.md` has current command evidence.
- [ ] `cd extensions/agentic-harness && npm test` passes.
- [ ] `cd extensions/agentic-harness && npm run build` passes.
- [ ] Lint status is explicit: no lint script, or lint script added and passing.
- [ ] Release PR uses conventional commits matching the actual change type.
- [ ] If CI is changed, the GitHub Actions run proves extension-local test/build gate before semantic-release.
