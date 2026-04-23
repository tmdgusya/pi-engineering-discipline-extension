/**
 * Shared utilities for workspace-memory extension
 */

import type { Memory, MemoryIndexEntry, MemoryTemplate } from "./types";

export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract a section from text by heading (line-based, supports Unicode/Korean)
 *
 * Returns empty string "" if the section is found but has no content.
 * Returns undefined if the heading is not found at all.
 */
export function extractSection(text: string, heading: string): string | undefined {
	const lines = text.split("\n");
	const headingLower = heading.toLowerCase();
	let found = false;
	const content: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		const isHeading =
			trimmed.toLowerCase() === headingLower ||
			trimmed.toLowerCase().startsWith(headingLower + ":") ||
			trimmed.toLowerCase().startsWith(headingLower + "：") ||
			/^#{1,3}\s+/.test(trimmed) && trimmed.toLowerCase().includes(headingLower);

		if (isHeading) {
			if (found) break; // next section
			found = true;
			continue;
		}

		if (found) {
			// Stop at next Markdown heading or obvious next section
			if (/^#{1,3}\s+/.test(trimmed)) break;
			content.push(line);
		}
	}

	if (!found) return undefined;
	return content.join("\n").trim();
}

/**
 * Parse raw memory text into structured content based on template
 */
export function parseMemoryContent(raw: string, template: MemoryTemplate): Memory["content"] {
	if (template === "post-mortem") {
		const problem = extractSection(raw, "Problem") ?? raw;
		const rootCause = extractSection(raw, "Root Cause") ?? "";
		const fix = extractSection(raw, "Fix") ?? "";
		const prevention = extractSection(raw, "Prevention") ?? "";
		return { problem, rootCause, fix, prevention };
	}
	if (template === "decision-record") {
		const context = extractSection(raw, "Context") ?? raw;
		const decision = extractSection(raw, "Decision") ?? "";
		const rationale = extractSection(raw, "Rationale") ?? "";
		const alternativesConsidered = extractSection(raw, "Alternatives Considered") ?? "";
		return { context, decision, rationale, alternativesConsidered };
	}
	return {
		summary: raw.slice(0, 500),
		keyPoints: raw
			.split("\n")
			.filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"))
			.map((l) => l.trim().replace(/^[-*]\s*/, ""))
			.slice(0, 10),
	};
}

/**
 * Normalize a template string from LLM/user input to a valid MemoryTemplate
 */
export function normalizeTemplate(value: string | undefined): MemoryTemplate {
	if (!value) return "compact-note";
	const normalized = value.toLowerCase().trim();
	if (normalized === "post-mortem" || normalized === "postmortem") return "post-mortem";
	if (normalized === "decision-record" || normalized === "decisionrecord" || normalized === "adr") return "decision-record";
	return "compact-note";
}

/**
 * Derive a short summary from structured memory content
 */
export function getSummary(content: Memory["content"], template: MemoryTemplate): string {
	if (template === "post-mortem") {
		return (content as { problem: string }).problem.slice(0, 120);
	}
	if (template === "decision-record") {
		return (content as { decision: string }).decision.slice(0, 120);
	}
	return (content as { summary: string }).summary.slice(0, 120);
}

/**
 * Format memory entries as a Markdown table
 */
export function formatMemoryTable(entries: MemoryIndexEntry[]): string {
	if (entries.length === 0) return "No memories found.";
	const lines = ["| ID | Template | Summary | Recalls | Score |", "|---|---|---|---|---|"];
	for (const e of entries) {
		const shortId = e.id.replace(/^mem-\d+-/, "");
		const summary = e.summary.length > 40 ? e.summary.slice(0, 37) + "..." : e.summary;
		lines.push(`| ${shortId} | ${e.template} | ${summary} | ${e.recallCount} | ${e.score.toFixed(2)} |`);
	}
	return lines.join("\n");
}
