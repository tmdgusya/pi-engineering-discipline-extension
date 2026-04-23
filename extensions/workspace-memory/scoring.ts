/**
 * Scoring and eviction logic for workspace-memory extension
 */

import type { MemoryIndex, MemoryIndexEntry } from "./types";

const MAX_MEMORIES = 200;
const RECENCY_HALFLIFE_DAYS = 30;

/**
 * Calculate days since a given ISO date string
 */
export function daysSince(isoDate: string | null): number {
	if (!isoDate) return Infinity;
	const then = new Date(isoDate).getTime();
	if (Number.isNaN(then)) return Infinity;
	const now = Date.now();
	const diffMs = Math.max(0, now - then);
	return diffMs / (1000 * 60 * 60 * 24);
}

/**
 * Calculate memory score:
 * score = recallCount × exp(-daysSinceLastRecall / 30)
 *
 * Higher score = more valuable (frequently recalled and recently used)
 */
export function calculateScore(entry: MemoryIndexEntry): number {
	const days = daysSince(entry.lastRecalledAt);
	const recencyDecay = Math.exp(-days / RECENCY_HALFLIFE_DAYS);
	return entry.recallCount * recencyDecay;
}

/**
 * Recalculate scores for all memories in index
 */
export function recalculateAllScores(index: MemoryIndex): void {
	for (const entry of index.memories) {
		entry.score = calculateScore(entry);
	}
}

/**
 * Update recall stats for a memory entry after it has been recalled
 */
export function recordRecall(entry: MemoryIndexEntry): void {
	entry.recallCount += 1;
	entry.lastRecalledAt = new Date().toISOString();
	entry.score = calculateScore(entry);
}

/**
 * Evict lowest-scoring memories if count exceeds MAX_MEMORIES
 * Returns evicted memory entries
 */
export function evictIfNeeded(index: MemoryIndex, cwd: string): MemoryIndexEntry[] {
	if (index.memories.length <= MAX_MEMORIES) {
		return [];
	}

	// Ensure all scores are up to date
	recalculateAllScores(index);

	// Sort by score ascending, tie-break by oldest first
	index.memories.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
	});

	const toRemove = index.memories.length - MAX_MEMORIES;
	const evicted = index.memories.splice(0, toRemove);

	// Re-sort by creation date for stable ordering
	index.memories.sort(
		(a, b) =>
			new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);

	return evicted;
}

/**
 * Get memory statistics for display
 */
export function getMemoryStats(index: MemoryIndex) {
	const total = index.memories.length;
	const byTemplate: Record<string, number> = {};
	let totalRecalls = 0;
	let topRecalled: MemoryIndexEntry | null = null;

	for (const mem of index.memories) {
		byTemplate[mem.template] = (byTemplate[mem.template] || 0) + 1;
		totalRecalls += mem.recallCount;
		if (!topRecalled || mem.recallCount > topRecalled.recallCount) {
			topRecalled = mem;
		}
	}

	return {
		total,
		byTemplate,
		totalRecalls,
		topRecalled,
		maxAllowed: MAX_MEMORIES,
	};
}
