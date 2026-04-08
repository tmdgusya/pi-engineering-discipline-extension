# Dependency Analysis: Autonomous Dev Engine

## Dependency DAG
```
M1 (no deps) ──┬──→ M2 ──┬──→ M4
                │         │
                └──→ M3 ──┘
                          │
                     (M4 is Entry Point)
```

## File Conflict Matrix
| File | Milestones | Ordering Constraint |
|------|-----------|---------------------|
| `types.ts` | M1 | No conflict — M1 creates, all others read |
| `github.ts` | M1 | No conflict — M1 creates, M2 reads |
| `orchestrator.ts` | M2, M5, M6 | M2 → M5 → M6 (sequential) |
| `index.ts` | M4 | M4 creates, no conflict |
| `agents/autonomous-dev-worker.md` | M3 | No conflict |
| `skills/autonomous-dev/SKILL.md` | M4 | No conflict |
| `package.json` | M1, M7 | M1 adds deps |

## Parallelizable Groups
- **Group A**: M1 (must run first)
- **Group B**: M2, M3 (both depend only on M1)
- **Group C**: M4 (depends on M1+M2+M3)

## External Dependencies
| Dependency | Setup Needed | Risk Level |
|------------|--------------|------------|
| gh CLI | Yes — install + auth | Medium |
| GitHub API token | Yes — with repo scope | Medium |
| @sinclair/typebox | Yes — npm install | Low |
| Vitest | Yes — npm install | Low |
| pi ExtensionAPI | No | Low |

## Critical Path
```
M1 → M2 → M4 (minimum viable: M1+M2+M3+M4)
```

**No circular dependencies** in the proposed decomposition.
