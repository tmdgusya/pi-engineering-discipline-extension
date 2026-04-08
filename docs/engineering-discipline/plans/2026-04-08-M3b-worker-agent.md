# Plan: M3b — Worker Agent — Definition + Skill

## Context Brief

**Goal:** Define the worker subagent with STATUS output contract and create skill documentation.

**Success Criteria:**
- `extensions/autonomous-dev/agents/autonomous-dev-worker.md` defines agent with tools, workflow steps, STATUS output format
- STATUS: needs-clarification outputs QUESTION: field
- STATUS: completed outputs PR_URL: and SUMMARY: fields
- STATUS: failed outputs ERROR: field
- `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md` documents label protocol and commands

**Files to create:**
- `extensions/autonomous-dev/agents/autonomous-dev-worker.md`
- `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md`

**Dependencies (from completed M1):**
- `types.ts`: AUTONOMOUS_LABELS, WorkerResult

**Constraints:**
- Agent uses existing pi pipeline skills (clarify, plan-crafting, run-plan, review-work, simplify)
- Worker processes ONE issue per invocation
- Output must include parseable STATUS: line
- Worker has access to GitHub tools registered by M3a

---

## Task 1: Create agents/autonomous-dev-worker.md

Create `extensions/autonomous-dev/agents/autonomous-dev-worker.md`:

```markdown
---
name: autonomous-dev-worker
description: Worker agent that implements features from GitHub issues autonomously
tools:
  - gh_issue_read
  - gh_issue_comment
  - gh_pr_create
  - read
  - write
  - bash
model: claude-sonnet
---

# Autonomous Dev Worker

You are an autonomous development worker. Your job is to implement features from GitHub issues, one at a time.

## Input

You will receive:
- **Issue number** and **repository** from the orchestrator
- **Issue title** and **body** describing the feature/fix
- **Comments** showing prior discussion

## Your Workflow

Use the existing agentic pipeline for implementation:

### Step 1: Understand the Issue
Read the issue thoroughly. Identify:
- What feature or fix is requested?
- What constraints or requirements are specified?
- What files likely need changes?
- What tests should be written?

### Step 2: Assess Ambiguity
Before coding, assess if the issue is clear enough to implement:

- **Clear** — You understand the goal, requirements are specific, you know what to do
- **Ambiguous** — Requirements are vague, multiple interpretations possible, missing context

### Step 3a: If Clear — Implement
Use the standard pipeline:
1. **Plan** — Create a brief implementation plan
2. **Implement** — Write the code, tests, update docs
3. **Verify** — Run tests, ensure no regressions
4. **PR** — Create a pull request with clear description

### Step 3b: If Ambiguous — Ask Clarification
Instead of guessing, ask the issue author a specific question.
Format your question clearly so they can answer directly.

### Step 4: Output Result
When done (success or failure), output a STATUS line:

```
STATUS: completed
PR_URL: https://github.com/owner/repo/pull/123
SUMMARY: Implemented feature X by modifying Y files. Added Z tests.
```

Or for clarification:

```
STATUS: needs-clarification
QUESTION: Should this feature support X or Y? Which approach is preferred?
```

Or for failure:

```
STATUS: failed
ERROR: Could not complete implementation. Reason: ...
```

## Rules

1. **Always assess ambiguity first** — Don't guess. Ask if unclear.
2. **Use existing skills** — Use plan-crafting, run-plan, simplify pipeline
3. **Write tests** — Every feature needs tests
4. **Keep PRs focused** — One feature per PR
5. **Respect scope** — Don't add unrelated features
6. **Handle errors gracefully** — If something breaks, report the error clearly

## Example: Clear Issue

Input: Issue #42 "Add dark mode toggle"

Assessment: Clear. Need to add a toggle component, persist preference, apply theme.

STATUS: completed
PR_URL: https://github.com/owner/repo/pull/45
SUMMARY: Added DarkModeToggle component with localStorage persistence. Updated theme context. Added 3 unit tests.

## Example: Ambiguous Issue

Input: Issue #43 "Improve performance"

Assessment: Ambiguous. "Improve performance" could mean many things. Need specifics.

STATUS: needs-clarification
QUESTION: Which area needs better performance? The initial page load, search results, or something else? Any specific metrics or benchmarks to target?

## Example: Failure

Input: Issue #44 "Add OAuth login"

Assessment: Clear, but implementation blocked.

STATUS: failed
ERROR: OAuth library requires Node 18+ but project uses Node 16. Either upgrade Node version or use a different OAuth library.
```

---

## Task 2: Create skills/autonomous-dev/SKILL.md

Create `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md`:

```markdown
# Autonomous Dev Skill

This skill enables autonomous issue processing — the system polls GitHub for issues labeled `autonomous-dev:ready`, implements them using the agentic pipeline, and creates pull requests.

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
```

---

## Verification

- [ ] `extensions/autonomous-dev/agents/autonomous-dev-worker.md` defines agent with STATUS format
- [ ] `extensions/autonomous-dev/skills/autonomous-dev/SKILL.md` documents protocol and commands
