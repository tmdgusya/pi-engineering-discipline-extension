/**
 * Type definitions for workspace-memory extension
 */

export type MemoryTemplate = "post-mortem" | "decision-record" | "compact-note";

export interface MemoryIndexEntry {
	id: string;
	file: string;
	template: MemoryTemplate;
	summary: string;
	tags: string[];
	createdAt: string;
	lastRecalledAt: string | null;
	recallCount: number;
	score: number;
}

export interface MemoryIndex {
	version: number;
	workspace: string;
	lastUpdated: string;
	memories: MemoryIndexEntry[];
}

export interface MemoryMetadata {
	createdAt: string;
	tags: string[];
	triggerKeywords: string[];
}

export interface PostMortemContent {
	problem: string;
	rootCause: string;
	fix: string;
	prevention: string;
}

export interface DecisionRecordContent {
	context: string;
	decision: string;
	rationale: string;
	alternativesConsidered: string;
}

export interface CompactNoteContent {
	summary: string;
	keyPoints: string[];
}

export type MemoryContent = PostMortemContent | DecisionRecordContent | CompactNoteContent;

export interface Memory {
	id: string;
	template: MemoryTemplate;
	metadata: MemoryMetadata;
	content: MemoryContent;
}

export interface MemorySaveInput {
	content: string;
	template: MemoryTemplate;
	tags?: string[];
}

export interface KeywordTemplateMapping {
	keywords: string[];
	template: MemoryTemplate;
	prompt: string;
}
