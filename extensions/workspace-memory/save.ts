/**
 * Unified memory creation and persistence
 */

import type { Memory, MemoryIndexEntry, MemoryTemplate } from "./types";
import {
	getCachedIndex,
	setCachedIndex,
	saveMemory,
	saveIndex,
	deleteMemoryFile,
	generateMemoryId,
	upsertIndexEntry,
} from "./storage";
import { parseMemoryContent, getSummary, normalizeTemplate } from "./utils";
import { detectKeywords, selectTemplateFromKeywords } from "./templates";
import { recalculateAllScores, evictIfNeeded } from "./scoring";

export interface CreateMemoryInput {
	content: string;
	template?: string;
	tags?: string[];
}

export interface CreateMemoryResult {
	memory: Memory;
	entry: MemoryIndexEntry;
	evictedCount: number;
}

/**
 * Create a new memory, persist it, and handle eviction if over limit.
 * This is the single source of truth for saving memories from both
 * the LLM tool and the /memory command.
 */
export function createAndSaveMemory(
	input: CreateMemoryInput,
	cwd: string
): CreateMemoryResult {
	const index = getCachedIndex(cwd);

	const detectedKeywords = detectKeywords(input.content);
	const template: MemoryTemplate =
		input.template
			? normalizeTemplate(input.template)
			: selectTemplateFromKeywords(detectedKeywords);

	const memoryId = generateMemoryId();
	const now = new Date().toISOString();
	const structuredContent = parseMemoryContent(input.content, template);
	const tags = [...new Set([...(input.tags || []), ...detectedKeywords])].slice(0, 10);

	const summary = getSummary(structuredContent, template);

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

	// Persist memory file
	saveMemory(memory, cwd);

	// Update index
	upsertIndexEntry(index, entry);

	// Recalculate scores and evict if needed
	recalculateAllScores(index);
	const evicted = evictIfNeeded(index, cwd);

	// Persist index BEFORE deleting evicted files (crash safety)
	saveIndex(index, cwd);
	setCachedIndex(cwd, index);

	// Delete evicted files after index is saved
	for (const mem of evicted) {
		deleteMemoryFile(mem.id, cwd);
	}

	return {
		memory,
		entry,
		evictedCount: evicted.length,
	};
}
