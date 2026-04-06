# WebFetch Pipeline Simplification — Claude Code 방식 도입

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Readability + jsdom 의존성을 제거하고 Claude Code의 Turndown-only 방식으로 전환하되, 우리만의 CSR 노이즈 제거(`stripNoise`)는 유지

**Architecture:** 현재 3-way 분기(Readability → full → raw)를 Claude Code처럼 2-way로 단순화: HTML은 Turndown 변환, 비-HTML은 raw. Readability 추출 레이어(`extractContent.ts` + `jsdom` + `@mozilla/readability`)를 완전히 제거하고, Turndown이 이미 제거하는 태그(`script`, `style`, `nav`, `header`, `footer`, `aside`)에 의존. Markdown 후처리에서 CSR 노이즈 패턴(Loading..., 등)을 정규식으로 필터링.

**Tech Stack:** turndown, turndown-plugin-gfm (기존 유지), @mariozechner/pi-coding-agent, @mariozechner/pi-tui

**Work Scope:**
- **In scope:**
  - `extractContent.ts` 삭제, Readability/jsdom 의존성 제거
  - `utils.ts` 파이프라인 단순화 (Readability 경로 제거, Turndown-only)
  - `types.ts`에서 `ExtractionMethod`를 `"full" | "raw"` 로 축소, `ExtractedArticle` 인터페이스 제거
  - `turndown.ts`에 GFM + 노이즈 태그 제거 설정 유지
  - 관련 테스트 파일 업데이트
  - `package.json`에서 `jsdom`, `@mozilla/readability` 제거
  - 샘플 파일 업데이트
- **Out of scope:**
  - 캐시 구조 변경 (`cache.ts` 유지)
  - TUI 렌더링 변경 (`render.ts` — method label만 업데이트)
  - 새로운 기능 추가 (redirect safety, domain blocklist 등)
  - Haiku 요약 도입 (별도 작업)

---

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npx vitest run`
- **What it validates:** 18개 테스트 파일 전체 통과, 회귀 없음

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `webfetch/extractContent.ts` | **DELETE** | Readability 추출 — 더 이상 필요 없음 |
| `webfetch/utils.ts` | **MODIFY** | 파이프라인 단순화: Readability 분기 제거 |
| `webfetch/types.ts` | **MODIFY** | `ExtractionMethod` 축소, `ExtractedArticle` 제거 |
| `webfetch/turndown.ts` | **KEEP** | 변경 없음 |
| `webfetch/cache.ts` | **KEEP** | 변경 없음 |
| `webfetch/render.ts` | **MODIFY** | method label에서 "readability" 제거 |
| `tests/webfetch-extract.test.ts` | **DELETE** | extractContent 테스트 — 대상 파일 삭제 |
| `tests/webfetch-utils.test.ts` | **MODIFY** | Readability 관련 테스트 제거/수정 |
| `tests/webfetch-render.test.ts` | **MODIFY** | readability method 렌더링 테스트 수정 |
| `package.json` | **MODIFY** | jsdom, @mozilla/readability 제거 |

---

### Task 1: Types 및 extractContent 정리

**Dependencies:** None (can run in parallel with Task 2)
**Files:**
- Modify: `extensions/agentic-harness/webfetch/types.ts`
- Delete: `extensions/agentic-harness/webfetch/extractContent.ts`
- Delete: `tests/webfetch-extract.test.ts`
- Modify: `extensions/agentic-harness/package.json`

- [ ] **Step 1: types.ts 업데이트**

`types.ts`에서 `ExtractedArticle` 인터페이스와 `readability` 값을 제거:

```typescript
export type ExtractionMethod = "full" | "raw";

export interface CacheEntry {
  content: string;
  bytes: number;
  code: number;
  codeText: string;
  contentType: string;
  extractionMethod: ExtractionMethod;
  url: string;
  cachedAt: number;
}

