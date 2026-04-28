# Team Inbox Orchestration Review

**Date:** 2026-04-28 16:50 KST
**Plan Document:** `.omx/plans/prd-team-inbox-orchestration-20260428T065622Z.md`
**Test Spec:** `.omx/plans/test-spec-team-inbox-orchestration-20260428T065622Z.md`
**Verdict:** FAIL

---

## 1. File Inspection Against Plan

| Planned File | Status | Notes |
|---|---|---|
| `extensions/agentic-harness/team-state.ts` | OK | Defines durable `TeamCommand`, `TeamCommandStatus`, `commands[]` normalization, lifecycle event types, status-version conflict handling, stale marking, retry cap, and command-to-task projection helpers. |
| `extensions/agentic-harness/team.ts` | OK with risk | Implements initial command enqueue and follow-up command path via `resumeRunId + commandTarget + commandMessage`; persists lifecycle transitions and structured failure/block outcomes. Risk remains that true live-pane dispatch was not manually smoke-tested. |
| `extensions/agentic-harness/team-command.ts` | OK | Parses `command=` and `message=`, builds follow-up prompt without requiring a new goal, and has completions coverage. |
| `extensions/agentic-harness/index.ts` | OK | Tool schema includes `commandTarget`/`commandMessage`; slash handler accepts follow-up mode and rejects missing goal unless follow-up fields are present. |
| `extensions/agentic-harness/subagent.ts` | OK | Tmux path can launch text-mode non-`-p` `pi` CLI panes; JSON mode remains available for non-tmux/default paths. |
| `extensions/agentic-harness/README.md` | OK | Documents command inbox, follow-up command mode, retry cap, and real CLI pane behavior. |
| `extensions/agentic-harness/tests/team-state.test.ts` | OK | Covers lifecycle transitions, statusVersion conflicts, retry cap, stale handling, normalization, projection, and idempotent duplicate ack/start. |
| `extensions/agentic-harness/tests/team.test.ts` | OK | Covers initial command lifecycle, follow-up enqueue/dispatch, missing target failure, and wake-up blocked path. |
| `extensions/agentic-harness/tests/team-command.test.ts` | OK | Covers slash parsing/building for follow-up command mode. |
| `extensions/agentic-harness/tests/extension.test.ts` | OK | Covers schema exposure for command follow-up fields. |
| `extensions/agentic-harness/tests/tmux-command.test.ts` | OK | Covers text-mode/no-`-p` tmux launch behavior. |
| `extensions/agentic-harness/tests/team-e2e-tmux.test.ts` | OK | Fake tmux e2e asserts no `--mode json`, no `-p`, no `PI_TMUX_RENDERER`; does not replace the required real tmux smoke. |

## 2. Acceptance Criteria Check

| Criterion | Status | Evidence |
|---|---|---|
| New team runs create durable command records per worker | PASS | `enqueueTeamCommand` plus run setup in `team.ts`; tests assert command events and per-worker command fields. |
| Follow-up `/team resume=<runId> command=<worker|taskId> message="..."` enqueues durable command | PASS | Parser/tool/schema support exists; `runTeamFollowUpCommand` persists queued command before dispatch. |
| Worker command lifecycle reaches completed/blocked/failed and survives resume | PASS | Lifecycle helpers and tests cover completed, blocked, failed, stale, normalization. |
| Retry preserves command id, increments attempt, cap 3 | PASS | `TEAM_COMMAND_MAX_ATTEMPT = 3`; tests cover capped retry blocking. |
| Status-version guard prevents stale overwrites | PASS | `command_conflict` event and tests for unchanged command on stale version. |
| Old team records without `commands[]` remain readable | PASS | `normalizeTeamRunRecord` defaults missing commands to `[]`; tests cover legacy normalization. |
| Real tmux panes launch as readable `pi` CLI, not JSON log renderer | PARTIAL | Automated fake tmux tests verify command construction has no `--mode json`, no `-p`, and no renderer env. Required real tmux smoke was not executed in this review. |
| Orchestrator can manage workers through durable inbox | PARTIAL | Durable command path exists. End-to-end reliability with real live panes/inbox consumption remains unproven without manual tmux smoke. |

## 3. Test Results

| Test Command | Result | Notes |
|---|---|---|
| `cd extensions/agentic-harness && npm test` | PASS | 37 test files passed; 370 tests passed. |
| `cd extensions/agentic-harness && npm run build` | PASS | `tsc --noEmit` exited 0. |
| `git diff --check` | PASS | No whitespace errors. |
| Real tmux smoke: start team, enqueue follow-up, verify pane is real CLI and command lifecycle persists | NOT RUN | Required by PRD verification path and test spec manual section; no artifact was produced during this independent review. |

**Full Test Suite:** PASS (370 passed, 0 failed)

## 4. Code Quality

- [x] No placeholders found in planned implementation files
- [x] No debug code found in planned implementation files
- [x] No commented-out implementation blocks identified in inspected files
- [ ] No changes outside plan scope

**Findings:**
- `extensions/agentic-harness/tests/team-e2e-tmux.test.ts:24` contains `console.log('normal pi cli pane output');`; this is inside a fake CLI fixture and is not debug code.
- Unexpected untracked files outside the team-inbox plan scope are present in the working tree:
  - `docs/engineering-discipline/context/2026-04-28-tmux-mouse-scroll-omx-parity-brief.md`
  - `docs/engineering-discipline/plans/2026-04-28-tmux-mouse-scroll-current-window-followup.md`
  - `docs/engineering-discipline/plans/2026-04-28-tmux-mouse-scroll-omx-parity.md`
  - `docs/engineering-discipline/reviews/2026-04-28-tmux-mouse-scroll-omx-parity-review.md`

## 5. Git History

| Planned Commit | Actual Commit | Match |
|---|---|---|
| No explicit commit structure specified in PRD/test spec | No implementation commit exists; working tree has uncommitted modifications | N/A |

## 6. Overall Assessment

The implementation satisfies most code-level requirements in the PRD: durable command records, follow-up command routing, lifecycle transitions, retry/conflict/stale handling, legacy normalization, documentation, and automated tests are present and passing.

The verdict is **FAIL** because not all plan verification criteria are satisfied:

1. The PRD explicitly requires a real tmux smoke test: "start team, enqueue follow-up, verify pane is real CLI and command lifecycle persists." The test spec also includes a manual tmux smoke section. This review did not execute that manual smoke and therefore cannot verify the highest-risk behavior: dispatching follow-up commands into actual live `pi` CLI panes rather than only fake tmux fixtures.
2. The working tree contains untracked documentation files outside the team-inbox orchestration plan scope, so the review cannot confirm a clean plan-scoped change set.

## 7. Follow-up Actions

1. Run and archive a real tmux smoke artifact showing:
   - team starts in real readable `pi` CLI panes;
   - `/team resume=<runId> command=<worker|taskId> message="..."` reaches the intended worker;
   - command lifecycle persists as queued → acknowledged/started → completed/blocked/failed;
   - no JSON-log renderer appears in worker panes.
2. Resolve or explicitly separate the unrelated untracked mouse-scroll engineering documents before final review.
3. Rerun:
   - `cd extensions/agentic-harness && npm test`
   - `cd extensions/agentic-harness && npm run build`
   - `git diff --check`
4. Re-run this review after the real tmux smoke evidence and working-tree scope are clean.
