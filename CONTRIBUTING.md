# Contributing

Thank you for your interest in contributing to ROACH PI! This document outlines the process.

## Design Philosophy

**Simple is better than clever.**

This project values simplicity over complexity:
- Prefer straightforward solutions over elaborate orchestration
- Fewer moving parts, fewer failure modes
- If a feature requires complex multi-step orchestration to explain, it probably needs to be simplified
- Don't build extensibility for hypothetical future use cases — solve the problem at hand

We'd rather have a well-done simple tool than a half-working complex system.

## 🚨 Before Adding a Feature — Start a Discussion

**All feature proposals must be discussed on GitHub Discussions before implementation.**

1. Open a new discussion in the [Ideas](https://github.com/tmdgusya/roach-pi/discussions/new?category=Ideas) category
2. Describe the feature, its motivation, and expected behavior
3. Wait for feedback before writing any code

This prevents wasted effort on features that may conflict with the existing architecture, duplicate planned work, or fall outside the project's scope.

Pull requests that add features without a prior discussion will not be reviewed.

## Bug Reports

Bug reports can be filed directly as [GitHub Issues](https://github.com/tmdgusya/roach-pi/issues/new). Please include:

- **Reproduction steps** — what you did, what you expected, what happened
- **Environment** — pi version, Node.js version, OS
- **Logs or screenshots** — if applicable

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/tmdgusya/roach-pi.git
   ```
2. Install dependencies:
   ```bash
   cd extensions/agentic-harness
   npm install
   ```
3. Type `/reload` in the `pi` terminal to apply changes.

## Testing

```bash
cd extensions/agentic-harness
npm test
npm run build
```

All changes must pass existing tests and TypeScript build verification. New features should include new tests.

### Team-mode release checklist

For changes to the lightweight native `team` tool, also verify before merge:

- `extensions/agentic-harness/README.md` has exactly one `## Lightweight Native Team Mode` section and lists only shipped behavior as shipped.
- Deferred parity remains explicit for persistent resume, recorded inbox/outbox, heartbeat/status monitoring, staged pipelines, tmux runtime/live visualization, and default worktree-per-worker isolation unless those features are implemented and tested.
- `docs/engineering-discipline/reviews/2026-04-27-roach-pi-team-mode-verification.md` contains current command evidence.
- Lint status is documented; `extensions/agentic-harness` currently has no `lint` script.
- The PR uses conventional commits that match the change type, such as `feat(agentic-harness):`, `test(agentic-harness):`, `docs(agentic-harness):`, or `ci:`.

## Code Style

- Follow the patterns established in the existing codebase
- Keep changes minimal and surgical — see the Karpathy Rules built into this extension
- No premature abstraction or future-proofing
- Match existing naming conventions

## Pull Request Process

1. Ensure there is a corresponding approved discussion for feature work
2. Create a feature branch from `main`
3. Write tests for new functionality
4. Ensure all tests pass
5. Keep the PR focused — one concern per PR