export interface WebFetchDetails {
  url: string;
  method: ExtractionMethod;
  bytes: number;
  contentType: string;
  cached: boolean;
  duration: number;
}
```

- [ ] **Step 2: extractContent.ts 삭제**

```bash
rm extensions/agentic-harness/webfetch/extractContent.ts
```

- [ ] **Step 3: extractContent 테스트 삭제**

```bash
rm extensions/agentic-harness/tests/webfetch-extract.test.ts
```

- [ ] **Step 4: package.json에서 jsdom, @mozilla/readability 제거**

`extensions/agentic-harness/package.json`의 `dependencies`에서 다음 항목 제거:
- `"jsdom": "^25.0.0"`
- `"@mozilla/readability": "^0.5.0"` (있는 경우)

```bash
cd extensions/agentic-harness && npm uninstall jsdom @mozilla/readability
```

- [ ] **Step 5: 테스트가 현재 실패하는지 확인**

```bash
cd extensions/agentic-harness && npx vitest run 2>&1 | tail -20
```

Expected: utils.ts import 에러로 실패 (extractContent 모듈 삭제됨)

---

### Task 2: utils.ts 파이프라인 단순화

**Dependencies:** Runs after Task 1 completes (extractContent 삭제로 인한 import 에러 해결)
**Files:**
- Modify: `extensions/agentic-harness/webfetch/utils.ts`

- [ ] **Step 1: utils.ts 전면 수정**

Readability import, `isArticleContent`, Readability 분기 로직을 제거하고 Turndown-only로 단순화. `stripNoise`와 캐시, 비-HTML 처리는 그대로 유지.

```typescript
import type { CacheEntry, ExtractionMethod, WebFetchDetails } from "./types.js";
import { WebFetchCache } from "./cache.js";
import { getTurndownService } from "./turndown.js";

const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; WebFetchTool/1.0)";

const CSR_NOISE = /^(Loading\.\.\.|\s*\.{3,}\s*$|Please enable JS|Enable JavaScript|You need to enable JavaScript|This page requires JavaScript)/i;

