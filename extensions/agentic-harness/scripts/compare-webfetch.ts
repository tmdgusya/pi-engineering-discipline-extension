/**
 * Compare webfetch output between our implementation and Claude Code's WebFetchTool.
 *
 * Our tool:      Readability extraction → Turndown GFM
 * Claude Code:   Full HTML → Turndown (no Readability, no GFM)
 *
 * Usage: npx tsx scripts/compare-webfetch.ts [url1] [url2] ...
 */

import { fetchUrlToMarkdown } from "../webfetch/utils.js";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const URLS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [
      "https://docs.anthropic.com/en/docs/overview",
      "https://react.dev/learn",
      "https://nodejs.org/en/about",
      "https://vercel.com/blog",
      "https://github.com/vercel/next.js",
      "https://news.ycombinator.com",
      "https://en.wikipedia.org/wiki/TypeScript",
      "https://mdn.io/fetch",
    ];

async function fetchHtml(url: string, signal?: AbortSignal) {
  const res = await fetch(url, {
    signal,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; webfetch-bench/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) throw new Error(`Not HTML: ${ct}`);
  return await res.text();
}

function claudeCodeTurndown(html: string): string {
  const td = new TurndownService();
  const doc = new JSDOM(html);
  const md = td.turndown(doc.window.document);
  doc.window.close();
  return md;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main() {
  console.log("═".repeat(100));
  console.log("  WebFetch Comparison: Our Tool (Readability + Turndown GFM) vs Claude Code (Full HTML + Turndown)");
  console.log("═".repeat(100));
  console.log();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  const results: Array<{
    url: string;
    ours: number;
    cc: number;
    oursTokens: number;
    ccTokens: number;
    ratio: string;
    error?: string;
  }> = [];

  for (const url of URLS) {
    try {
      process.stdout.write(`  Fetching: ${url} ... `);

      const html = await fetchHtml(url, controller.signal);
      const htmlSize = new TextEncoder().encode(html).length;

      // Our tool: Readability + Turndown GFM
      const { content: ourMd } = await fetchUrlToMarkdown(url, { raw: false, signal: controller.signal });

      // Claude Code style: Full HTML → Turndown (no Readability, no GFM)
      const ccMd = claudeCodeTurndown(html);

      const ourLen = ourMd.length;
      const ccLen = ccMd.length;
      const ourTokens = estimateTokens(ourMd);
      const ccTokens = estimateTokens(ccMd);
      const ratio = ccLen > 0 ? (ourLen / ccLen * 100).toFixed(1) : "N/A";

      results.push({
        url,
        ours: ourLen,
        cc: ccLen,
        oursTokens: ourTokens,
        ccTokens: ccTokens,
        ratio,
      });

      console.log(`✓ (HTML: ${(htmlSize / 1024).toFixed(0)}KB)`);
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
      results.push({
        url,
        ours: 0,
        cc: 0,
        oursTokens: 0,
        ccTokens: 0,
        ratio: "ERR",
        error: err.message,
      });
    }
  }

  clearTimeout(timeout);

  console.log();
  console.log("─".repeat(100));
  console.log(
    "  " +
    "URL".padEnd(50) +
    "Ours (chars)".padStart(14) +
    "CC (chars)".padStart(14) +
    "Ours (~tok)".padStart(14) +
    "CC (~tok)".padStart(14) +
    "Ratio".padStart(10)
  );
  console.log("─".repeat(100));

  let totalOurs = 0;
  let totalCc = 0;
  let totalOursTokens = 0;
  let totalCcTokens = 0;

  for (const r of results) {
    const host = r.url.replace("https://", "").replace("http://", "").substring(0, 48);
    if (r.error) {
      console.log(`  ${host.padEnd(50)} (error: ${r.error})`);
    } else {
      console.log(
        "  " +
        host.padEnd(50) +
        r.ours.toLocaleString().padStart(14) +
        r.cc.toLocaleString().padStart(14) +
        r.oursTokens.toLocaleString().padStart(14) +
        r.ccTokens.toLocaleString().padStart(14) +
        r.ratio.padStart(9) + "%"
      );
      totalOurs += r.ours;
      totalCc += r.cc;
      totalOursTokens += r.oursTokens;
      totalCcTokens += r.ccTokens;
    }
  }

  console.log("─".repeat(100));
  console.log(
    "  " +
    "TOTAL".padEnd(50) +
    totalOurs.toLocaleString().padStart(14) +
    totalCc.toLocaleString().padStart(14) +
    totalOursTokens.toLocaleString().padStart(14) +
    totalCcTokens.toLocaleString().padStart(14) +
    (totalCc > 0 ? (totalOurs / totalCc * 100).toFixed(1) : "N/A").padStart(9) + "%"
  );
  console.log("─".repeat(100));

  console.log();
  console.log("  Ratio = Our output / Claude Code output × 100");
  console.log("  Lower ratio = less context consumed (Readability strips nav, ads, footers)");
  console.log("  ~tokens estimated as chars / 4 (rough GPT-style estimate)");
  console.log();

  // Show a sample of the first URL to compare quality
  if (results.length > 0 && !results[0].error) {
    const sampleUrl = URLS[0];
    console.log("═".repeat(100));
    console.log(`  Sample output comparison: ${sampleUrl}`);
    console.log("═".repeat(100));

    try {
      const html = await fetchHtml(sampleUrl);
      const { content: ourMd } = await fetchUrlToMarkdown(sampleUrl);
      const ccMd = claudeCodeTurndown(html);

      console.log();
      console.log("── OUR TOOL (Readability + Turndown GFM) ── First 2000 chars ──");
      console.log(ourMd.substring(0, 2000));
      console.log();
      console.log("── CLAUDE CODE (Full HTML + Turndown) ── First 2000 chars ──");
      console.log(ccMd.substring(0, 2000));
    } catch {
      // skip sample on error
    }
  }
}

main().catch(console.error);
