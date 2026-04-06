# Session Loop Extension

Session-scoped recurring jobs for pi coding agent.

## Commands

| Command | Description |
|---------|-------------|
| `/loop <interval> <prompt>` | Schedule a recurring prompt |
| `/loop-stop [job-id]` | Stop a job (interactive select if no ID) |
| `/loop-list` | List all active jobs with stats |
| `/loop-stop-all` | Stop all jobs (with confirmation) |

## Interval Format

| Format | Example | Duration |
|--------|---------|----------|
| `Ns` | `5s` | 5 seconds |
| `Nm` | `10m` | 10 minutes |
| `Nh` | `2h` | 2 hours |
| `Nd` | `1d` | 1 day |

Minimum: 1 second. Maximum: 365 days.

## Examples

```bash
# Check git status every 5 minutes
/loop 5m check git status and report changes

# Run a health check every 30 seconds
/loop 30s verify the dev server is running on port 3000

# List active jobs
/loop-list

# Stop a specific job
/loop-stop loop-1-abc123

# Stop all jobs
/loop-stop-all
```

## Architecture

- **Session-scoped**: All jobs are cleaned up on session end. No persistence.
- **Concurrent**: Up to 100 simultaneous jobs.
- **Error-isolated**: One failing job does not affect others.
- **Timeout-protected**: Jobs timeout at `max(interval × 2, 60s)`.
- **Cooperative cancellation**: Uses `AbortController` per job.

## Development

```bash
cd extensions/session-loop
npm install
npm test        # Run unit tests
npm run build   # Type-check only (no emit)
```
