import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import workspaceMemoryExtension from "../index.js";
import { invalidateCache } from "../storage.js";

vi.mock("@mariozechner/pi-coding-agent", () => ({
	getAgentDir: vi.fn(),
}));

import { getAgentDir } from "@mariozechner/pi-coding-agent";

const mockedGetAgentDir = vi.mocked(getAgentDir);
const tempRoots: string[] = [];

function createTempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "workspace-memory-e2e-"));
	tempRoots.push(root);
	return root;
}

function createMockPi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any[]>();

	const mockPi: any = {
		registerTool: (def: any) => tools.set(def.name, def),
		registerCommand: (name: string, def: any) => commands.set(name, def),
		on: (event: string, handler: any) => {
			if (!events.has(event)) events.set(event, []);
			events.get(event)!.push(handler);
		},
	};

	return { mockPi, tools, commands, events };
}

afterEach(() => {
	for (const root of tempRoots.splice(0, tempRoots.length)) {
		rmSync(root, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});

describe("workspace-memory integration flow", () => {
	it("saves memory, exposes slash command output, and injects recalled context", async () => {
		const root = createTempRoot();
		mockedGetAgentDir.mockReturnValue(root);

		const cwd = "/tmp/workspace-memory-integration";
		invalidateCache(cwd);

		const statusCalls: Array<{ key: string; value: string | undefined }> = [];
		const notifications: Array<{ message: string; level: string }> = [];

		const ctx: any = {
			cwd,
			hasUI: true,
			ui: {
				setStatus: (key: string, value: string | undefined) => {
					statusCalls.push({ key, value });
				},
				notify: (message: string, level: string) => {
					notifications.push({ message, level });
				},
			},
		};

		const { mockPi, tools, commands, events } = createMockPi();
		workspaceMemoryExtension(mockPi);

		await events.get("session_start")?.[0]?.({ type: "session_start" }, ctx);

		const saveResult = await tools
			.get("memory_save")
			.execute("call-1", { content: "Problem: bug in parser\nFix: apply patch" }, undefined, undefined, ctx);

		expect(saveResult.content[0].text).toContain("Memory saved successfully.");
		expect(statusCalls.some((call) => call.key === "memory" && call.value?.includes("💾 1"))).toBe(true);

		await commands.get("memory").handler("list", ctx);
		expect(notifications.some((n) => n.message.includes("| ID | Template | Summary | Recalls | Score |"))).toBe(true);

		const beforeResult = await events
			.get("before_agent_start")?.[0]?.(
				{ type: "before_agent_start", prompt: "parser bug fix regression", systemPrompt: "BASE" },
				ctx
			);

		expect(beforeResult?.systemPrompt).toContain("BASE");
		expect(beforeResult?.systemPrompt).toContain("## Workspace Memories");
		expect(beforeResult?.systemPrompt).toContain("<workspace_memories>");
	});
});
