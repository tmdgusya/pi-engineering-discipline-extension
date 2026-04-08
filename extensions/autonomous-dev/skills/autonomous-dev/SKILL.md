# Autonomous Dev Skill

This skill enables autonomous issue processing — the system polls GitHub for issues labeled `autonomous-dev:ready`, implements them using the agentic pipeline, and creates pull requests.

## Experimental Feature Flag

This extension requires the `PI_AUTONOMOUS_DEV` environment variable to be set:

```bash
export PI_AUTONOMOUS_DEV=1
```

Without this flag, the extension will not register any tools or commands.

## Label Protocol

Issues go through a lifecycle managed by labels:

| Label | Meaning | Who Sets |
|-------|---------|----------|
| `autonomous-dev:ready` | Issue queued for autonomous processing | Human |
| `autonomous-dev:in-progress` | Currently being implemented | Orchestrator |
| `autonomous-dev:needs-clarification` | Worker needs more info from author | Worker |
| `autonomous-dev:completed` | Successfully implemented, PR created | Orchestrator |
| `autonomous-dev:failed` | Could not complete (max rounds or error) | Orchestrator |

## Lifecycle

```
Human adds autonomous-dev:ready label
          ↓
Orchestrator picks up issue, swaps to autonomous-dev:in-progress
          ↓
Worker assesses issue...
          ├→ Clear → Implement → PR → autonomous-dev:completed
          ├→ Ambiguous → Asks question → autonomous-dev:needs-clarification
          │                              ↓
          │                    Author responds in comments
          │                              ↓
          │                    Orchestrator resumes, swaps back to in-progress
          │                              ↓
          └→ Blocked → autonomous-dev:failed (after max rounds)
```

## Commands

| Command | Description |
|---------|-------------|
| `/autonomous-dev start` | Start the polling orchestrator |
| `/autonomous-dev stop` | Stop the orchestrator |
| `/autonomous-dev status` | Show current status, tracked issues, stats |
| `/autonomous-dev poll` | Manually trigger one poll cycle |

## Configuration

Configure via `pi` config:

```json
{
  "autonomous-dev": {
    "repo": "owner/repo",
    "pollIntervalMs": 60000,
    "maxClarificationRounds": 3
  }
}
```

## Prerequisites

1. `gh` CLI must be installed and authenticated
2. `GITHUB_TOKEN` environment variable set (or `gh auth` completed)
3. Labels must exist in the repository (created by first run or manually)

## Creating Labels

Run once to create labels:

```bash
gh label create autonomous-dev:ready --color "00FF00" --description "Ready for autonomous implementation"
gh label create autonomous-dev:in-progress --color "0000FF" --description "Currently being implemented"
gh label create autonomous-dev:needs-clarification --color "FFA500" --description "Waiting for author response"
gh label create autonomous-dev:completed --color "008000" --description "Successfully implemented"
gh label create autonomous-dev:failed --color "FF0000" --description "Could not complete"
```

## Example Usage

1. Label an issue: `gh issue edit 42 --add-label autonomous-dev:ready`
2. Start autonomous dev: `/autonomous-dev start`
3. Watch progress: `/autonomous-dev status`
4. Check the PR when done: Label changes to `autonomous-dev:completed`

## Troubleshooting

**Issue not picked up?**
- Check it's labeled `autonomous-dev:ready` (not `in-progress` or `needs-clarification`)
- Check repo is correct in config
- Check `gh auth status`

**Issue stuck in clarification?**
- Check if author has responded in comments
- Run `/autonomous-dev poll` to check immediately
- If max rounds reached, label changes to `failed`

**Worker returned failed?**
- Check the error message in comments
- Common causes: missing dependencies, version conflicts, ambiguous requirements
- Fix the issue and re-label with `autonomous-dev:ready`
