## Context Brief: Pi Extension 컨텍스트 컴팩션 구현

### Goal
pi-engineering-discipline-extension에서 `session_before_compact` 훅을 활용하여, 엔지니어링 워크플로우 phase에 맞는 커스텀 컨텍스트 컴팩션을 구현한다. 동시에 `context` 이벤트를 활용한 microcompaction(오래된 tool result 비우기)도 함께 구현한다.

### Scope
- **In scope**:
  - `session_before_compact` 훅 핸들러: phase-aware 커스텀 요약 생성
  - `context` 이벤트 핸들러: microcompaction (오래된 tool result 트렁케이션)
  - 활성 목표 문서 상태 관리 (인메모리 + 파일 + CompactionEntry.details)
  - `session_start` 이벤트에서 상태 복원
  - 요약 프롬프트: Claude Code 9섹션 구조 기반 + 엔지니어링 phase 특화 섹션
- **Out of scope**:
  - 코어(`@mariozechner/pi-coding-agent`) 수정
  - 별도 요약 모델 사용 (현재 대화 모델 사용)
  - Session Memory Compaction (Claude Code의 GrowthBook 기반 경량 방식)
  - `/compact` 명령어 커스터마이징 (기본 제공 사용)

### Technical Context

#### 사용 가능한 API Surface

**1. `session_before_compact` 이벤트:**
```typescript
interface SessionBeforeCompactEvent {
  type: "session_before_compact";
  preparation: CompactionPreparation;
  branchEntries: SessionEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: CompactionSettings;
}

// 반환하면 기본 컴팩션을 대체
interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactionResult;
}

interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;  // 활성 목표 문서 경로 등 메타데이터
}
```

**2. `context` 이벤트 (microcompaction용):**
```typescript
interface ContextEvent {
  type: "context";
  messages: AgentMessage[];
}

interface ContextEventResult {
  messages?: AgentMessage[];  // 수정된 메시지로 대체
}
```

**3. 메시지 직렬화 유틸리티:**
```typescript
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
// convertToLlm: AgentMessage[] → Message[]
// serializeConversation: Message[] → string (텍스트 형태, tool result 2000자 트렁케이션)
```

**4. LLM 호출:**
```typescript
import { complete } from "@mariozechner/pi-ai";
// complete(model, { messages }, { apiKey, headers, maxTokens, signal }) → AssistantMessage
```

**5. 모델/인증 접근:**
```typescript
ctx.modelRegistry.find(provider, modelId);  // 모델 찾기
ctx.modelRegistry.getApiKeyAndHeaders(model);  // 인증 정보
ctx.model;  // 현재 대화 모델
```

#### 현재 Extension 구조
- 진입점: `extensions/agentic-harness/index.ts` (289줄)
- 워크플로우 phase: `idle | clarifying | planning | ultraplanning` (인메모리)
- Phase guidance: `before_agent_start`에서 시스템 프롬프트에 주입
- 목표 문서 저장: `docs/engineering-discipline/{context,plans,reviews}/`
- **세션 → 목표 문서 매핑 없음** (신규 구현 필요)

#### 참조 구현
- **Claude Code** (`~/claude-code/src/services/compact/`): 9섹션 구조화 요약, `<analysis>` + `<summary>` 블록, microcompaction, circuit breaker
- **pi-mono coding-agent**: `keepRecentTokens`(20k) 기준 cut point → LLM 요약 → `CompactionEntry`, `session_before_compact` 훅

### Constraints
- Extension 레벨에서만 구현 — 코어 패키지 수정 불가
- 현재 대화 모델을 요약에도 사용 (별도 모델 X)
- `AbortSignal`을 반드시 전파해야 함 (ESC 키 취소 지원)
- 병렬 작업이 많으므로 날짜 기반 문서 탐색은 오탐 위험 → 명시적 상태 저장 필수
- `CompactionResult`를 반환하면 기본 컴팩션이 완전히 대체됨 — 실패 시 `return undefined`로 기본 동작 폴백

### Success Criteria
1. **컴팩션 후 최초 목표 보존**: 컴팩션 후에도 사용자의 최초 요청과 활성 목표 문서가 요약에 포함됨
2. **Phase-aware 요약**: 현재 phase에 따라 요약 구조가 달라짐 (clarifying → scope 중심, planning → 진행상황 중심)
3. **Microcompaction 동작**: `context` 이벤트에서 오래된 tool result가 트렁케이션됨
4. **상태 복원**: pi 재시작 후 `session_start`에서 활성 문서 경로 및 phase가 복원됨
5. **폴백 안전성**: 요약 생성 실패 시 기본 컴팩션으로 폴백
6. **AbortSignal 지원**: 컴팩션 중 ESC로 취소 가능

### Open Questions
1. Microcompaction의 시간 임계값 — Claude Code는 60분 이상 경과한 tool result를 비움. pi extension에서 적절한 값은? (기본 60분으로 시작 후 조정 가능)
2. 상태 파일 경로 — `.pi/extension-state.json` vs 프로젝트 내 `docs/` 하위? (`.pi/extension-state.json` 추천)
3. `customInstructions` (유저가 `/compact <instructions>`로 전달) 처리 — 커스텀 프롬프트에 append할지, 별도 섹션으로 넣을지

### Complexity Assessment

| Signal | Score | Rationale |
|--------|-------|-----------|
| **Scope breadth** | 2 (Medium) | 컴팩션 + microcompaction + 상태 관리 — 3개 관련 컴포넌트 |
| **File impact** | 1 (Low) | 주로 index.ts 수정 + 상태 파일 1개 추가 |
| **Interface boundaries** | 2 (Medium) | 기존 ExtensionAPI 인터페이스 내에서 작업하되, 새로운 이벤트 핸들러 3개 등록 |
| **Dependency depth** | 2 (Medium) | session_start → 상태 복원 → context/compact 이벤트 순서 의존 |
| **Risk surface** | 2 (Medium) | 컴팩션 실패 시 기본 동작 폴백으로 위험 완화, 하지만 요약 품질은 프롬프트 튜닝 필요 |

**Score:** 9
**Verdict:** Borderline Complex
**Rationale:** 개별 컴포넌트는 단순하지만, 상태 관리(인메모리+파일+details)와 phase-aware 프롬프트 분기가 결합되어 경계선에 위치. 단일 파일(index.ts) 중심이므로 milestone 분해 없이 plan-crafting으로 충분할 가능성이 높음.

### Suggested Next Step
Borderline (score 9) — `plan-crafting` 추천. 단일 파일 중심 구현이고 컴포넌트 간 의존성이 선형적이므로 milestone 분해 없이 단일 계획 사이클로 충분합니다. 다만 프롬프트 튜닝이 반복적일 수 있으므로, 구현 후 테스트 사이클을 계획에 포함해야 합니다.
