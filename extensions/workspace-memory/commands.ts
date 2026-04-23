/**
 * /memory slash-command handlers
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	getCachedIndex,
	setCachedIndex,
	saveIndex,
	loadMemory,
	deleteMemoryFile,
	removeIndexEntry,
} from "./storage";
import { formatMemoryTable } from "./utils";
import { extractKeywords } from "./recall";
import { createAndSaveMemory } from "./save";
import { getMemoryStats } from "./scoring";

export async function handleMemoryCommand(
	args: string,
	ctx: ExtensionCommandContext
): Promise<void> {
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
			const entry = index.memories.find(
				(m) => m.id === id || m.id.endsWith(`-${id}`)
			);
			if (!entry) {
				ctx.ui.notify(`Memory not found: ${id}`, "error");
				return;
			}
			const mem = loadMemory(entry.id, cwd);
			if (!mem) {
				// Clean up orphan entry
				removeIndexEntry(index, entry.id);
				saveIndex(index, cwd);
				setCachedIndex(cwd, index);
				ctx.ui.notify(`Memory file missing: ${entry.id} (removed from index)`, "error");
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
			const { memory, evictedCount } = createAndSaveMemory({ content: text }, cwd);
			let msg = `Memory saved: ${memory.id} (${memory.template})`;
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
}
