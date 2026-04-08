## Context Brief: 중첩 Subagent 실시간 가시성 개선

### Goal
Subagent가 다른 subagent를 호출할 때(depth 2+), 실행 중인 중첩 subagent의 존재와 상태를 TUI에서 트리 구조로 실시간 표시

### Scope
- **In scope**:
  - `runner-events.ts`: assistant message에서 `toolCall` 파트(`name === "subagent"`) 감지 로직 추가
  - `types.ts`: `SubagentDetails`에 중첩 subagent 트리 정보 필드 추가
  - `render.ts`: `renderCall()`에서 중첩 subagent 트리 시각화 (들여쓰기 + 상태 아이콘)
  - `subagent.ts`: `onUpdate`를 통해 중첩 subagent 정보 전파
- **Out scope**:
  - 결과 표시 개선 (renderResult)
  - 파일 기반 로깅
  - pi 코어(`--mode json`) 수정
  - depth 3+ 테스트 (depth 2 위주)

### Technical Context
- **현재 한계**: pi의 `--mode json`은 `message_end`, `turn_end`, `agent_end`만 emit. `tool_call_start` 이벤트 없음
- **해결 경로**: `message_end`/`turn_end` 이벤트의 assistant message content에서 `{ type: "toolCall", name: "subagent", arguments: {...} }` 파트를 파싱하여 중첩 호출 감지
- **지연**: 모델이 메시지 생성을 마친 후에만 감지 가능 (수 초 지연). 실시간은 아니지만 현재보다 크게 개선
- **확장 포인트**: `SingleResult`에 `nestedCalls?: NestedCall[]` 필드 추가, `processPiJsonLine`에서 toolCall 파싱, `onUpdate`로 전파

### Constraints
- pi 코어 수정 불가 — `--mode json`의 이벤트 타입 추가 안 함
- `onUpdate` 콜백 시그니처 하위 호환 유지 필요
- 기존 179개 테스트 회귀 없어야 함

### Success Criteria
- depth 1 subagent가 depth 2 subagent를 호출할 때, TUI에서 트리 구조로 표시됨
- 실행 중(⏳), 완료(✓), 에러(✗) 상태 아이콘 표시
- 기존 단일 레벨 subagent 표시는 변경 없이 동작

### Open Questions
- (없음 — 범위가 명확함)

### Complexity Assessment

| Signal | Score | 근거 |
|--------|-------|------|
| Scope breadth | 2 (Medium) | runner-events, types, render, subagent 4개 파일 |
| File impact | 2 (Medium) | 4-5개 파일 수정 |
| Interface boundaries | 2 (Medium) | `SubagentDetails`, `onUpdate` 인터페이스 확장 |
| Dependency depth | 1 (Low) | 선형 수정 체인 |
| Risk surface | 2 (Medium) | 기존 테스트 회귀 리스크 |

**Score:** 9
**Verdict:** Complex (borderline)
**Rationale:** 4개 파일 수정, 인터페이스 확장, assistant message content 파싱이라는 새 로직 추가. 하지만 선형 의존성이라 단일 계획으로 처리 가능.

### Suggested Next Step
`agentic-plan-crafting` — 단일 계획으로 충분함. 마일스톤 분해는 오버엔지니어링.
