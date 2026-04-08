# Feasibility Analysis: Autonomous Dev Engine

## Component-by-Component Analysis

### 1. GitHub Client (`github.ts`)
| Aspect | Assessment |
|--------|------------|
| **Feasibility** | ✅ HIGH — Standard gh CLI operations, no external libraries |
| **Effort** | Small (types.ts + github.ts + tests ≈ 150 lines) |
| **Hidden complexity** | Shell escaping in multi-word arguments, temp file handling for body content |

### 2. Orchestrator (`orchestrator.ts`)
| Aspect | Assessment |
|--------|------------|
| **Feasibility** | ⚠️ MEDIUM — Logic is sound, but distributed coordination has edge cases |
| **Effort** | Medium (~250 lines + tests) |
| **Hidden complexity** | Label race conditions, clarification detection edge cases, timer management |

### 3. Extension Entry (`index.ts`)
| Aspect | Assessment |
|--------|------------|
| **Feasibility** | ✅ HIGH — Directly follows existing extension patterns |
| **Effort** | Medium (~300 lines) |
| **Hidden complexity** | Subagent spawning from extension context, worker output parsing |

### 4. Worker Agent (`autonomous-dev-worker.md`)
| Aspect | Assessment |
|--------|------------|
| **Feasibility** | ✅ HIGH — Standard agent pattern with clear output protocol |
| **Effort** | Small (agent definition + skill doc) |
| **Hidden complexity** | Confidence threshold for "clarification needed" is subjective |

## Risk Surface Analysis
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Label race condition | Medium | Medium | Sequential processing in MVP reduces this |
| Worker output doesn't match STATUS regex | Medium | High | The plan's parsing is simple; consider more robust parsing |
| gh CLI not installed/authenticated | High (first-time) | High | Add startup validation |
| Session crash during processing | Low | High | Consider state persistence |

## Suggested Milestones
| Milestone | Effort | Risk | Notes |
|-----------|--------|------|-------|
| 1: GitHub Client | Small | Low | Pure infrastructure |
| 2: Orchestrator | Medium | Medium | Clarification state machine is the hard part |
| 3: Extension + Agent | Medium | Medium | Subagent integration needs verification |
| 4: Verification | Small | Low | Testing and docs |

**Overall feasibility: HIGH**
