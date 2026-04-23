/**
 * Workspace Memory Extension for pi
 *
 * Automatically detects important moments in conversation, saves them as
 * structured workspace-scoped memory, and efficiently recalls them in
 * future related conversations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCachedIndex, setCachedIndex, saveIndex } from "./storage";
import { detectKeywords, selectTemplateFromKeywords, TEMPLATE_LABELS } from "./templates";
import { recallMemories } from "./recall";
import { createAndSaveMemory } from "./save";
import { handleMemoryCommand } from "./commands";

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
		const { text: memoryContext, recalledIds } = await recallMemories(
			index,
			promptText,
			ctx.cwd
		);

		// Save index if any recalls happened (score updates)
		if (recalledIds.length > 0) {
			saveIndex(index, ctx.cwd);
			ctx.ui.setStatus("memory", `💾 ${index.memories.length} (${recalledIds.length} recalled)`);
		}

		const basePrompt = event.systemPrompt || "";
		let systemPrompt = basePrompt;

		// Inject recalled memories into system prompt
		if (memoryContext) {
			systemPrompt = basePrompt + "\n\n" + memoryContext;
		}

		// If trigger keywords detected, suggest saving memory
		if (keywords.length > 0) {
			const template = selectTemplateFromKeywords(keywords);
			const label = TEMPLATE_LABELS[template];
			const hint =
				`\n\n[System Note: This conversation contains keywords related to "${keywords.join(", ")}". ` +
				`If you resolved an issue, made an important decision, or learned something valuable, ` +
				`please use the \`memory_save\` tool to record it as a "${label}" for future reference.]`;
			systemPrompt = systemPrompt + hint;
		}

		return systemPrompt !== basePrompt ? { systemPrompt } : undefined;
	});

	// --- Tool: memory_save ---
	pi.registerTool({
		name: "memory_save",
		label: "Save Memory",
		description:
			"Save an important finding, bug fix, decision, or insight to workspace memory for future recall.",
		promptSnippet: "Save important workspace findings to memory for future recall",
		promptGuidelines: [
			"Use memory_save after resolving bugs, making decisions, or discovering important patterns.",
			"Be specific: include file names, error messages, root causes, and fixes.",
			"The system will automatically recall relevant memories in future conversations.",
		],
		parameters: Type.Object({
			content: Type.String({
				description:
					"Structured memory content. For post-mortem: Problem, Root Cause, Fix, Prevention. For decision: Context, Decision, Rationale, Alternatives.",
			}),
			template: Type.Optional(
				Type.String({
					description:
						"Memory template type: post-mortem, decision-record, or compact-note. Auto-detected if omitted.",
				})
			),
			tags: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional tags for categorization (e.g., ['bug', 'redis', 'performance'])",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { memory, evictedCount } = createAndSaveMemory(
				{
					content: params.content,
					template: params.template,
					tags: params.tags,
				},
				ctx.cwd
			);

			if (ctx.hasUI) {
				const index = getCachedIndex(ctx.cwd);
				ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
			}

			let message = `Memory saved successfully.\nID: ${memory.id}\nTemplate: ${memory.template}\nTags: ${memory.metadata.tags.join(", ") || "none"}`;
			if (evictedCount > 0) {
				message += `\n(${evictedCount} old memories evicted to stay within limit)`;
			}

			return {
				content: [{ type: "text", text: message }],
				details: { memoryId: memory.id, template: memory.template, tags: memory.metadata.tags },
			};
		},
	});

	// --- Commands ---
	pi.registerCommand("memory", {
		description:
			"Workspace memory commands. Usage: /memory list | show <id> | save <text> | delete <id> | search <query> | stats",
		handler: handleMemoryCommand,
	});
}
