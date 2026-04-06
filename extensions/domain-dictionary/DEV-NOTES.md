# Domain Dictionary 개발 노트

## 실험적 기능 (Experimental Feature)

⚠️ **이 확장 기능은 실험적입니다.** 기본적으로 비활성화되어 있으며, 환경변수를 통해 활성화해야 사용할 수 있습니다.

### 활성화 방법

환경변수 `PI_ENABLE_DOMAIN_DICT`를 `1` 또는 `true`로 설정하세요.

#### 임시로 켜기 (한 번)
```bash
PI_ENABLE_DOMAIN_DICT=1 pi
```

#### 영구적으로 켜기 (~/.bashrc 또는 ~/.zshrc)
```bash
export PI_ENABLE_DOMAIN_DICT=1
```

### 비활성화 상태

- 환경변수가 설정되지 않았거나 `0`/`false`인 경우:
  - 확장 기능이 **조용히 로드되지 않음** (에러 없음)
  - `/dict`, `/dict-build` 명령 사용 불가
  - pi 시작 시 관련 로그 없음

### 코드에서의 체크

```typescript
// index.ts
const isEnabled = process.env.PI_ENABLE_DOMAIN_DICT === '1' || 
                  process.env.PI_ENABLE_DOMAIN_DICT === 'true';

if (!isEnabled) {
  return; // 실험적 기능이 꺼져있으면 로드하지 않음
}
```

---

## UI 출력 가이드

### ⚠️ console.log 사용 금지

pi 터미널 환경에서 `console.log()`를 사용하면 **입력창이 출력 내용과 겹쳐 보이는 버그**가 발생합니다.

```typescript
// ❌ 잘못된 방법 - 입력창이 밀림
console.log(`Domain Dictionary (${entries.length} domains):`);
console.log(summary);
```

### ✅ 올바른 방법: pi UI API 사용

#### 1. 간단한 알림: `ctx.ui.notify()`

짧은 메시지나 요약 정보를 표시할 때 사용합니다.

```typescript
ctx.ui.notify(`Dictionary built: ${entries.length} domains`, 'info');

// 타입: 'info' | 'warning' | 'error'
ctx.ui.notify('Dictionary not found', 'warning');
```

#### 2. 상세 결과: `ctx.ui.setWidget()`

여러 줄의 출력이 필요할 때는 위젯을 사용합니다. 위젯은 에디터 영역에 깔끔하게 표시됩니다.

```typescript
const output = [
  'Domain Results:',
  '  auth: 5 commits, 12 files',
  '  session-loop: 8 commits, 13 files',
];

ctx.ui.setWidget('dict-results', output, { 
  placement: 'belowEditor'  // 또는 'aboveEditor'
});
```

**위젯 옵션:**
- `placement: 'belowEditor'` - 에디터 아래에 표시 (결과 목록용)
- `placement: 'aboveEditor'` - 에디터 위에 표시 (헤더 정보용)

#### 3. 위젯 제거

위젯을 숨길 때는 `undefined`를 전달합니다.

```typescript
ctx.ui.setWidget('dict-results', undefined);
```

### 전체 예시

```typescript
pi.registerCommand('dict', {
  handler: async (args, ctx) => {
    const dict = new Dictionary(dictPath);
    const results = dict.search(args);
    
    if (results.length === 0) {
      // 간단한 알림
      ctx.ui.notify('No matching domains found.', 'warning');
    } else {
      // 상세 결과를 위젯으로 표시
      const output = formatResults(results).split('\n');
      ctx.ui.setWidget('dict-results', output, { 
        placement: 'belowEditor' 
      });
    }
  },
});
```

### 참고

- `console.log`는 디버깅용으로만 사용하고, 커밋 전에는 반드시 제거하세요.
- `ctx.ui`는 `ExtensionCommandContext`에서 제공됩니다.
- 위젯 키('dict-results' 등)는 고유해야 하며, 동일한 키를 재사용하면 기존 위젯이 대첩니다.
