## Context Brief: Workspace-Specific Auto Memory for Pi

### Goal
LLM이 대화 중 중요한 정보를 자동으로 감지하여 workspace-scoped 메모리로 저장하고, 이후 관련 대화 시 효율적으로 recall할 수 있는 메모리 시스템 구축

### Scope
- **In scope**:
  - `~/.pi/agent/memory/` 디렉토리에 workspace-scoped 메모리 저장 (cwd 인코딩 적용)
  - `memory` 도구 등록 (LLM이 자동/요청 시 저장)
  - `recall` 기능: 키워드 필터링 → LLM 선택 → 컨텍스트 주입
  - Token-efficient 인덱스 구조 (요약 + 태그만 인덱스, 본문 지연 로드)
  - Recall 횟수 기반 scoring + recency × score 기반 단순 퇴출
  - **상황별 템플릿**: Post-mortem / Decision Record / Compact Note
- **Out of scope**:
  - 임베딩 기반 벡터 검색 (키워드+LLM 선택으로 충분)
  - 메모리 자동 압축/요약 통합 (단순 퇴출 방식 채택)
  - UI/외부 시각화 도구
  - 메모리 공유 (cross-workspace)

### Technical Context
- Pi의 `ExtensionContext.cwd`로 현재 workspace 식별 가능
- `before_agent_start` 이벤트로 컨텍스트 주입 가능
- `sessionManager`의 cwd-to-path 인코딩 패턴 재사용 (`--Users-roach-lit-api--` 등)
- FFF의 `grep`/`multiGrep`으로 키워드 필터링 가능 (zero API cost)
- 기존 `approval-store.ts`의 workspace-scoped JSON 저장 패턴 참고
- LLM 선택은 `complete()` 호출로 후보군 중 관련 메모리 선택

### Constraints
- **Token budget**: 인덱스 파일은 항상 경량 유지, full content는 선택된 메모리만 로드
- **No embedding infra**: pi에 embedding 유틸리티 없음 — 키워드+LLM 방식 고수
- **Extension only**: core 수정 없이 `~/.pi/agent/extensions/`에 구현
- **자동 저장은 유도형**: LLM에게 memory 도구 사용을 시스템 프롬프트로 유도

### Success Criteria
1. 대화 중 버그 수정/중요 결정 후 LLM이 `memory` 도구로 저장
2. 이후 유사 주제 대화 시 `before_agent_start`에서 관련 메모리가 컨텍스트에 주입됨
3. 100개 이상 메모리에서도 인덱스 로드가 2-3KB 이하
4. 메모리 퇴출 시 recency × recall_score 하위 항목부터 제거 (최대 200개 유지)
5. `/memory` 명령으로 사용자가 직접 저장/조회/삭제 가능

### Memory Templates

| 키워드 트리거 | 템플릿 | 구조 |
|---|---|---|
| `bug`, `fix`, `solved`, `root cause`, `버그`, `장애` | **Post-mortem** | Problem / Root Cause / Fix / Prevention |
| `결정`, `중요`, `decision` | **Decision Record** | Context / Decision / Rationale / Alternatives Considered |
| 기타 (키워드 미해당) | **Compact Note** | Summary / Key Points |

### Memory Lifecycle

```
대화 중 키워드 감지 → LLM에게 저장 여부 판단 요청
                    → memory 도구 호출 → 템플릿 선택 → 저장
                    
before_agent_start: 인덱스 로드 → 키워드 필터링 → LLM 관련도 선택 → full content 주입

200개 초과 시: score(recall_count × recency) 기준 하위 제거
```

### Open Questions
없음 — 모두 해결 완료

### Complexity Assessment

| Signal | Score | Reasoning |
|--------|-------|-----------|
| Scope breadth | 2 | 저장 + 검색 + 퇴출 3개 기능 |
| File impact | 2 | 단일 extension 파일 + 메모리 저장소 |
| Interface boundaries | 2 | 기존 extension 이벤트 활용 |
| Dependency depth | 1 | 병렬 실행 불필요, 순차적 |
| Risk surface | 1 | 낶부 extension, 외부 시스템 의존 없음 |

**Score: 8**
**Verdict: Simple (5-8)**
**Rationale:** Extension 단일 파일 구현 + 기존 pi API 활용. 메모리 퇴출 로직이 유일한 상태 관리 지점.

### Suggested Next Step
**`agentic-plan-crafting`** — 단일 계획 주기로 구현 가능합니다. extension 파일 하나 + 메모리 스토리지 구조 설계로 충분합니다.
