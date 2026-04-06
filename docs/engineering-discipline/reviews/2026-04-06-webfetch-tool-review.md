# WebFetch Tool Review

**Date:** 2026-04-06
**Plan Document:** `docs/engineering-discipline/plans/2026-04-06-webfetch-tool.md`
**Verdict:** PASS

---

## 1. File Inspection Against Plan

| Planned File | Status | Notes |
|---|---|---|
| `extensions/agentic-harness/webfetch/types.ts` | OK | Exports `ExtractionMethod`, `ExtractedArticle`, `CacheEntry`, `WebFetchDetails` as specified. Doc comments removed in fix commit — types and structure match plan. |
| `extensions/agentic-harness/webfetch/cache.ts` | OK | LRU cache with TTL eviction, 15-min default TTL, max-size eviction. All 8 tests pass. Internal refactor: `removeNode` split into `detachNode` + `removeNode` — behavior unchanged. |
| `extensions/agentic-harness/webfetch/extractContent.ts` | OK | Dynamic imports of jsdom + Readability, `charThreshold: 500`, `isArticleContent` heuristic. `@ts-expect-error` added for jsdom import (no type declarations). All 9 tests pass. |
| `extensions/agentic-harness/webfetch/turndown.ts` | OK | Lazy singleton via dynamic import. GFM plugin, ATX headings, fenced code blocks, dash bullets, removes noise tags. Uses `import type TurndownService` instead of `InstanceType<>` — equivalent. All 8 tests pass. |
| `extensions/agentic-harness/webfetch/render.ts` | OK | `renderWebfetchCall` and `renderWebfetchResult` match plan spec. Collapsed/expanded modes, method labels, cached indicator. All 10 tests pass. |
| `extensions/agentic-harness/webfetch/utils.ts` | OK | Core pipeline: fetch → content-type detection → Readability → Turndown. Cache key includes transform mode. `maxLength` truncation applied only to returned copy. Size limit (10MB), timeout (30s), abort signal support. `getCacheKey` inlined in fix commit. Turndown service hoisted to single call. All 14 tests pass. |
| `extensions/agentic-harness/index.ts` | OK | Imports `fetchUrlToMarkdown`, `renderWebfetchCall`, `renderWebfetchResult`. `WebFetchParams` schema with `url` (required), `raw` (optional), `maxLength` (optional). Tool registered with `pi.registerTool()` including `renderCall`, `renderResult`, and `execute`. |
| `extensions/agentic-harness/tests/extension.test.ts` | OK | Two webfetch tests added: registration test and schema validation test. Both pass. |
| `extensions/agentic-harness/tests/webfetch-cache.test.ts` | OK | 8 tests covering store/retrieve, missing keys, TTL expiry, LRU eviction, update-in-place, promotion on access, clear, size. |
| `extensions/agentic-harness/tests/webfetch-extract.test.ts` | OK | 9 tests: 5 `isArticleContent` + 4 `extractMainContent`. |
| `extensions/agentic-harness/tests/webfetch-turndown.test.ts` | OK | 8 tests: instance, HTML→MD, ATX headings, fenced code, dash bullets, GFM tables, tag removal, singleton. |
| `extensions/agentic-harness/tests/webfetch-render.test.ts` | OK | 10 tests: 4 `renderCall` + 6 `renderResult`. |
| `extensions/agentic-harness/tests/webfetch-utils.test.ts` | OK | 14 tests: HTML→MD, Readability extraction, fallback, raw mode, caching, cache-mode separation, maxLength truncation, non-HTML, binary, HTTP error, fetch failure, size limit, abort, clear cache. |
| `extensions/agentic-harness/package.json` | OK | `@mozilla/readability`, `jsdom`, `turndown`, `turndown-plugin-gfm` in dependencies. `@types/turndown` in devDependencies. |

## 2. Test Results

| Test Command | Result | Notes |
|---|---|---|
| `cd extensions/agentic-harness && npx vitest run` | PASS | 18 test files, 185 tests, all passing. Duration: 1.35s. |
| `cd extensions/agentic-harness && npx tsc --noEmit` | PASS | Zero type errors. |

