/**
 * Storage layer for workspace-memory extension
 * Handles file I/O for memory index and individual memory files
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { Memory, MemoryIndex, MemoryIndexEntry } from "./types";

const MEMORY_DIR_NAME = "memory";
const INDEX_FILE = "index.json";
const CURRENT_INDEX_VERSION = 1;
const DEFAULT_INDEX: MemoryIndex = {
	version: CURRENT_INDEX_VERSION,
	workspace: "",
	lastUpdated: new Date().toISOString(),
	memories: [],
};

const VALID_ID_REGEX = /^mem-\d+-[a-z0-9]+$/;

// ---------------------------------------------------------------------------
// Per-workspace index cache
// ---------------------------------------------------------------------------

const indexCache = new Map<string, MemoryIndex>();

export function getCachedIndex(cwd: string): MemoryIndex {
	if (!indexCache.has(cwd)) {
		const index = loadIndex(cwd);
		indexCache.set(cwd, index);
	}
	return indexCache.get(cwd)!;
}

export function setCachedIndex(cwd: string, index: MemoryIndex): void {
	indexCache.set(cwd, index);
}

export function invalidateCache(cwd: string): void {
	indexCache.delete(cwd);
}

export function validateMemoryId(id: string): void {
	if (!VALID_ID_REGEX.test(id)) {
		throw new Error(`Invalid memory ID: ${id}`);
	}
}

/**
 * Encode cwd to safe filesystem path (same pattern as sessionManager)
 */
export function encodeCwd(cwd: string): string {
	return `--${cwd.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
}

/**
 * Get the memory directory for a given workspace cwd
 */
export function getMemoryDir(cwd: string): string {
	return join(getAgentDir(), MEMORY_DIR_NAME, encodeCwd(cwd));
}

/**
 * Ensure memory directory exists
 */
export function ensureMemoryDir(cwd: string): void {
	const dir = getMemoryDir(cwd);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
}

/**
 * Load memory index for workspace
 */
export function loadIndex(cwd: string): MemoryIndex {
	const dir = getMemoryDir(cwd);
	const indexPath = join(dir, INDEX_FILE);

	if (!existsSync(indexPath)) {
		return { ...DEFAULT_INDEX, workspace: cwd };
	}

	try {
		const raw = readFileSync(indexPath, "utf8");
		const parsed = JSON.parse(raw) as MemoryIndex;
		// Validate basic structure
		if (!parsed.memories || !Array.isArray(parsed.memories)) {
			return { ...DEFAULT_INDEX, workspace: cwd };
		}
		return parsed;
	} catch {
		return { ...DEFAULT_INDEX, workspace: cwd };
	}
}

/**
 * Save memory index for workspace
 */
export function saveIndex(index: MemoryIndex, cwd: string): void {
	ensureMemoryDir(cwd);
	const dir = getMemoryDir(cwd);
	const indexPath = join(dir, INDEX_FILE);
	index.lastUpdated = new Date().toISOString();
	writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
}

/**
 * Generate a unique memory ID
 */
export function generateMemoryId(): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 6);
	return `mem-${timestamp}-${random}`;
}

/**
 * Load full memory content by ID
 */
export function loadMemory(id: string, cwd: string): Memory | null {
	validateMemoryId(id);
	const dir = getMemoryDir(cwd);
	const filePath = join(dir, `${id}.json`);

	if (!existsSync(filePath)) {
		return null;
	}

	try {
		const raw = readFileSync(filePath, "utf8");
		return JSON.parse(raw) as Memory;
	} catch {
		return null;
	}
}

/**
 * Save full memory content
 */
export function saveMemory(memory: Memory, cwd: string): void {
	validateMemoryId(memory.id);
	ensureMemoryDir(cwd);
	const dir = getMemoryDir(cwd);
	const filePath = join(dir, `${memory.id}.json`);
	writeFileSync(filePath, JSON.stringify(memory, null, 2), { encoding: "utf8", mode: 0o600 });
}

/**
 * Delete memory file by ID
 */
export function deleteMemoryFile(id: string, cwd: string): void {
	validateMemoryId(id);
	const dir = getMemoryDir(cwd);
	const filePath = join(dir, `${id}.json`);
	if (existsSync(filePath)) {
		try {
			unlinkSync(filePath);
		} catch {
			// Ignore deletion errors
		}
	}
}

/**
 * Add or update a memory index entry
 */
export function upsertIndexEntry(
	index: MemoryIndex,
	entry: MemoryIndexEntry
): void {
	const existingIdx = index.memories.findIndex((m) => m.id === entry.id);
	if (existingIdx >= 0) {
		index.memories[existingIdx] = entry;
	} else {
		index.memories.push(entry);
	}
	index.lastUpdated = new Date().toISOString();
}

/**
 * Remove a memory index entry
 */
export function removeIndexEntry(index: MemoryIndex, id: string): boolean {
	const initialLen = index.memories.length;
	index.memories = index.memories.filter((m) => m.id !== id);
	if (index.memories.length < initialLen) {
		index.lastUpdated = new Date().toISOString();
		return true;
	}
	return false;
}
