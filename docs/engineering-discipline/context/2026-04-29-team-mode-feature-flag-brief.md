# Context Brief: Gate team mode behind PI_ENABLE_TEAM_MODE env flag

## Goal
`/team` 슬래시 명령이 `PI_ENABLE_TEAM_MODE=1` 환경변수가 설정된 경우에만 동작하도록 게이트한다 (기본값 OFF).

## Scope

**In scope**
- `extensions/agentic-harness/index.ts` — `pi.registerCommand("team", ...)` handler 진입부에 env var 가드 추가
- env var 상수 정의 (`PI_ENABLE_TEAM_MODE_ENV = "PI_ENABLE_TEAM_MODE"`) — `team-state.ts` 의 기존 `PI_TEAM_WORKER_ENV`, `PI_TEAM_RUN_STATE_ROOT_ENV` 옆에 추가
- env var 미설정 시 안내 메시지 출력 (`team mode is disabled. Set PI_ENABLE_TEAM_MODE=1 to enable.`)
- 영향받는 테스트 보정 (필요 시 setup 에서 env 설정)
- `extensions/agentic-harness/README.md` 업데이트 — "Lightweight Native Team Mode" 섹션 (L59~) 에 다음 내용 반영:
  - 기본값이 OFF 라는 점 명시 (가장 위에)
  - 활성화 방법 (`PI_ENABLE_TEAM_MODE=1`)
  - 미설정 시 동작 (안내 메시지 후 종료)
  - 기존 `PI_TEAM_WORKER` 환경변수 설명 근처에 일관되게 배치

**Out of scope**
- 명령 등록 자체를 조건부로 만드는 것 — handler 진입부에서만 가드
- description 에 `[experimental]` 같은 마커 추가
- tmux/state 모듈 내부 코드 게이팅 (entry point 가 차단되므로 불필요)
- 새로운 일반화된 feature-flag 시스템 도입
- 환경변수 이외의 토글 메커니즘 (config 파일, settings.json 등)
- 루트 `README.md` 수정 (현재 team 언급 없음 — 사용자가 추가 요청하면 포함)

## Technical Context

- **현재 상태**: `extensions/agentic-harness/index.ts:1504` 에서 `pi.registerCommand("team", { handler: ... })` 가 무조건 등록됨. 사용자는 env var 없이도 `/team goal=... worker-count=N backend=tmux` 호출 가능.
- **기존 패턴**: 통합 feature-flag 시스템 없음. `process.env[X] === "1"` 개별 검사.
  - `extensions/agentic-harness/subagent.ts:25-37` — `PI_SUBAGENT_DEPTH`, `PI_SUBAGENT_MAX_DEPTH`, `PI_SUBAGENT_PREVENT_CYCLES`, `PI_SUBAGENT_FORK_SESSION` 등
  - `extensions/agentic-harness/index.ts:83` — `const isTeamWorker = process.env[PI_TEAM_WORKER_ENV] === "1"`
  - `team-state.ts` 에 `PI_TEAM_WORKER_ENV`, `PI_TEAM_RUN_STATE_ROOT_ENV` 상수 이미 존재 — 새 상수의 자연스러운 위치
- **README 구조**: `extensions/agentic-harness/README.md:59` 에 "Lightweight Native Team Mode" 섹션이 있고, L112 부근에서 `PI_TEAM_WORKER=1` 환경변수를 이미 설명 중. 같은 톤으로 `PI_ENABLE_TEAM_MODE` 추가하면 자연스러움.
- **워커 전파**: 워커는 `/team` handler 를 통해서만 스폰되므로 handler 가드로 자동 차단됨. 별도 전파 처리 불필요.
- **테스트**: `extensions/agentic-harness/tests/team*.test.ts` 5개 파일 (`team.test.ts`, `team-command.test.ts`, `team-state.test.ts`, `team-tool.test.ts`, `team-e2e-tmux.test.ts`). 대부분 내부 함수 직접 호출 추정. 영향 범위는 plan 단계에서 식별.

## Constraints
- env var 이름 `PI_` 접두사 (레포 컨벤션)
- truthy 검사 `=== "1"` (다른 truthy 문자열 금지 — 컨벤션 일관성)
- 메시지 영어 (CLI 출력 톤 일치)
- handler 외부 코드 변경 최소화 (description, 자동완성, 등록 로직 그대로)
- README 업데이트는 기존 섹션 톤·스타일 따라가기

## Success Criteria
1. `PI_ENABLE_TEAM_MODE` 미설정 또는 `"1"` 이외 값 → `/team` 호출 시 안내 메시지만 출력하고 즉시 종료. 워커 스폰 없음, state 파일 생성 없음.
2. `PI_ENABLE_TEAM_MODE=1` → 기존과 동일하게 정상 동작.
3. 기존 테스트 스위트 통과 (필요 시 setup 에서 env var 설정).
4. `/team` 명령은 자동완성·도움말에서 여전히 보임 (등록 자체는 조건부 아님).
5. `extensions/agentic-harness/README.md` 에서 사용자가 게이트 존재·활성화 방법·미설정 시 동작을 명확히 알 수 있음.

## Open Questions
- **테스트 처리 방식**: vitest `setupFiles` 에서 일괄 `PI_ENABLE_TEAM_MODE=1` 설정할지, 영향받는 테스트만 개별 setup 에서 설정할지. plan 단계에서 영향받는 파일 식별 후 결정.
- **루트 README**: 현재 team 언급 없으니 손대지 않을 예정. 추가 원하시면 plan 단계에서 포함.

## Complexity Assessment

| Signal | 점수 | 근거 |
|---|---|---|
| Scope breadth | 1 | team mode 단일 기능, 단일 컴포넌트 (handler) + 문서 |
| File impact | 1 | 핵심 변경 2-3 파일 (`index.ts`, env 상수 위치, README) + 가능한 테스트 setup |
| Interface boundaries | 1 | 기존 `pi.registerCommand` 패턴 내부에서 처리 |
| Dependency depth | 1 | 순서 의존성 없음 |
| Risk surface | 1 | 외부 시스템·스키마·하위 호환성 영향 없음 |

**Score: 5 → Simple**
**Rationale**: handler 한 곳에 env var 검사 추가 + README 한 섹션 보강. 가장 큰 위험은 테스트 fallout 이며, 그것도 좁은 범위.

## Suggested Next Step
`plan-crafting` 으로 진행 — 단일 plan 사이클로 충분.
