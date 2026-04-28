# Teammode acceptance addendum: CLI must appear, not JSON mode

Date: 2026-04-28  
Owner lane: worker-1 / planner  
Related plan: `.omx/plans/teammode-normal-pi-cli-workers-implementation-plan.md`

## Non-negotiable acceptance gate

For tmux-backed teammode workers, the worker pane must be an actual normal pi CLI session. The implementation is not acceptable if it:

- launches the worker as `pi --mode json`;
- launches JSON mode and hides it behind a renderer, wrapper, beautifier, or transcript filter;
- treats JSON-rendered output as equivalent to directly running `pi`;
- depends on scraping raw JSON events from the visible worker pane for orchestration.

The correct tmux shape is:

```text
orchestrator pane
  owns /team, task state, result collection, cleanup, final synthesis

worker pane
  runs normal pi CLI, same user-visible mode as directly running pi
  writes final result through an explicit artifact/status side-channel
```

## Executor checklist

- [ ] Tmux worker launch args omit `--mode json`.
- [ ] Tmux worker launch script omits JSON renderer heredocs such as `PI_TMUX_RENDERER`.
- [ ] Visible `task-N.log` is human pi CLI output, not JSON event envelopes.
- [ ] Native/non-tmux backend still uses JSON mode where machine-readable stdout is required.
- [ ] Orchestrator result collection uses artifact/status side-channels for tmux workers.
- [ ] Missing tmux worker final-output artifact is a contract failure or explicitly marked fallback, not silent success.

## Verifier checklist

Automated:

```bash
cd extensions/agentic-harness
npm test -- tests/tmux-command.test.ts tests/subagent-process.test.ts tests/team-e2e-tmux.test.ts tests/team-tool.test.ts tests/team.test.ts
npm test
npm run build
```

Manual:

- Run a real `backend=tmux` team smoke test.
- Watch the spawned worker pane during execution.
- PASS only if the pane looks like direct `pi` CLI and no raw JSON-mode transcript is visible.
- Confirm the orchestrator still emits a final team summary from the worker artifact/status result.