**Full Test Suite:** PASS

### Test Breakdown (webfetch-specific)

| Test File | Tests | Result |
|---|---|---|
| `webfetch-cache.test.ts` | 8 | PASS |
| `webfetch-extract.test.ts` | 9 | PASS |
| `webfetch-turndown.test.ts` | 8 | PASS |
| `webfetch-render.test.ts` | 10 | PASS |
| `webfetch-utils.test.ts` | 14 | PASS |
| `extension.test.ts` (webfetch tests) | 2 | PASS |

## 3. Code Quality

- [x] No placeholders
- [x] No debug code
- [x] No commented-out code blocks
- [ ] No changes outside plan scope

**Findings:**

1. **Unplanned fix commit** (`7981a614`): A `fix(webfetch): resolve TypeScript type declaration errors` commit was added beyond the 7 planned commits. Changes include:
   - `@ts-expect-error` annotations for jsdom and turndown-plugin-gfm (necessary — no type declarations available)
   - `import type TurndownService from "turndown"` instead of `InstanceType<typeof import(...)>
   - Removal of doc comments from types.ts, utils.ts, and extractContent.ts (clean-ai-slop style cleanup)
   - Inlining of `getCacheKey()` into `fetchUrlToMarkdown()` body
   - Hoisting `turndown` service to a single `await getTurndownService()` call
   - Cache.ts refactored: `removeNode` split into `detachNode` + `removeNode`
   - **Plan file committed** in this fix commit (should not have been included — it's a planning document, not source code)

   These changes are all reasonable implementation improvements. The behavioral logic is unchanged — all tests pass. The only concern is the plan file being included in the fix commit.

2. No `TODO`, `FIXME`, `console.log`, or `debugger` statements found in source code (the `console.log` in `webfetch-turndown.test.ts` is inside a test fixture HTML string — not debug code).

3. The `//` comments in source files are all inline explanatory comments — no commented-out code blocks.

## 4. Git History

| Planned Commit | Actual Commit | Match |
|---|---|---|
| `feat(webfetch): add dependencies and shared types` | `d63dea6e` | OK |
| `feat(webfetch): add LRU cache with TTL eviction` | `e3b13649` | OK |
| `feat(webfetch): add Readability content extraction with dynamic imports` | `e22f13fb` | OK |
| `feat(webfetch): add lazy Turndown + GFM service` | `32f809c9` | OK |
| `feat(webfetch): add custom TUI rendering for fetch status and results` | `0fb2d658` | OK |
| `feat(webfetch): add core fetch + convert pipeline with caching` | `61c3e4f9` | OK |
| `feat(webfetch): register webfetch tool in agentic-harness extension` | `edf32268` | OK |
| *(unplanned)* `fix(webfetch): resolve TypeScript type declaration errors` | `7981a614` | Extra commit |

All 7 planned commits exist with matching messages. One additional fix commit was added to resolve TypeScript type errors. The fix commit also includes the plan document file (which should not have been committed).

## 5. Overall Assessment

The webfetch tool implementation is **complete and functional**. All planned modules are implemented with correct functionality:

- **Types**: All 4 types exported as specified
- **Cache**: LRU with TTL, correct eviction behavior
- **Extraction**: Readability with dynamic imports, article detection heuristic
- **Turndown**: Lazy singleton with GFM, correct configuration
- **Render**: Call and result rendering with collapsed/expanded modes
- **Utils**: Full fetch pipeline with cache-key separation by transform mode, truncation-only-on-return, abort support, size limits, timeout
- **Registration**: Tool registered with TypeBox schema, render functions, execute handler
- **Tests**: 51 new webfetch tests + 2 extension tests, all passing
- **No regressions**: All 134 pre-existing tests still pass

The extra fix commit is a minor process deviation — it contains legitimate TypeScript compatibility fixes and code cleanup, but also inadvertently includes the plan document file.

## 6. Follow-up Actions

1. **Low priority**: Remove `docs/engineering-discipline/plans/2026-04-06-webfetch-tool.md` from git tracking if it was not intended to be committed (it was included in the fix commit). This is a documentation/process concern, not a code quality issue.
