# Team Mode Architecture

This diagram summarizes the current lightweight team mode flow in `extensions/agentic-harness`.

```mermaid
flowchart TD
  User["User / slash command"] --> Slash["/team command parser<br/>team-command.ts"]
  User --> Tool["team tool registration<br/>index.ts"]
  Slash --> Prompt["buildTeamCommandPrompt"]
  Prompt --> Tool

  Tool --> Run["runTeam<br/>team.ts"]
  Run --> State[("team-run.json<br/>team-state.ts")]
  Run --> Tasks["dependency-free worker tasks<br/>createDefaultTeamTasks"]
  Run --> Backend{"backend selection<br/>auto | native | tmux"}

  Backend -->|native| Native["JSON subprocess backend<br/>subagent.ts"]
  Backend -->|tmux| Tmux["tmux panes<br/>tmux.ts"]
  Tmux --> Logs[("visible pane logs<br/>raw event logs")]

  Tasks --> Workers["pi worker agents"]
  Native --> Workers
  Tmux --> Workers
  Workers --> Guard["PI_TEAM_WORKER=1<br/>PI_SUBAGENT_MAX_DEPTH=1"]
  Guard --> Results["worker final reports<br/>artifacts / worktree refs"]

  Results --> State
  State --> Summary["synthesizeTeamRun<br/>finalSynthesis + verificationEvidence"]
  Summary --> Tool
  Tool --> User

  Tool --> Resume{"resume / command mode?"}
  Resume -->|yes| Commands["durable commands[]<br/>inbox/outbox audit messages"]
  Commands --> State
  Commands --> Workers
  Resume -->|no| Run
```

Key boundaries:

- `index.ts` exposes the root-only `team` tool and `/team` command; team workers suppress recursive orchestration.
- `team.ts` owns task creation, backend selection, worker dispatch, lifecycle transitions, synthesis, and tmux cleanup policy.
- `team-state.ts` persists durable run records, task events, audit messages, and follow-up command lifecycle.
- `subagent.ts` executes native worker processes; `tmux.ts` creates readable worker panes and logs for tmux-backed runs.
