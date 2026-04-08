# Autonomous Dev Engine

## Idea Core

기존 agentic-harness 파이프라인(clarify → plan → run → review → simplify)을 그대로 "타이어"로 사용하고, 그 위에 GitHub issue를 입력으로 넣고 PR을 출력으로 내보는 "엔진" 레이어를 구성한다. 로컬 pi 세션 안에서 session-loop를 통해 issue를 폴링하며, label 기반 분산 락으로 다중 세션 환경에서도 중복 처리를 방지한다.

## Architecture Sketch

```
┌─────────────────────────────────────────────────────────┐
│                    Autonomous Dev Engine                  │
│                                                          │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Issue     │───▶│ Ambiguity    │───▶│ Pipeline      │  │
│  │ Ingestion │    │ Assessment   │    │ Orchestrator  │  │
│  └──────────┘    └──────────────┘    └───────────────┘  │
│       ▲               │ (critical)          │            │
│       │               ▼                    ▼            │
│       │         ┌──────────┐         ┌──────────┐      │
│       │         │ Ask on   │         │ PR       │      │
│       │         │ Issue    │         │ Creator  │      │
│       │         └──────────┘         └──────────┘      │
│       │               │                    │            │
│       │               ▼                    ▼            │
│  ┌──────────────────────────────────────────────────┐  │
│  │              GitHub API Layer (gh CLI)            │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ▲                                    │
         │         session-loop polling        │
         └────────────────────────────────────┘
```

## Relationship Map

- **GitHub Issue (labeled: ready)** → triggers → **Issue Ingestion** (parse title, body, labels, comments)
- **Issue Ingestion** → feeds into → **Ambiguity Assessment** (agentic-clarification internally)
- **Minor Ambiguity** → proceeds to → **Pipeline Orchestrator** (assumptions noted in PR)
- **Critical Ambiguity** → triggers → **Ask on Issue** (comment with @mention, set label `needs-clarification`, halt)
- **Pipeline Orchestrator** → runs → **clarify → plan → run → review → simplify** (existing skills)
- **Review PASS** → triggers → **PR Creator** (commit, push, gh pr create with issue reference)
- **Review FAIL** → loops back to → **Pipeline Orchestrator** (with review feedback)

## Label Protocol (Distributed Lock)

| Label | Meaning | Who Sets |
|-------|---------|----------|
| `autonomous-dev:ready` | Issue is eligible for autonomous processing | Human |
| `autonomous-dev:in-progress` | Currently being processed (lock) | Engine |
| `autonomous-dev:needs-clarification` | Blocked waiting for human response | Engine |
| `autonomous-dev:review-requested` | PR created, awaiting human review | Engine |
| `autonomous-dev:completed` | Successfully merged/closed | Engine or human |

Multiple pi sessions can safely coexist — a session only picks issues that are `ready` and atomically sets `in-progress`.

## Key Insights

1. **기존 파이프라인이 80%를 차지**: clarify/plan/run/review/simplify는 이미 완성. autonomous dev는 GitHub 연동 + 오케스트레이션 레이어만 만들면 됨
2. **gh CLI가 가장 가벼운 통합 방식**: octokit이나 GitHub App을 만들 필요 없이 `gh` CLI로 issue read, comment, label, PR 생성 모두 가능. 이미 pi 환경에 gh가 있음
3. **모호함의 임계치가 설계의 핵심**: "언제 물어보고 언데 추론하는가"를 어떻게 판단할지 — agentic-clarification의 Context Brief에 confidence level을 추가하는 방식으로 해결 가능
4. **session-loop가 이미 폴링 인프라**: `/loop`가 interval-based job scheduling을 제공. autonomous dev의 issue polling을 loop job으로 등록하면 됨
5. **점진적 확장 가능**: MVP는 단일 issue 순차 처리 → 나중에 병렬 처리, 이슈 큐 우선순위, multi-repo 지원 등 추가

## MVP Scope (What to Build First)

### Phase 1: GitHub Integration Micro-Skills
- `gh-issue-read`: Read issue + all comments → structured context
- `gh-issue-comment`: Post comment with @mention
- `gh-label-manage`: Atomic label swap (ready → in-progress)
- `gh-pr-create`: Create PR with issue reference

### Phase 2: Autonomous Dev Orchestrator Skill
- `autonomous-dev` skill that ties everything together:
  1. Poll for `autonomous-dev:ready` issues
  2. Lock with `in-progress` label
  3. Run ambiguity assessment (agentic-clarification)
  4. If critical ambiguity → comment, set `needs-clarification`, release lock
  5. If clear → run full pipeline (plan → run → review)
  6. On review PASS → create PR, set `review-requested`
  7. On review FAIL → fix loop (max N retries)

### Phase 3: Loop Integration
- Register autonomous-dev as a session-loop job
- `/autonomous-dev start` → starts polling
- `/autonomous-dev status` → shows current issue queue

## Clarification Loop Design (Answer-Wait-Resume)

### Core Mechanism
- 모든 상태는 **GitHub issue 자체**에 존재 (로컬 상태 파일 불필요)
- session-loop가 주기적으로 `needs-clarification` label issue를 폴링
- 엔진이 단 마지막 댓글(bot comment) 이후 새 댓글이 달렸는지 체크
- 새 댓글 감지되면 label을 `in-progress`로 복구, 파이프라인 재개

### Retry Logic
- 모호함이 해소되지 않으면 다시 질문 (최대 N번, config 가능)
- N번 초과 시 → `autonomous-dev:failed` label, 마지막 댓글에 "최대 질문 횟수 초과" 안내

### Flow Diagram

```
┌─ issue:ready ──▶ clarify ──▶ ambiguous? ──NO──▶ plan → run → review → PR
│                              │
│                             YES
│                              │
│                    comment + label:needs-clarification
│                              │
│                    ◀─ polling loop ──┐
│                              │       │
│                    new comment?      │
│                     │         │      │
│                    YES        NO ────┘
│                     │
│                    re-clarify
│                     │
│              still ambiguous? ──YES──▶ 다시 질문 (retry_count++)
│                     │                    max_retries 초과 → label:failed
│                    NO
│                     │
│                     └──────▶ plan → run → review → PR
```

### Why This Works
- **어떤 세션에서든 이어서 처리 가능**: 상태가 GitHub에 살아있으므로 pi 재시작, 다른 컴퓨터 모두 OK
- **구현이 단순**: 상태 파일 없음, 타임스탬프 저장 없음, 그냥 "엔진 마지막 댓글 이후 새 댓글 있나?" 만 체크
- **다중 세션 안전**: label이 락 역할, atomic swap으로 중복 방지

## Open Questions

- [ ] Confidence threshold: agentic-clarification의 어떤 신호로 "critical ambiguity"를 판단할 것인가?
- [ ] PR merge 전략: 자동 merge vs human merge approval?
- [ ] 에러 복구: pi 세션이 중간에 죽으면 `in-progress` label이 남는데, 타임아웃 후 자동 해제?
- [ ] 비용: LLM 호출 비용을 어디까지 허용할 것인가 (issue당 예산 설정?)
- [ ] retry_count를 어디에 저장할 것인가? — issue body에 hidden comment로? label description? (상태 없이도 "엔진 댓글 개수"로 추론 가능)

## Next Steps

- [ ] GitHub 연동 마이크로 스킬 4개 프로토타입
- [ ] autonomous-dev orchestrator skill SKILL.md 작성
- [ ] agentic-clarification에 confidence level 출력 추가
- [ ] label 기반 락 메커니즘 설계 및 구현
- [ ] session-loop와 통합

---
*Brainstormed on 2026-04-08*