function stripNoise(md: string): string {
  return md
    .split("\n")
    .filter(line => !CSR_NOISE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const cache = new WebFetchCache();

function truncateContent(content: string, maxLength?: number): string {
  if (!maxLength || content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "\n\n... (truncated)";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function fetchUrlToMarkdown(
  url: string,
  options: { raw?: boolean; maxLength?: number; signal?: AbortSignal } = {},
): Promise<{ content: string; details: WebFetchDetails }> {
  const startTime = Date.now();
  const cacheKey = JSON.stringify({ url, mode: options.raw ? "full" : "auto" });

  const cached = cache.get(cacheKey);
  if (cached) {
    return {
      content: truncateContent(cached.content, options.maxLength),
      details: {
        url: cached.url,
        method: cached.extractionMethod,
        bytes: cached.bytes,
        contentType: cached.contentType,
        cached: true,
        duration: Date.now() - startTime,
      },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    FETCH_TIMEOUT_MS,
  );

  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      throw new Error("Request was aborted before it started");
    }
    options.signal.addEventListener(
      "abort",
      () => {
        controller.abort();
        clearTimeout(timeoutId);
      },
      { once: true },
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Fetch failed: ${message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType =
    response.headers.get("content-type") || "application/octet-stream";

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_CONTENT_SIZE) {
    throw new Error(
      `Content too large: ${formatBytes(parseInt(contentLength))} exceeds ${formatBytes(MAX_CONTENT_SIZE)} limit`,
    );
  }

  const isHtml =
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml");

  if (!isHtml) {
    const arrayBuf = await response.arrayBuffer();
    const bytes = arrayBuf.byteLength;

    if (bytes > MAX_CONTENT_SIZE) {
      throw new Error(
        `Content too large: ${formatBytes(bytes)} exceeds ${formatBytes(MAX_CONTENT_SIZE)} limit`,
      );
    }

    let textContent: string;
    const isTextual =
      contentType.includes("text/") ||
      contentType.includes("json") ||
      contentType.includes("xml");

    if (isTextual) {
      textContent = new TextDecoder("utf-8").decode(arrayBuf);
    } else {
      textContent = `[Binary content: ${contentType}, ${formatBytes(bytes)}]`;
    }

    const entry: CacheEntry = {
      content: textContent,
      bytes,
      code: response.status,
      codeText: response.statusText,
      contentType,
      extractionMethod: "raw",
      url,
      cachedAt: Date.now(),
    };
    cache.set(cacheKey, entry);

    return {
      content: truncateContent(textContent, options.maxLength),
      details: {
        url,
        method: "raw",
        bytes,
        contentType,
        cached: false,
        duration: Date.now() - startTime,
      },
    };
  }

  const htmlBuffer = await response.arrayBuffer();
  const bytes = htmlBuffer.byteLength;

  if (bytes > MAX_CONTENT_SIZE) {
    throw new Error(
      `Content too large: ${formatBytes(bytes)} exceeds ${formatBytes(MAX_CONTENT_SIZE)} limit`,
    );
  }

  const html = new TextDecoder("utf-8").decode(htmlBuffer);
  const turndown = await getTurndownService();
  const markdown = stripNoise(turndown.turndown(html));

  const entry: CacheEntry = {
    content: markdown,
    bytes: Buffer.byteLength(markdown),
    code: response.status,
    codeText: response.statusText,
    contentType,
    extractionMethod: "full",
    url,
    cachedAt: Date.now(),
  };
  cache.set(cacheKey, entry);

  return {
    content: truncateContent(markdown, options.maxLength),
    details: {
      url,
      method: "full",
      bytes: entry.bytes,
      contentType,
      cached: false,
      duration: Date.now() - startTime,
    },
  };
}

/** Clear the URL content cache (useful for testing). */
export function clearCache(): void {
  cache.clear();
}
```

핵심 변화:
- `extractMainContent`, `isArticleContent` import 제거
- Readability 분기(`if (isArticleContent(html)) { ... }`) 완전 삭제
- HTML은 항상 `turndown.turndown(html)` → `stripNoise()` 처리
- `method`는 항상 `"full"` (HTML) 또는 `"raw"` (비-HTML)

- [ ] **Step 2: 컴파일 확인**

```bash
cd extensions/agentic-harness && npx tsc --noEmit 2>&1
```

Expected: 기존 compare-webfetch.ts의 jsdom 에러만 남고, webfetch/ 내부는 에러 없음

---

### Task 3: render.ts 및 테스트 업데이트

**Dependencies:** Runs after Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/webfetch/render.ts`
- Modify: `extensions/agentic-harness/tests/webfetch-utils.test.ts`
- Modify: `extensions/agentic-harness/tests/webfetch-render.test.ts`

- [ ] **Step 1: render.ts에서 readability 케이스 제거**

`render.ts`의 `methodLabel` 함수에서 `"readability"` case를 제거:

```typescript
function methodLabel(
  method: string,
  fg: (color: any, text: string) => string,
): string {
  switch (method) {
    case "full":
      return fg("warning", "full-html");
    case "raw":
      return fg("dim", "raw");
    default:
      return fg("dim", method);
  }
}
```

- [ ] **Step 2: webfetch-utils.test.ts에서 Readability 관련 테스트 수정**

`tests/webfetch-utils.test.ts`에서:
- `isArticleContent` 관련 import/테스트 제거
- `extractMainContent` 관련 테스트 제거
- Readability 모킹 제거
- `method` 값이 `"readability"`인 테스트를 `"full"`로 변경
- 비-HTML(raw), HTML(full) 두 경로만 테스트
- `stripNoise` 동작은 여전히 테스트 (Loading... 제거 등)

- [ ] **Step 3: webfetch-render.test.ts에서 readability 렌더링 테스트 수정**

`tests/webfetch-render.test.ts`에서:
- `method: "readability"`를 사용하는 테스트를 `"full"`로 변경
- readability 레이블 스냅샷 검증 제거

- [ ] **Step 4: 전체 테스트 실행**

```bash
cd extensions/agentic-harness && npx vitest run
```

Expected: 17개 테스트 파일 전체 PASS (webfetch-extract.test.ts 삭제됨)

---

### Task 4: 샘플 파일 및 벤치마크 업데이트

**Dependencies:** Runs after Task 3 completes
**Files:**
- Modify: `docs/engineering-discipline/webfetch-sample-ours.md`
- Modify: `docs/engineering-discipline/webfetch-comparison.md`
- Delete: `extensions/agentic-harness/scripts/compare-webfetch.ts` (jsdom 의존)

- [ ] **Step 1: compare-webfetch.ts 삭제**

이 스크립트는 jsdom을 직접 import하여 Claude Code 방식을 에뮬레이트했으나, 이제 우리가 Claude Code 방식과 동일하므로 불필요:

```bash
rm extensions/agentic-harness/scripts/compare-webfetch.ts
```

- [ ] **Step 2: 샘플 파일 재생성**

`docs/engineering-discipline/webfetch-sample-ours.md`를 새 파이프라인으로 재생성:

```bash
cd extensions/agentic-harness && npx tsx -e "
import { fetchUrlToMarkdown, clearCache } from './webfetch/utils.js';
import { writeFileSync } from 'fs';
async function main() {
  clearCache();
  const r = await fetchUrlToMarkdown('https://docs.anthropic.com/en/docs/overview');
  writeFileSync('../../docs/engineering-discipline/webfetch-sample-ours.md', r.content);
  console.log('Done:', r.content.length, 'chars, method:', r.details.method);
}
main();
"
```

- [ ] **Step 3: comparison 문서 업데이트**

`docs/engineering-discipline/webfetch-comparison.md`의 요약 섹션에 파이프라인 변경 사항을 기록:
- Readability 제거로 인한 의존성 감소 기록
- jsdom(~4MB) 번들 사이즈 절감 기록
- 파이프라인이 Claude Code와 동일해짐을 기록

---

### Task 5 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
cd extensions/agentic-harness && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd extensions/agentic-harness && npx tsc --noEmit 2>&1
```

Expected: webfetch/ 내부 파일은 에러 없음. 기존 compare-webfetch.ts가 삭제되었으므로 jsdom 관련 에러도 없어야 함.

- [ ] **Step 3: 실제 URL 동작 확인**

```bash
cd extensions/agentic-harness && npx tsx -e "
import { fetchUrlToMarkdown, clearCache } from './webfetch/utils.js';
async function main() {
  clearCache();
  const r = await fetchUrlToMarkdown('https://docs.anthropic.com/en/docs/overview');
  const loading = r.content.split('\n').filter(l => l.includes('Loading')).length;
  console.log('Method:', r.details.method);
  console.log('Size:', r.content.length, 'chars');
  console.log('Loading lines:', loading);
  console.log('Cached:', r.details.cached);
}
main();
"
```

Expected:
- Method: `full`
- Size: ~5000-6000 chars
- Loading lines: 0 (stripNoise 작동)

- [ ] **Step 4: jsdom/readability 의존성 제거 확인**

```bash
cd extensions/agentic-harness && grep -E '"jsdom"|"@mozilla/readability"' package.json
```

Expected: 아무것도 출력되지 않음 (의존성 완전 제거)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: simplify webfetch pipeline to Turndown-only (Claude Code style)

- Remove Readability + jsdom dependency
- Remove extractContent.ts (Readability extraction layer)
- Simplify utils.ts to HTML→Turndown→stripNoise pipeline
- Update types: ExtractionMethod is now 'full' | 'raw'
- Update tests and render.ts for removed 'readability' method
- Keep CSR noise stripping (Loading..., etc.)"
```
