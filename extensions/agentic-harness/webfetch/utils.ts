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
