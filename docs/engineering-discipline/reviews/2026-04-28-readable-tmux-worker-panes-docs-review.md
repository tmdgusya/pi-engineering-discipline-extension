# Readable tmux worker panes documentation and review note

Date: 2026-04-28
Scope: team tmux worker pane readability, raw event side-channel, and operator notes.
Source plan: `.omx/plans/teammode-pi-cli-readable-workers-plan.md`
Source spec: `.omx/specs/deep-interview-teammode-pi-cli-workers.md`

## Requirements recap

The clarified acceptance target is a tmux-backed `/team` run where worker panes are readable to a human while the leader still receives reliable machine-readable events for completion detection and final synthesis.

The key architectural contract is therefore a split stream:

- `task-N.log`: visible pane / operator-facing text, suitable for first-pass debugging.
- `task-N.events.jsonl`: raw pi JSON events and tmux exit marker, suitable for orchestration and low-level diagnostics.

Native backend behavior must remain JSON-stdout based and must not depend on tmux event-log metadata.

## Documentation updates made in this lane

- `extensions/agentic-harness/README.md` now describes tmux worker panes as readable, names the raw event log side-channel, preserves failed-run session retention guidance, and adds a troubleshooting order.
- `TEAM_ARCH.md` now records the split-stream invariant, adds optional event-log metadata to `TeamTerminalMetadata`, updates the lifecycle diagram, and clarifies persisted log semantics.

## Code quality review checklist for implementation lanes

Use this list when reviewing the renderer and tmux adapter implementation:

1. **Backend isolation** — native backend still parses child stdout directly and does not require `eventLogFile`.
2. **Readable default** — standard `message_end` / `agent_end` JSON envelopes do not appear in `task-N.log` for normal successful tmux workers.
3. **Machine reliability** — `task-N.events.jsonl` contains raw worker JSON and a tmux exit marker; `runAgent` polls this file when present.
4. **Failure diagnostics** — non-JSON stdout/stderr remains visible; failure tails prefer readable pane output before raw event data.
5. **Secret safety** — tmux `send-keys` payload remains script-based/quoted and does not inline sensitive environment values.
6. **No dependency creep** — renderer and wrapper use existing TypeScript/Node primitives only.

## Verification expectation

Release readiness requires focused tmux tests plus the normal agentic-harness gates:

```bash
cd extensions/agentic-harness
npm test
npm run build
```

There is no lint script in `extensions/agentic-harness/package.json` at the time of this note; use test/build output and manual docs review as the lint substitute unless a lint script is added later.
