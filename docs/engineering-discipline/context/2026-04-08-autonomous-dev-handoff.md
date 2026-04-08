# Autonomous Dev — Handoff Document

## 현재 상태

**브랜치:** `feat/autonomous-dev`
**작업:** Autonomous Dev Engine 구현
**상태:** Plan 작성 완료, 구현 전

---

## 완료된 것

### 1. Brainstorm (`docs/engineering-discipline/brainstorms/autonomous-dev.md`)
- 핵심 아이디어, 아키텍처 스케치, label 프로토콜 정의
- Clarification loop 설계 (타임스탬프 기반, 상태를 GitHub issue에만 저장)
- Open questions 기록

### 2. Implementation Plan (`docs/engineering-discipline/plans/2026-04-08-autonomous-dev.md`)
- 4개 태스크, 전체 코드 포함 (types, github client, orchestrator, extension entry, agent, skill)
- 각 태스크에 테스트 코드 포함

### 3. Git commits (3개)
```
221a36b brainstorm: autonomous dev engine design
5f70636 plan: autonomous dev engine implementation
```

---

## 설계 결정 사항

| 항목 | 결정 |
|------|------|
| 실행 환경 | 로컬 pi 세션 내 |
| GitHub 연동 | `gh` CLI (별도 라이브러리 없음) |
| 상태 저장 | GitHub issue 자체 (로컬 상태 파일 없음) |
| 모호함 대처 | 임계치 기반 — 사소하면 추론, 핵심 불명확하면 질문 후 대기 |
| 답변 대기 | 폴링으로 `needs-clarification` issue 체크, 엔진 댓글 이후 새 댓글 유무로 판단 |
| 재시도 | 모호하면 계속 질문 (최대 N번, config 가능, 초과 시 failed) |
| MVP 범위 | 단일 issue 순차 처리 |
| 중복 방지 | Label 기반 분산 락 (ready → in-progress atomic swap) |

---

## 다음 단계

### 즉시: Plan 실행

```
# pi 세션에서
/plan docs/engineering-discipline/plans/2026-04-08-autonomous-dev.md
```

또는 agentic-run-plan 스킬로 태스크별 실행:

| Task | 내용 | Files |
|------|------|-------|
| Task 1 | Types + GitHub Client | `types.ts`, `github.ts`, `tests/github.test.ts` |
| Task 2 | Orchestrator | `orchestrator.ts`, `tests/orchestrator.test.ts` |
| Task 3 | Extension Entry + Agent + Skill | `index.ts`, `agents/autonomous-dev-worker.md`, `skills/autonomous-dev/SKILL.md` |
| Task 4 | Final Verification | 전체 테스트 실행 |

### 이후: MVP 이후 확장 후보

- [ ] 병렬 issue 처리 (subagent 활용)
- [ ] 이슈 큐 우선순위 정렬
- [ ] Multi-repo 지원
- [ ] Confidence threshold 튜닝 (agentic-clarification에 level 추가)
- [ ] PR auto-merge 옵션
- [ ] `in-progress` label 타임아웃 (세션 죽었을 때 자동 해제)
- [ ] issue당 LLM 호출 비용 예산

---

## 플랜에 적힌 파일 구조

```
extensions/autonomous-dev/
├── index.ts                       # Extension entry: tools + commands
├── github.ts                      # gh CLI wrappers
├── orchestrator.ts                # Polling scheduler + worker spawning
├── types.ts                       # Shared types
├── agents/
│   └── autonomous-dev-worker.md   # Worker agent definition
├── skills/
│   └── autonomous-dev/
│       └── SKILL.md               # Skill definition
└── tests/
    ├── github.test.ts
    └── orchestrator.test.ts
```

---

## 주의사항

- `index.ts`에서 `../agentic-harness/agents.js`와 `../agentic-harness/subagent.js`를 import → 빌드 시 경로 확인 필요
- `github.ts`의 `execGhJson`은 `--json` 플래그로 `gh` CLI JSON 출력을 파싱 → `gh` 버전에 따라 동작 다를 수 있음
- Worker agent의 STATUS 마커 파싱(`STATUS: completed` 등)은 LLM 출력 기반 → 프롬프트로 강력히 유도하지만 100% 보장은 아님 → TODO: 나중에 structured output으로 개선

---

*Handoff created: 2026-04-08*
