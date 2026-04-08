# Risk Analysis: Autonomous Dev Engine

## Identified Risks

| Risk | Severity | Milestones | Mitigation |
|------|----------|------------|------------|
| GitHub API Rate Limiting & gh CLI Availability | High | M1, M2 | Implement exponential backoff with jitter, cache responses |
| Label Locking Race Conditions | Critical | M2 | Use atomic label operations with optimistic locking |
| Worker Agent Integration with Existing pi Pipeline | High | M3 | Copy existing subagent spawning pattern; add dry-run mode |
| Ambiguity Assessment Heuristics Are Undefined | High | M6 | Treat as exploratory spike with explicit acceptance criteria |
| Regression on Existing pi Session State | Medium-High | M2, M4 | Use separate namespace, graceful cleanup on shutdown |
| CI/CD Auto-Merge Depends on External Systems | Medium | M7 | Implement as separate adapter with mock mode |
| Recovery Cost for In-Flight Issue Processing | Medium | M2, M5 | Idempotent operations, appendEntry() for state |
| Multi-Repo Configuration Complexity | Medium | M5 | Define RepoConfig schema early |

## Overall Risk-Ordered Milestone Sequence
1. M1: Types + GitHub Client — highest dependency impact
2. M2: Orchestrator with Polling — highest race condition risk
3. M3: Worker Agent Definition — integration risk with pi pipeline
4. M4: /autonomous-dev Commands — low risk, thin wrappers
5. M5: Parallel Issue Processing — concurrency complexity
6. M6: Confidence Threshold Tuning — exploratory spike
7. M7: CI/CD Deployment — external system dependency

## Risk-to-Milestone Matrix
| Risk | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| gh CLI Reliability | ● | ● |   |   | ● |   |   |
| Label Locking Races |   | ● |   |   | ● |   |   |
| Worker Integration |   |   | ● | ● |   |   |   |
| Ambiguity Heuristics |   |   |   |   |   | ● |   |
| Session Regression |   | ● |   | ● |   |   |   |
| CI/CD External Deps |   |   |   |   |   |   | ● |
