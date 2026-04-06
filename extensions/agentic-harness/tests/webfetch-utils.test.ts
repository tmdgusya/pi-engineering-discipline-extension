import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch before importing the module
const mockFetch = vi.fn();

describe("fetchUrlToMarkdown", () => {
  let fetchUrlToMarkdown: typeof import("../webfetch/utils.js").fetchUrlToMarkdown;
  let clearCache: typeof import("../webfetch/utils.js").clearCache;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    mockFetch.mockReset();
    globalThis.fetch = mockFetch;

    // Re-import to get a fresh cache instance
    vi.resetModules();
    const mod = await import("../webfetch/utils.js");
    fetchUrlToMarkdown = mod.fetchUrlToMarkdown;
    clearCache = mod.clearCache;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockHtmlResponse(html: string, contentType = "text/html") {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": contentType }),
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    };
  }

  it("should fetch HTML and convert to markdown", async () => {
    mockFetch.mockResolvedValue(
      mockHtmlResponse("<html><body><h1>Hello</h1><p>World</p></body></html>"),
    );

    const result = await fetchUrlToMarkdown("https://example.com");
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
    expect(result.details.method).toBe("full");
    expect(result.details.cached).toBe(false);
    expect(result.details.contentType).toBe("text/html");
  });

  it("should convert article HTML via Turndown (no Readability)", async () => {
    const bodyText = "A".repeat(600);
    const html = `<html><body><article><h1>Title</h1><p>${bodyText}</p></article></body></html>`;
    mockFetch.mockResolvedValue(mockHtmlResponse(html));

    const result = await fetchUrlToMarkdown("https://example.com/article");
    expect(result.details.method).toBe("full");
    expect(result.content).toContain("Title");
  });

  it("should strip CSR noise like Loading...", async () => {
    const html = `<html><body><h1>Title</h1><p>Loading...</p><p>Real content here</p><p>Loading...</p></body></html>`;
    mockFetch.mockResolvedValue(mockHtmlResponse(html));

    const result = await fetchUrlToMarkdown("https://example.com/spa");
    expect(result.content).not.toContain("Loading...");
    expect(result.content).toContain("Real content");
    expect(result.content).toContain("Title");
  });

  it("should return cached result on second request for the same mode", async () => {
    mockFetch.mockResolvedValue(
      mockHtmlResponse("<html><body><h1>Cached</h1></body></html>"),
    );

    const first = await fetchUrlToMarkdown("https://example.com/cached");
    expect(first.details.cached).toBe(false);

    const second = await fetchUrlToMarkdown("https://example.com/cached");
    expect(second.details.cached).toBe(true);
    expect(second.content).toBe(first.content);
    // fetch should only be called once
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should keep raw/full-page mode cache entries separate", async () => {
    const html = `<html><body><article><h1>Title</h1><p>Content</p></article></body></html>`;
    mockFetch.mockResolvedValue(mockHtmlResponse(html));

    const autoResult = await fetchUrlToMarkdown("https://example.com/mode-test");
    const rawResult = await fetchUrlToMarkdown("https://example.com/mode-test", {
      raw: true,
    });

    expect(autoResult.details.method).toBe("full");
    expect(rawResult.details.method).toBe("full");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should truncate only the returned copy when maxLength is set", async () => {
    const longContent = "x".repeat(5000);
    const html = `<html><body><p>${longContent}</p></body></html>`;
    mockFetch.mockResolvedValue(mockHtmlResponse(html));

    const truncated = await fetchUrlToMarkdown("https://example.com/long", {
      maxLength: 100,
    });
    expect(truncated.content.length).toBeLessThan(200); // 100 + truncation message
    expect(truncated.content).toContain("truncated");

    const full = await fetchUrlToMarkdown("https://example.com/long");
    expect(full.content.length).toBeGreaterThan(1000);
    expect(full.content).not.toContain("... (truncated)");
  });

  it("should handle non-HTML content as raw", async () => {
    mockFetch.mockResolvedValue(
      mockHtmlResponse('{"key": "value"}', "application/json"),
    );

    const result = await fetchUrlToMarkdown("https://example.com/api");
    expect(result.details.method).toBe("raw");
    expect(result.content).toContain("key");
  });

  it("should handle binary content", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    });

    const result = await fetchUrlToMarkdown("https://example.com/image.png");
    expect(result.details.method).toBe("raw");
    expect(result.content).toContain("Binary content");
    expect(result.content).toContain("image/png");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
    });

    await expect(
      fetchUrlToMarkdown("https://example.com/missing"),
    ).rejects.toThrow("HTTP 404");
  });

  it("should throw on fetch failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(
      fetchUrlToMarkdown("https://example.com/down"),
    ).rejects.toThrow("Network error");
  });

  it("should throw on content exceeding size limit", async () => {
    // Content-Length header exceeds 10MB
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "text/html",
        "content-length": String(11 * 1024 * 1024),
      }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(
      fetchUrlToMarkdown("https://example.com/huge"),
    ).rejects.toThrow("too large");
  });

  it("should reject an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchUrlToMarkdown("https://example.com/aborted", {
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  it("should clear cache", async () => {
    mockFetch.mockResolvedValue(
      mockHtmlResponse("<html><body><p>Content</p></body></html>"),
    );

    await fetchUrlToMarkdown("https://example.com/clear");
    clearCache();

    const result = await fetchUrlToMarkdown("https://example.com/clear");
    expect(result.details.cached).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
