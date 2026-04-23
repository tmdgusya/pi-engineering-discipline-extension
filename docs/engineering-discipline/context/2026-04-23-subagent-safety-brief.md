## Context Brief: Agentic Harness Subagent Safety Hardening

### Goal
`agentic-harness`의 subagent tool 경로에서 spawn gate(동시 실행 상한, fail-fast)와 abort 전파 + cleanup 보장을 강화해, 과도한 subagent 실행/누수 위험을 줄인다.

### Scope
- **In scope**
  - `extensions/agentic-harness/index.ts`에서 subagent 실행 4개 경로(single/parallel/chain/slop-cleaner) 모두에 gate 적용
  - 슬롯 포화 시 즉시 실패(fail-fast) 처리
  - 상한값은 `MAX_CONCURRENCY=10` 재사용
  - 부모 abort 시 queued 실행 방지 + 실행 중 작업 정리(cleanup) 보장
  - 관련 테스트 추가
- **Out of scope**
  - `extensions/agentic-harness/subagent.ts` 전역 런타임 변경
  - `extensions/autonomous-dev` 경로 변경
  - 새로운 env/CLI 설정 추가

### Technical Context
- `runAgent` 자체에는 abort/종료/cleanup 로직이 이미 존재한다.
- 하지만 `subagent` tool 계층(`index.ts`)에는 호출 전체를 아우르는 in-flight gate가 없다.
- 최소 변경 지점은 `extensions/agentic-harness/index.ts`의 `runAgent` 호출 4곳을 공통 래퍼로 감싸는 방식이다.
- 테스트는 tool-layer 동작(fail-fast, abort 시 queued 차단, cleanup 후 재호출 가능)을 검증해야 한다.

### Constraints
- 변경 범위는 `agentic-harness/index.ts` 경로 중심으로 제한한다.
- 기존 상수(`MAX_CONCURRENCY`)를 재사용한다.
- 포화 상태 응답은 명확한 에러(`isError: true`)로 반환한다.

### Success Criteria
- 동시 실행이 10을 초과하려는 시도는 즉시 실패한다.
- single/parallel/chain/slop-cleaner 경로 모두 동일한 gate 정책을 따른다.
- 부모 abort 발생 시 대기 중 실행이 시작되지 않고, 실행 중 하위 실행은 정리된다.
- 테스트에서 위 동작이 재현 가능하게 검증된다.

### Open Questions
- 없음

### Complexity Assessment

| Signal | Score |
|---|---|
| Scope breadth | 2 |
| File impact | 2 |
| Interface boundaries | 1 |
| Dependency depth | 1 |
| Risk surface | 2 |

**Score:** 8  
**Verdict:** Borderline (8-9)  
**Rationale:** 변경 파일 수는 작지만 동시성/abort/cleanup 경계 조건 검증이 필요해 중간 난이도다.

### Suggested Next Step
Proceed to `agentic-plan-crafting` — task fits in a single plan cycle with explicit concurrency/abort test coverage.
