/**
 * Workspace Memory Extension for pi
 *
 * Automatically detects important moments in conversation, saves them as
 * structured workspace-scoped memory, and efficiently recalls them in
 * future related conversations.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Memory, MemoryIndex, MemoryIndexEntry, MemoryTemplate } from "./types";
import {
	loadIndex,
	saveIndex,
	loadMemory,
	saveMemory,
	deleteMemoryFile,
	generateMemoryId,
	upsertIndexEntry,
	removeIndexEntry,
} from "./storage";
import { detectKeywords, selectTemplateFromKeywords, getSavePrompt, TEMPLATE_LABELS } from "./templates";
import { recordRecall, evictIfNeeded, recalculateAllScores, getMemoryStats } from "./scoring";
import { recallMemories, extractKeywords } from "./recall";

// ---------------------------------------------------------------------------
// Module-level cache (per workspace)
// ---------------------------------------------------------------------------

const indexCache = new Map<string, MemoryIndex>();

function getCachedIndex(cwd: string): MemoryIndex {
	if (!indexCache.has(cwd)) {
		const index = loadIndex(cwd);
		indexCache.set(cwd, index);
	}
	return indexCache.get(cwd)!;
}

function setCachedIndex(cwd: string, index: MemoryIndex): void {
	indexCache.set(cwd, index);
}

function invalidateCache(cwd: string): void {
	indexCache.delete(cwd);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRecentConversationText(event: { prompt: string }): string {
	return event.prompt;
}

function parseMemoryContent(raw: string, template: MemoryTemplate): Memory["content"] {
	if (template === "post-mortem") {
		const problem = extractSection(raw, "Problem") || extractSection(raw, "problem") || raw;
		const rootCause = extractSection(raw, "Root Cause") || extractSection(raw, "root cause") || "";
		const fix = extractSection(raw, "Fix") || extractSection(raw, "fix") || "";
		const prevention = extractSection(raw, "Prevention") || extractSection(raw, "prevention") || "";
		return { problem, rootCause, fix, prevention };
	}
	if (template === "decision-record") {
		const context = extractSection(raw, "Context") || extractSection(raw, "context") || raw;
		const decision = extractSection(raw, "Decision") || extractSection(raw, "decision") || "";
		const rationale = extractSection(raw, "Rationale") || extractSection(raw, "rationale") || "";
		const alternativesConsidered = extractSection(raw, "Alternatives Considered") || extractSection(raw, "alternatives considered") || "";
		return { context, decision, rationale, alternativesConsidered };
	}
	return {
		summary: raw.slice(0, 500),
		keyPoints: raw.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*")).map((l) => l.trim().replace(/^[-*]\s*/, "")).slice(0, 10),
	};
}

