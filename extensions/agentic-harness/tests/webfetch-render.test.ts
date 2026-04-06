import { describe, it, expect } from "vitest";
import { renderWebfetchCall, renderWebfetchResult } from "../webfetch/render.js";
import type { WebFetchDetails } from "../webfetch/types.js";

function mockTheme(): any {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => `**${text}**`,
  };
}

function renderOutput(comp: any): string {
  return comp.render(80).join("\n");
}

describe("renderWebfetchCall", () => {
  it("should render URL hostname", () => {
    const theme = mockTheme();
    const result = renderWebfetchCall({ url: "https://example.com/page" }, theme);
    const output = renderOutput(result);
    expect(output).toContain("example.com");
    expect(output).toContain("webfetch");
  });

  it("should show raw flag when present", () => {
    const theme = mockTheme();
    const result = renderWebfetchCall({ url: "https://example.com", raw: true }, theme);
    const output = renderOutput(result);
    expect(output).toContain("raw");
  });

  it("should show maxLength when present", () => {
    const theme = mockTheme();
    const result = renderWebfetchCall({ url: "https://example.com", maxLength: 5000 }, theme);
    const output = renderOutput(result);
    expect(output).toContain("5000");
  });

  it("should handle minimal args", () => {
    const theme = mockTheme();
    const result = renderWebfetchCall({ url: "https://example.com" }, theme);
    const output = renderOutput(result);
    expect(output).toContain("webfetch");
    expect(output).toContain("example.com");
  });
});

describe("renderWebfetchResult", () => {
  const details: WebFetchDetails = {
    url: "https://example.com/article",
    method: "readability",
    bytes: 4096,
    contentType: "text/html",
    cached: false,
    duration: 350,
  };

  it("should render collapsed result with method and size", () => {
    const theme = mockTheme();
    const result = renderWebfetchResult(
      {
        content: [{ type: "text", text: "# Hello\n\nContent" }],
        details,
      },
      false,
      theme,
    );
    const output = renderOutput(result);
    expect(output).toContain("webfetch");
    expect(output).toContain("fetched");
    expect(output).toContain("350ms");
  });

  it("should render expanded result with full metadata", () => {
    const theme = mockTheme();
    const result = renderWebfetchResult(
      {
        content: [{ type: "text", text: "# Hello\n\nContent" }],
        details,
      },
      true,
      theme,
    );
    const output = renderOutput(result);
    expect(output).toContain("example.com");
    expect(output).toContain("method");
    expect(output).toContain("size");
    expect(output).toContain("text/html");
  });

  it("should show cached indicator for cached results", () => {
    const theme = mockTheme();
    const cachedDetails: WebFetchDetails = { ...details, cached: true };
    const result = renderWebfetchResult(
      {
        content: [{ type: "text", text: "cached content" }],
        details: cachedDetails,
      },
      false,
      theme,
    );
    const output = renderOutput(result);
    expect(output).toContain("cached");
  });

  it("should handle result without details gracefully", () => {
    const theme = mockTheme();
    const result = renderWebfetchResult(
      { content: [{ type: "text", text: "plain text output" }] },
      false,
      theme,
    );
    const output = renderOutput(result);
    expect(output).toContain("plain text output");
  });

  it("should handle full extraction method", () => {
    const theme = mockTheme();
    const fullDetails: WebFetchDetails = { ...details, method: "full" };
    const result = renderWebfetchResult(
      { content: [{ type: "text", text: "..." }], details: fullDetails },
      false,
      theme,
    );
    const output = renderOutput(result);
    expect(output).toContain("webfetch");
  });

  it("should handle raw extraction method", () => {
    const theme = mockTheme();
    const rawDetails: WebFetchDetails = { ...details, method: "raw" };
    const result = renderWebfetchResult(
      { content: [{ type: "text", text: "..." }], details: rawDetails },
      false,
      theme,
    );
    const output = renderOutput(result);
    expect(output).toContain("webfetch");
  });
});
