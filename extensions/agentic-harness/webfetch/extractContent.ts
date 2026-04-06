import type { ExtractedArticle } from "./types.js";

export async function extractMainContent(
  html: string,
  url: string,
): Promise<ExtractedArticle | null> {
  try {
    const [{ JSDOM }, { Readability }] = await Promise.all([
      // @ts-expect-error no type declarations for jsdom
      import("jsdom"),
      import("@mozilla/readability"),
    ]);

    const dom = new JSDOM(html, {
      url,
      contentType: "text/html",
      pretendToBeVisual: false,
      storageQuota: 0,
    });

    const reader = new Readability(dom.window.document, {
      charThreshold: 500,
      classesToPreserve: ["code", "highlight"],
      keepClasses: false,
    });

    const article = reader.parse();
    dom.window.close();

    if (!article || article.length < 500) {
      return null;
    }

    return {
      title: article.title || "",
      content: article.content || "",
      textContent: article.textContent || "",
      length: article.length || 0,
      excerpt: article.excerpt || "",
      byline: article.byline || null,
      dir: article.dir || "",
      siteName: article.siteName || null,
      lang: article.lang || null,
    };
  } catch {
    return null;
  }
}

/**
 * Heuristic: does the HTML look like an article/document page?
 * Checks for <article> or <main> tags and sufficient text density.
 */
export function isArticleContent(html: string): boolean {
  const hasArticleTag = /<article[>\s]/i.test(html);
  const hasMainTag = /<main[>\s]/i.test(html);
  const textLength = html.replace(/<[^>]*>/g, "").length;
  const textDensity = textLength / html.length;

  return (hasArticleTag || hasMainTag) && textDensity > 0.3;
}
