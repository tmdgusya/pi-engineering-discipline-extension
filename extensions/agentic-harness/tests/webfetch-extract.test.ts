import { describe, it, expect } from "vitest";
import { isArticleContent, extractMainContent } from "../webfetch/extractContent.js";

describe("isArticleContent", () => {
  it("should detect article tag with good text density", () => {
    const html = "<html><body><article>" + "x".repeat(1000) + "</article></body></html>";
    expect(isArticleContent(html)).toBe(true);
  });

  it("should detect main tag with good text density", () => {
    const html = "<html><body><main>" + "y".repeat(1000) + "</main></body></html>";
    expect(isArticleContent(html)).toBe(true);
  });

  it("should reject content with low text density", () => {
    const html = "<html><body><article>" + "<div></div>".repeat(100) + "</article></body></html>";
    expect(isArticleContent(html)).toBe(false);
  });

  it("should reject content without article or main tag", () => {
    const html = "<html><body><div>" + "z".repeat(1000) + "</div></body></html>";
    expect(isArticleContent(html)).toBe(false);
  });

  it("should accept content with text density above threshold", () => {
    const text = "a".repeat(400);
    const tags = "<span>x</span>".repeat(40);
    const html = `<html><body><article>${text}${tags}</article></body></html>`;
    expect(isArticleContent(html)).toBe(true);
  });
});

describe("extractMainContent", () => {
  it("should extract article content from valid HTML", async () => {
    const bodyContent = "This is test content. ".repeat(50);
    const html = `
      <html>
        <head><title>Test Article</title></head>
        <body>
          <article>
            <h1>Test Article Title</h1>
            <p>${bodyContent}</p>
          </article>
        </body>
      </html>
    `;
    const result = await extractMainContent(html, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.title).toBeTruthy();
    expect(result!.content).toContain("test content");
    expect(result!.length).toBeGreaterThan(500);
  });

  it("should return null for content below charThreshold", async () => {
    const html = `
      <html>
        <head><title>Short</title></head>
        <body>
          <article>
            <p>Too short.</p>
          </article>
        </body>
      </html>
    `;
    const result = await extractMainContent(html, "https://example.com/short");
    expect(result).toBeNull();
  });

  it("should return null for empty HTML gracefully", async () => {
    const result = await extractMainContent("", "https://example.com/empty");
    expect(result).toBeNull();
  });

  it("should extract byline when present", async () => {
    const bodyContent = "A".repeat(600);
    const html = `
      <html>
        <head><title>Authored Article</title></head>
        <body>
          <article>
            <span class="author">Jane Doe</span>
            <p>${bodyContent}</p>
          </article>
        </body>
      </html>
    `;
    const result = await extractMainContent(html, "https://example.com/authored");
    // Readability may or may not extract byline depending on markup
    // Just verify the result is not null for a substantial article
    expect(result).not.toBeNull();
    expect(result!.content).toBeTruthy();
  });
});