function extractSection(text: string, heading: string): string | undefined {
	const regex = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?${escapeRegex(heading)}[:：]?\\s*\\n?([^\\n#]*(?:\\n(?!(?:#{1,3}\\s*|\\s*[A-Z][a-zA-Z\\s]+[:：]?\\s*\\n))[^\\n#]*)*`, "i");
	const match = text.match(regex);
	return match?.[1].trim() || undefined;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMemoryTable(entries: MemoryIndexEntry[]): string {
	if (entries.length === 0) return "No memories found.";
	const lines = ["| ID | Template | Summary | Recalls | Score |", "|---|---|---|---|---|"];
	for (const e of entries) {
		const shortId = e.id.replace(/^mem-\d+-/, "");
		const summary = e.summary.length > 40 ? e.summary.slice(0, 37) + "..." : e.summary;
		lines.push(`| ${shortId} | ${e.template} | ${summary} | ${e.recallCount} | ${e.score.toFixed(2)} |`);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function workspaceMemoryExtension(pi: ExtensionAPI) {
	// --- Session start: load index ---
	pi.on("session_start", async (_event, ctx) => {
		const index = getCachedIndex(ctx.cwd);
		if (index.memories.length > 0) {
			ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
		} else {
			ctx.ui.setStatus("memory", undefined);
		}
	});

	// --- Before agent start: keyword detection + recall ---
	pi.on("before_agent_start", async (event, ctx) => {
		const index = getCachedIndex(ctx.cwd);
		const promptText = event.prompt;
		const keywords = detectKeywords(promptText);

		// Recall relevant memories
		const recentText = promptText;
		const { text: memoryContext, recalledIds } = await recallMemories(index, recentText, ctx.cwd);

		// Save index if any recalls happened (score updates)
		if (recalledIds.length > 0) {
			saveIndex(index, ctx.cwd);
			ctx.ui.setStatus("memory", `💾 ${index.memories.length} (${recalledIds.length} recalled)`);
		}

		// Build result
		const result: { systemPrompt?: string; message?: any } = {};

		// Inject recalled memories into system prompt
		if (memoryContext) {
			result.systemPrompt = event.systemPrompt + "\n\n" + memoryContext;
		}

		// If trigger keywords detected, suggest saving memory
		if (keywords.length > 0) {
			const template = selectTemplateFromKeywords(keywords);
			const label = TEMPLATE_LABELS[template];
			const hint = `\n\n[System Note: This conversation contains keywords related to "${keywords.join(", ")}". ` +
				`If you resolved an issue, made an important decision, or learned something valuable, ` +
				`please use the \`memory_save\` tool to record it as a "${label}" for future reference.]`;

			if (result.systemPrompt) {
				result.systemPrompt += hint;
			} else {
				result.systemPrompt = event.systemPrompt + hint;
			}
		}

		return result;
	});

	// --- Tool: memory_save ---
	pi.registerTool({
		name: "memory_save",
		label: "Save Memory",
		description: "Save an important finding, bug fix, decision, or insight to workspace memory for future recall.",
		promptSnippet: "Save important workspace findings to memory for future recall",
		promptGuidelines: [
			"Use memory_save after resolving bugs, making decisions, or discovering important patterns.",
			"Be specific: include file names, error messages, root causes, and fixes.",
			"The system will automatically recall relevant memories in future conversations.",
		],
		parameters: Type.Object({
			content: Type.String({
				description: "Structured memory content. For post-mortem: Problem, Root Cause, Fix, Prevention. For decision: Context, Decision, Rationale, Alternatives.",
			}),
			template: Type.Optional(
				Type.String({
					description: "Memory template type: post-mortem, decision-record, or compact-note. Auto-detected if omitted.",
				})
			),
			tags: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional tags for categorization (e.g., ['bug', 'redis', 'performance'])",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const index = getCachedIndex(cwd);

			// Detect keywords from content to determine template
			const detectedKeywords = detectKeywords(params.content);
			const template: MemoryTemplate =
				(params.template as MemoryTemplate) || selectTemplateFromKeywords(detectedKeywords);

			const memoryId = generateMemoryId();
			const now = new Date().toISOString();

			// Parse content into structured format
			const structuredContent = parseMemoryContent(params.content, template);

			// Build tags from params + detected keywords
			const tags = [...new Set([...(params.tags || []), ...detectedKeywords])].slice(0, 10);

			const memory: Memory = {
				id: memoryId,
				template,
				metadata: {
					createdAt: now,
					tags,
					triggerKeywords: detectedKeywords,
				},
				content: structuredContent,
			};

			// Derive summary from content
			let summary = "";
			if (template === "post-mortem") {
				const c = structuredContent as { problem: string };
				summary = c.problem.slice(0, 120);
			} else if (template === "decision-record") {
				const c = structuredContent as { decision: string };
				summary = c.decision.slice(0, 120);
			} else {
				const c = structuredContent as { summary: string };
				summary = c.summary.slice(0, 120);
			}

			const entry: MemoryIndexEntry = {
				id: memoryId,
				file: `${memoryId}.json`,
				template,
				summary,
				tags,
				createdAt: now,
				lastRecalledAt: null,
				recallCount: 0,
				score: 0,
			};

			// Save memory file
			saveMemory(memory, cwd);

			// Update index
			upsertIndexEntry(index, entry);

			// Recalculate scores and evict if needed
			recalculateAllScores(index);
			const evictedCount = evictIfNeeded(index, cwd);

			// Persist index
			saveIndex(index, cwd);
			setCachedIndex(cwd, index);

			if (ctx.hasUI) {
				ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
			}

			let message = `Memory saved successfully.\nID: ${memoryId}\nTemplate: ${template}\nTags: ${tags.join(", ") || "none"}`;
			if (evictedCount > 0) {
				message += `\n(${evictedCount} old memories evicted to stay within limit)`;
			}

			return {
				content: [{ type: "text", text: message }],
				details: { memoryId, template, tags },
			};
		},
	});

	// --- Commands ---

	pi.registerCommand("memory", {
		description: "Workspace memory commands. Usage: /memory list | show <id> | save <text> | delete <id> | search <query> | stats",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "list";
			const rest = parts.slice(1).join(" ").trim();

			const index = getCachedIndex(cwd);

			switch (subcommand) {
				case "list": {
					const entries = [...index.memories].sort(
						(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
					);
					ctx.ui.notify(formatMemoryTable(entries), "info");
					break;
				}

				case "show": {
					const id = rest || parts[1];
					if (!id) {
						ctx.ui.notify("Usage: /memory show <id>", "warning");
						return;
					}
					// Allow partial ID matching
					const entry = index.memories.find(
						(m) => m.id === id || m.id.endsWith(`-${id}`)
					);
					if (!entry) {
						ctx.ui.notify(`Memory not found: ${id}`, "error");
						return;
					}
					const mem = loadMemory(entry.id, cwd);
					if (!mem) {
						ctx.ui.notify(`Memory file missing: ${entry.id}`, "error");
						return;
					}
					let text = `## Memory: ${entry.id}\n**Template:** ${entry.template}\n**Created:** ${entry.createdAt}\n**Tags:** ${entry.tags.join(", ") || "none"}\n**Recalls:** ${entry.recallCount}\n**Score:** ${entry.score.toFixed(2)}\n\n`;
					text += JSON.stringify(mem.content, null, 2);
					ctx.ui.notify(text, "info");
					break;
				}

				case "save": {
					const text = rest;
					if (!text) {
						ctx.ui.notify("Usage: /memory save <text>", "warning");
						return;
					}
					// Simulate a tool call to save memory
					const detectedKeywords = detectKeywords(text);
					const template = selectTemplateFromKeywords(detectedKeywords);
					const memoryId = generateMemoryId();
					const now = new Date().toISOString();
					const structuredContent = parseMemoryContent(text, template);
					const tags = [...new Set(detectedKeywords)].slice(0, 10);

					let summary = "";
					if (template === "post-mortem") {
						summary = (structuredContent as { problem: string }).problem.slice(0, 120);
					} else if (template === "decision-record") {
						summary = (structuredContent as { decision: string }).decision.slice(0, 120);
					} else {
						summary = (structuredContent as { summary: string }).summary.slice(0, 120);
					}

					const memory: Memory = {
						id: memoryId,
						template,
						metadata: { createdAt: now, tags, triggerKeywords: detectedKeywords },
						content: structuredContent,
					};

					const entry: MemoryIndexEntry = {
						id: memoryId,
						file: `${memoryId}.json`,
						template,
						summary,
						tags,
						createdAt: now,
						lastRecalledAt: null,
						recallCount: 0,
						score: 0,
					};

					saveMemory(memory, cwd);
					upsertIndexEntry(index, entry);
					recalculateAllScores(index);
					const evictedCount = evictIfNeeded(index, cwd);
					saveIndex(index, cwd);
					setCachedIndex(cwd, index);

					let msg = `Memory saved: ${memoryId} (${template})`;
					if (evictedCount > 0) msg += ` (${evictedCount} evicted)`;
					ctx.ui.notify(msg, "info");
					if (ctx.hasUI) ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
					break;
				}

				case "delete": {
					const id = rest || parts[1];
					if (!id) {
						ctx.ui.notify("Usage: /memory delete <id>", "warning");
						return;
					}
					const entry = index.memories.find(
						(m) => m.id === id || m.id.endsWith(`-${id}`)
					);
					if (!entry) {
						ctx.ui.notify(`Memory not found: ${id}`, "error");
						return;
					}
					deleteMemoryFile(entry.id, cwd);
					removeIndexEntry(index, entry.id);
					saveIndex(index, cwd);
					setCachedIndex(cwd, index);
					ctx.ui.notify(`Deleted memory: ${entry.id}`, "info");
					if (ctx.hasUI) ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
					break;
				}

				case "search": {
					const query = rest.toLowerCase();
					if (!query) {
						ctx.ui.notify("Usage: /memory search <query>", "warning");
						return;
					}
					const keywords = extractKeywords(query);
					const results = index.memories.filter((m) => {
						const text = (m.summary + " " + m.tags.join(" ")).toLowerCase();
						return keywords.some((k) => text.includes(k));
					});
					ctx.ui.notify(`Found ${results.length} memories:\n${formatMemoryTable(results)}`, "info");
					break;
				}

				case "stats": {
					const stats = getMemoryStats(index);
					const lines = [
						`Workspace Memory Stats`,
						`Total: ${stats.total} / ${stats.maxAllowed}`,
						`Total recalls: ${stats.totalRecalls}`,
						`By template:`,
					];
					for (const [t, count] of Object.entries(stats.byTemplate)) {
						lines.push(`  - ${t}: ${count}`);
					}
					if (stats.topRecalled) {
						lines.push(`Top recalled: ${stats.topRecalled.summary.slice(0, 40)} (${stats.topRecalled.recallCount} recalls)`);
					}
					ctx.ui.notify(lines.join("\n"), "info");
					break;
				}

				default: {
					ctx.ui.notify("Unknown subcommand. Usage: /memory list | show <id> | save <text> | delete <id> | search <query> | stats", "warning");
				}
			}
		},
	});
}
