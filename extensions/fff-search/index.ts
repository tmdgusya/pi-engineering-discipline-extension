/**
 * pi-fff: FFF-powered file search extension for pi
 *
 * Overrides built-in `find` and `grep` tools with FFF and can also replace
 * @-mention autocomplete suggestions in the interactive editor.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	CustomEditor,
	createFindToolDefinition,
	createGrepToolDefinition,
	getAgentDir,
	truncateHead,
	DEFAULT_MAX_BYTES,
	formatSize,
} from "@mariozechner/pi-coding-agent";
import { Text, type AutocompleteItem, type AutocompleteProvider, type AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { FileFinder } from "@ff-labs/fff-node";
import type { GrepCursor, GrepMode, GrepResult, SearchResult } from "@ff-labs/fff-node";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FFF_DB_DIR = join(getAgentDir(), "fff");
const FRECENCY_DB_PATH = join(FFF_DB_DIR, "frecency.mdb");
const HISTORY_DB_PATH = join(FFF_DB_DIR, "history.mdb");
const CONFIG_PATH = join(FFF_DB_DIR, "config.json");

const DEFAULT_GREP_LIMIT = 100;
const DEFAULT_FIND_LIMIT = 200;
const GREP_MAX_LINE_LENGTH = 500;
const MENTION_MAX_RESULTS = 20;

type FffMode = "both" | "tools-only";

// ---------------------------------------------------------------------------
// Cursor store — maps opaque IDs to GrepCursor values across tool calls
// ---------------------------------------------------------------------------

class CursorStore {
	private cursors = new Map<string, GrepCursor>();
	private counter = 0;

	store(cursor: GrepCursor): string {
		const id = `fff_c${++this.counter}`;
		this.cursors.set(id, cursor);
		if (this.cursors.size > 200) {
			const first = this.cursors.keys().next().value;
			if (first) this.cursors.delete(first);
		}
		return id;
	}

	get(id: string): GrepCursor | undefined {
		return this.cursors.get(id);
	}
}

// ---------------------------------------------------------------------------
// Output formatting helpers
// ---------------------------------------------------------------------------

function truncateLine(line: string, max = GREP_MAX_LINE_LENGTH): string {
	const trimmed = line.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max)}...`;
}

function formatGrepOutput(result: GrepResult, limit: number): string {
	const items = result.items.slice(0, limit);
	if (items.length === 0) return "No matches found";

	const lines: string[] = [];
	let currentFile = "";

	for (const match of items) {
		if (match.relativePath !== currentFile) {
			currentFile = match.relativePath;
			if (lines.length > 0) lines.push("");
		}

		if (match.contextBefore && match.contextBefore.length > 0) {
			const startLine = match.lineNumber - match.contextBefore.length;
			for (let i = 0; i < match.contextBefore.length; i++) {
				lines.push(`${match.relativePath}-${startLine + i}- ${truncateLine(match.contextBefore[i])}`);
			}
		}

		lines.push(`${match.relativePath}:${match.lineNumber}: ${truncateLine(match.lineContent)}`);

		if (match.contextAfter && match.contextAfter.length > 0) {
			const startLine = match.lineNumber + 1;
			for (let i = 0; i < match.contextAfter.length; i++) {
				lines.push(`${match.relativePath}-${startLine + i}- ${truncateLine(match.contextAfter[i])}`);
			}
		}
	}

	return lines.join("\n");
}

function formatFindOutput(result: SearchResult, limit: number): string {
	const items = result.items.slice(0, limit);
	if (items.length === 0) return "No files found matching pattern";
	return items.map((item) => item.relativePath).join("\n");
}

// ---------------------------------------------------------------------------
// Mention autocomplete replacement helpers
// ---------------------------------------------------------------------------

function extractAtPrefix(textBeforeCursor: string): string | null {
	const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
	return match?.[1] ?? null;
}

function parseAtPrefix(prefix: string): { raw: string; quoted: boolean } {
	if (prefix.startsWith('@"')) {
		return { raw: prefix.slice(2), quoted: true };
	}
	return { raw: prefix.slice(1), quoted: false };
}

function buildAtCompletionValue(path: string, quotedPrefix: boolean): string {
	if (quotedPrefix || path.includes(" ")) {
		return `@"${path}"`;
	}
	return `@${path}`;
}

class FffAtMentionProvider implements AutocompleteProvider {
	constructor(
		private base: AutocompleteProvider,
		private getItems: (query: string, quotedPrefix: boolean, signal: AbortSignal) => Promise<AutocompleteItem[]>,
	) {}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<AutocompleteSuggestions | null> {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		const atPrefix = extractAtPrefix(textBeforeCursor);

		if (!atPrefix) {
			return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		}

		const { raw, quoted } = parseAtPrefix(atPrefix);
		if (options.signal.aborted) return null;

		try {
			const items = await this.getItems(raw, quoted, options.signal);
			if (options.signal.aborted) return null;
			if (items.length === 0) return null;
			return { items, prefix: atPrefix };
		} catch {
			// If FFF lookup fails unexpectedly, fall back to built-in provider.
			return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		}
	}

	applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
		return this.base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
}

class FffEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		keybindings: any,
		private createProvider: (base: AutocompleteProvider) => AutocompleteProvider,
	) {
		super(tui, theme, keybindings);
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		super.setAutocompleteProvider(this.createProvider(provider));
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function fffExtension(pi: ExtensionAPI) {
	let finder: FileFinder | null = null;
	let finderCwd: string | null = null;
	let activeCwd = process.cwd();
	const cursorStore = new CursorStore();
	const nativeFffAvailable = FileFinder.isAvailable();

	try {
		mkdirSync(FFF_DB_DIR, { recursive: true });
	} catch {
		// ignore
	}

	function normalizeMode(value: string | undefined): FffMode {
		return value === "tools-only" ? "tools-only" : "both";
	}

	function readConfigMode(): FffMode {
		try {
			if (!existsSync(CONFIG_PATH)) return "both";
			const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { mode?: string };
			return normalizeMode(parsed.mode);
		} catch {
			return "both";
		}
	}

	function writeConfigMode(mode: FffMode): void {
		try {
			writeFileSync(CONFIG_PATH, JSON.stringify({ mode }, null, 2), "utf8");
		} catch {
			// ignore
		}
	}

	function getMode(): FffMode {
		const flag = pi.getFlag("fff-mode");
		if (typeof flag === "string" && flag.length > 0) {
			return normalizeMode(flag);
		}
		if (process.env.PI_FFF_MODE) {
			return normalizeMode(process.env.PI_FFF_MODE);
		}
		return readConfigMode();
	}

	function resolveRuntimeCwd(ctx?: ExtensionContext): string {
		if (ctx?.cwd && ctx.cwd.length > 0) {
			activeCwd = ctx.cwd;
		}
		return activeCwd;
	}

	async function getFinderOrNull(cwd: string): Promise<FileFinder | null> {
		if (!nativeFffAvailable) return null;
		try {
			return await ensureFinder(cwd);
		} catch {
			return null;
		}
	}

	async function executeFallbackFind(toolCallId: string, params: { pattern: string; path?: string; limit?: number }, signal: AbortSignal | undefined, ctx: ExtensionContext) {
		const fallback = createFindToolDefinition(resolveRuntimeCwd(ctx));
		return fallback.execute(toolCallId, {
			pattern: params.pattern,
			path: params.path,
			limit: params.limit,
		}, signal, undefined, ctx);
	}

	async function executeFallbackGrep(
		toolCallId: string,
		params: { pattern: string; path?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number },
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	) {
		const fallback = createGrepToolDefinition(resolveRuntimeCwd(ctx));
		return fallback.execute(toolCallId, {
			pattern: params.pattern,
			path: params.path,
			ignoreCase: params.ignoreCase,
			literal: params.literal,
			context: params.context,
			limit: params.limit,
		}, signal, undefined, ctx);
	}

	function isFilesystemRoot(cwd: string): boolean {
		const resolved = resolve(cwd);
		return resolved === "/" || resolved === resolve(homedir());
	}

	async function ensureFinder(cwd: string): Promise<FileFinder> {
		if (isFilesystemRoot(cwd)) {
			throw new Error("FFF disabled at top-level directory (/ or $HOME); using built-in search fallback");
		}
		if (finder && !finder.isDestroyed && finderCwd === cwd) return finder;
		if (finder && !finder.isDestroyed && finderCwd !== cwd) {
			finder.destroy();
			finder = null;
			finderCwd = null;
		}

		const result = FileFinder.create({
			basePath: cwd,
			frecencyDbPath: FRECENCY_DB_PATH,
			historyDbPath: HISTORY_DB_PATH,
			aiMode: true,
		});

		if (!result.ok) {
			throw new Error(`Failed to create FFF file finder: ${result.error}`);
		}

		finder = result.value;
		finderCwd = cwd;
		const scanResult = await finder.waitForScan(15000);
		if (scanResult.ok && !scanResult.value) {
			// timed out but finder is still usable with partial index
		}

		return finder;
	}

	function destroyFinder() {
		if (finder && !finder.isDestroyed) {
			finder.destroy();
			finder = null;
			finderCwd = null;
		}
	}

	async function getMentionItems(query: string, quotedPrefix: boolean, signal: AbortSignal): Promise<AutocompleteItem[]> {
		if (signal.aborted) return [];
		const f = await getFinderOrNull(activeCwd);
		if (!f || signal.aborted) return [];

		const searchResult = f.fileSearch(query, { pageSize: MENTION_MAX_RESULTS });
		if (!searchResult.ok) return [];

		return searchResult.value.items.slice(0, MENTION_MAX_RESULTS).map((item) => ({
			value: buildAtCompletionValue(item.relativePath, quotedPrefix),
			label: item.fileName,
			description: item.relativePath,
		}));
	}

	function applyEditorMode(ctx: { ui: { setEditorComponent: (factory: any) => void } }) {
		const mode = getMode();
		if (mode === "tools-only") {
			ctx.ui.setEditorComponent(undefined);
			return;
		}

		ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) =>
			new FffEditor(tui, theme, keybindings, (baseProvider) =>
				new FffAtMentionProvider(baseProvider, getMentionItems),
			),
		);
	}

	// --- Flags / lifecycle ---

	pi.registerFlag("fff-mode", {
		description: "FFF mode: both or tools-only (overrides config/env when provided)",
		type: "string",
	});

	pi.on("session_start", async (_event, ctx) => {
		activeCwd = ctx.cwd;
		if (!nativeFffAvailable) {
			ctx.ui.setEditorComponent(undefined);
			ctx.ui.notify("FFF native engine unavailable; using built-in find/grep tools as fallback where possible.", "warning");
			return;
		}
		if (isFilesystemRoot(activeCwd)) {
			ctx.ui.setEditorComponent(undefined);
			ctx.ui.notify("FFF is disabled at top-level directories (/ or $HOME); built-in find/grep fallback is active.", "info");
			return;
		}
		try {
			await ensureFinder(activeCwd);
			applyEditorMode(ctx);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			ctx.ui.setEditorComponent(undefined);
			ctx.ui.notify(`FFF init failed: ${msg}. Built-in search fallback remains available for find/grep.`, "warning");
		}
	});

	pi.on("context", async (_event, ctx) => {
		activeCwd = ctx.cwd;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setEditorComponent(undefined);
		destroyFinder();
	});

	// --- grep tool (overrides built-in) ---

	const grepSchema = Type.Object({
		pattern: Type.String({ description: "Search pattern (plain text or regex)" }),
		path: Type.Optional(
			Type.String({ description: "Directory or file constraint, e.g. 'src/' or '*.ts' (default: project root)" }),
		),
		ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: smart case)" })),
		literal: Type.Optional(
			Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: true)" }),
		),
		context: Type.Optional(
			Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
		),
		limit: Type.Optional(
			Type.Number({ description: `Maximum number of matches to return (default: ${DEFAULT_GREP_LIMIT})` }),
		),
		cursor: Type.Optional(Type.String({ description: "Cursor from previous result for pagination" })),
	});

	pi.registerTool({
		name: "grep",
		label: "grep (fff)",
		description: [
			`Search file contents for a pattern using FFF (fast, frecency-ranked, git-aware).`,
			`Returns matching lines with file paths and line numbers. Respects .gitignore.`,
			`Supports plain text, regex, and fuzzy search modes. Smart case by default.`,
			`Output truncated to ${DEFAULT_GREP_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB.`,
		].join(" "),
		promptSnippet: "Search file contents for patterns (FFF: frecency-ranked, git-aware, respects .gitignore)",
		promptGuidelines: [
			"Search for bare identifiers (e.g. 'InProgressQuote'), not code syntax or multi-token regex.",
			"Plain text search is faster and more reliable than regex. Prefer it.",
			"After 2 grep calls, read the top result file instead of grepping more.",
			"Use the path parameter for file/directory constraints: '*.ts', 'src/'.",
		],
		parameters: grepSchema,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");

			const cwd = resolveRuntimeCwd(ctx);
			const f = await getFinderOrNull(cwd);
			if (!f) {
				return executeFallbackGrep(_toolCallId, params, signal, ctx);
			}
			const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);

			let query = params.pattern;
			if (params.path) {
				query = `${params.path} ${query}`;
			}

			const isLiteral = params.literal !== false;
			let mode: GrepMode = "plain";
			if (!isLiteral) {
				mode = "regex";
			}

			const prevCursor = params.cursor ? cursorStore.get(params.cursor) : undefined;

			const grepResult = f.grep(query, {
				mode,
				smartCase: params.ignoreCase === true ? false : true,
				maxMatchesPerFile: Math.min(effectiveLimit, 50),
				cursor: prevCursor ?? null,
				beforeContext: params.context ?? 0,
				afterContext: params.context ?? 0,
			});

			if (!grepResult.ok) {
				throw new Error(grepResult.error);
			}

			const result = grepResult.value;
			let output = formatGrepOutput(result, effectiveLimit);

			const truncation = truncateHead(output, { maxLines: Number.MAX_SAFE_INTEGER });
			output = truncation.content;

			const notices: string[] = [];
			if (result.items.length >= effectiveLimit) {
				notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more`);
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
			}
			if (result.regexFallbackError) {
				notices.push(`Regex failed: ${result.regexFallbackError}, used literal match`);
			}
			if (result.nextCursor) {
				const cursorId = cursorStore.store(result.nextCursor);
				notices.push(`More results available. Use cursor="${cursorId}" to continue`);
			}

			if (notices.length > 0) {
				output += `\n\n[${notices.join(". ")}]`;
			}

			return {
				content: [{ type: "text", text: output }],
				details: {
					totalMatched: result.totalMatched,
					totalFiles: result.totalFiles,
					truncated: truncation.truncated,
				},
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const pattern = args?.pattern ?? "";
			const path = args?.path ?? ".";
			let content =
				theme.fg("toolTitle", theme.bold("grep")) +
				" " +
				theme.fg("accent", `/${pattern}/`) +
				theme.fg("toolOutput", ` in ${path}`);
			if (args?.limit !== undefined) content += theme.fg("toolOutput", ` limit ${args.limit}`);
			if (args?.cursor) content += theme.fg("muted", ` (page)`);
			text.setText(content);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const textContent = result.content?.find(
				(c: { type: string; text?: string }) => c.type === "text",
			) as { type: string; text?: string } | undefined;
			const output = textContent?.text?.trim() ?? "";

			if (!output) {
				text.setText(theme.fg("muted", "No output"));
				return text;
			}

			const lines = output.split("\n");
			const maxLines = options.expanded ? lines.length : 15;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;
			let content = `\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
			if (remaining > 0) {
				content += theme.fg("muted", `\n... (${remaining} more lines)`);
			}
			text.setText(content);
			return text;
		},
	});

	// --- find tool (overrides built-in) ---

	const findSchema = Type.Object({
		pattern: Type.String({
			description: "Fuzzy search query for file names. Supports path prefixes ('src/') and globs ('*.ts').",
		}),
		path: Type.Optional(Type.String({ description: "Directory to search in (default: project root)" })),
		limit: Type.Optional(
			Type.Number({ description: `Maximum number of results (default: ${DEFAULT_FIND_LIMIT})` }),
		),
	});

	pi.registerTool({
		name: "find",
		label: "find (fff)",
		description: [
			`Fuzzy file search by name using FFF (fast, frecency-ranked, git-aware).`,
			`Returns matching file paths relative to project root. Respects .gitignore.`,
			`Supports fuzzy matching, path prefixes ('src/'), and glob constraints ('*.ts', '**/*.spec.ts').`,
			`Output truncated to ${DEFAULT_FIND_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB.`,
		].join(" "),
		promptSnippet: "Find files by name (FFF: fuzzy, frecency-ranked, git-aware, respects .gitignore)",
		promptGuidelines: [
			"Keep queries short -- prefer 1-2 terms max.",
			"Multiple words narrow results (waterfall), they are not OR.",
			"Use this to find files by name. Use grep to search file contents.",
		],
		parameters: findSchema,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");

			const cwd = resolveRuntimeCwd(ctx);
			const f = await getFinderOrNull(cwd);
			if (!f) {
				return executeFallbackFind(_toolCallId, params, signal, ctx);
			}
			const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_FIND_LIMIT);

			let query = params.pattern;
			if (params.path) {
				query = `${params.path} ${query}`;
			}

			const searchResult = f.fileSearch(query, {
				pageSize: effectiveLimit,
			});

			if (!searchResult.ok) {
				throw new Error(searchResult.error);
			}

			const result = searchResult.value;
			let output = formatFindOutput(result, effectiveLimit);

			const truncation = truncateHead(output, { maxLines: Number.MAX_SAFE_INTEGER });
			output = truncation.content;

			const notices: string[] = [];
			if (result.items.length >= effectiveLimit) {
				notices.push(
					`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
				);
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
			}
			if (result.totalMatched > result.items.length) {
				notices.push(`${result.totalMatched} total matches (${result.totalFiles} indexed files)`);
			}

			if (notices.length > 0) {
				output += `\n\n[${notices.join(". ")}]`;
			}

			return {
				content: [{ type: "text", text: output }],
				details: {
					totalMatched: result.totalMatched,
					totalFiles: result.totalFiles,
					truncated: truncation.truncated,
				},
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const pattern = args?.pattern ?? "";
			const path = args?.path ?? ".";
			let content =
				theme.fg("toolTitle", theme.bold("find")) +
				" " +
				theme.fg("accent", pattern) +
				theme.fg("toolOutput", ` in ${path}`);
			if (args?.limit !== undefined) content += theme.fg("toolOutput", ` (limit ${args.limit})`);
			text.setText(content);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const textContent = result.content?.find(
				(c: { type: string; text?: string }) => c.type === "text",
			) as { type: string; text?: string } | undefined;
			const output = textContent?.text?.trim() ?? "";

			if (!output) {
				text.setText(theme.fg("muted", "No output"));
				return text;
			}

			const lines = output.split("\n");
			const maxLines = options.expanded ? lines.length : 20;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;
			let content = `\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
			if (remaining > 0) {
				content += theme.fg("muted", `\n... (${remaining} more lines)`);
			}
			text.setText(content);
			return text;
		},
	});

	// --- multi_grep tool ---

	const multiGrepSchema = Type.Object({
		patterns: Type.Array(Type.String(), {
			description:
				"Patterns to search for (OR logic -- matches lines containing ANY pattern). Include all naming conventions: snake_case, PascalCase, camelCase.",
		}),
		constraints: Type.Optional(
			Type.String({
				description: "File constraints, e.g. '*.{ts,tsx} !test/' to filter files. Separate from patterns.",
			}),
		),
		context: Type.Optional(
			Type.Number({ description: "Number of context lines before and after each match (default: 0)" }),
		),
		limit: Type.Optional(
			Type.Number({ description: `Maximum number of matches to return (default: ${DEFAULT_GREP_LIMIT})` }),
		),
		cursor: Type.Optional(Type.String({ description: "Cursor from previous result for pagination" })),
	});

	pi.registerTool({
		name: "multi_grep",
		label: "multi_grep (fff)",
		description: [
			`Search file contents for lines matching ANY of multiple patterns (OR logic).`,
			`Uses SIMD-accelerated Aho-Corasick multi-pattern matching. Faster than regex alternation.`,
			`Patterns are literal text -- never escape special characters.`,
			`Use the constraints parameter for file filtering ('*.rs', 'src/', '!test/').`,
		].join(" "),
		promptSnippet: "Multi-pattern OR search across file contents (FFF: SIMD-accelerated, frecency-ranked)",
		promptGuidelines: [
			"Use multi_grep when you need to find multiple identifiers at once (OR logic).",
			"Include all naming conventions: snake_case, PascalCase, camelCase variants.",
			"Patterns are literal text. Never escape special characters.",
			"Use the constraints parameter for file type/path filtering, not inside patterns.",
		],
		parameters: multiGrepSchema,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			if (!params.patterns || params.patterns.length === 0) {
				throw new Error("patterns array must have at least 1 element");
			}

			const cwd = resolveRuntimeCwd(ctx);
			const f = await getFinderOrNull(cwd);
			if (!f) {
				return {
					content: [{ type: "text", text: "FFF multi_grep requires the native FFF engine to be available for the current workspace." }],
					details: {
						totalMatched: 0,
						totalFiles: 0,
						truncated: false,
						patterns: params.patterns,
					},
				};
			}
			const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
			const prevCursor = params.cursor ? cursorStore.get(params.cursor) : undefined;

			const grepResult = f.multiGrep({
				patterns: params.patterns,
				constraints: params.constraints,
				maxMatchesPerFile: Math.min(effectiveLimit, 50),
				smartCase: true,
				cursor: prevCursor ?? null,
				beforeContext: params.context ?? 0,
				afterContext: params.context ?? 0,
			});

			if (!grepResult.ok) {
				throw new Error(grepResult.error);
			}

			const result = grepResult.value;
			let output = formatGrepOutput(result, effectiveLimit);
			const truncation = truncateHead(output, { maxLines: Number.MAX_SAFE_INTEGER });
			output = truncation.content;

			const notices: string[] = [];
			if (result.items.length >= effectiveLimit) {
				notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more`);
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
			}
			if (result.nextCursor) {
				const cursorId = cursorStore.store(result.nextCursor);
				notices.push(`More results available. Use cursor="${cursorId}" to continue`);
			}

			if (notices.length > 0) {
				output += `\n\n[${notices.join(". ")}]`;
			}

			return {
				content: [{ type: "text", text: output }],
				details: {
					totalMatched: result.totalMatched,
					totalFiles: result.totalFiles,
					truncated: truncation.truncated,
					patterns: params.patterns,
				},
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const patterns = args?.patterns ?? [];
			const constraints = args?.constraints;
			let content =
				theme.fg("toolTitle", theme.bold("multi_grep")) +
				" " +
				theme.fg("accent", patterns.map((p: string) => `"${p}"`).join(", "));
			if (constraints) content += theme.fg("toolOutput", ` (${constraints})`);
			if (args?.cursor) content += theme.fg("muted", ` (page)`);
			text.setText(content);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const textContent = result.content?.find(
				(c: { type: string; text?: string }) => c.type === "text",
			) as { type: string; text?: string } | undefined;
			const output = textContent?.text?.trim() ?? "";

			if (!output) {
				text.setText(theme.fg("muted", "No output"));
				return text;
			}

			const lines = output.split("\n");
			const maxLines = options.expanded ? lines.length : 15;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;
			let content = `\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
			if (remaining > 0) {
				content += theme.fg("muted", `\n... (${remaining} more lines)`);
			}
			text.setText(content);
			return text;
		},
	});

	// --- commands ---

	pi.registerCommand("fff-mode", {
		description: "Set FFF mode: /fff-mode both | tools-only",
		handler: async (args, ctx) => {
			const raw = (args || "").trim();
			if (raw !== "both" && raw !== "tools-only") {
				ctx.ui.notify("Usage: /fff-mode both | tools-only", "warning");
				return;
			}
			writeConfigMode(raw);
			applyEditorMode(ctx);
			ctx.ui.notify(`FFF mode set to '${raw}'`, "info");
		},
	});

	pi.registerCommand("fff-health", {
		description: "Show FFF file finder health and status",
		handler: async (_args, ctx) => {
			if (!nativeFffAvailable) {
				ctx.ui.notify("FFF native engine unavailable. Built-in find/grep fallback is active.", "warning");
				return;
			}
			if (!finder || finder.isDestroyed) {
				ctx.ui.notify("FFF not initialized", "warning");
				return;
			}

			const health = finder.healthCheck();
			if (!health.ok) {
				ctx.ui.notify(`Health check failed: ${health.error}`, "error");
				return;
			}

			const h = health.value;
			const lines = [
				`FFF v${h.version}`,
				`Mode: ${getMode()}`,
				`Git: ${h.git.repositoryFound ? `yes (${h.git.workdir ?? "unknown"})` : "no"}`,
				`Picker: ${h.filePicker.initialized ? `${h.filePicker.indexedFiles ?? 0} files` : "not initialized"}`,
				`Frecency: ${h.frecency.initialized ? "active" : "disabled"}`,
				`Query tracker: ${h.queryTracker.initialized ? "active" : "disabled"}`,
			];

			const progress = finder.getScanProgress();
			if (progress.ok) {
				lines.push(`Scanning: ${progress.value.isScanning ? "yes" : "no"} (${progress.value.scannedFilesCount} files)`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("fff-rescan", {
		description: "Trigger FFF to rescan files",
		handler: async (_args, ctx) => {
			if (!nativeFffAvailable) {
				ctx.ui.notify("FFF native engine unavailable. There is no native index to rescan.", "warning");
				return;
			}
			if (!finder || finder.isDestroyed) {
				ctx.ui.notify("FFF not initialized", "warning");
				return;
			}

			const result = finder.scanFiles();
			if (!result.ok) {
				ctx.ui.notify(`Rescan failed: ${result.error}`, "error");
				return;
			}

			ctx.ui.notify("FFF rescan triggered", "info");
		},
	});
}
