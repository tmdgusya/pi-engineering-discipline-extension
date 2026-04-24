import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export type SubagentContextMode = "fresh" | "fork";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  maxOutput?: number;
  maxSubagentDepth?: number;
  output?: string;
  defaultReads?: string[];
  defaultProgress?: string;
  context?: SubagentContextMode;
  worktree?: boolean;
  systemPrompt: string;
  source: "bundled" | "user" | "project";
  filePath: string;
}

function stripInlineComment(value: string): string {
  let quote: string | undefined;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote || char;
      continue;
    }
    if (char === "#" && !quote) return value.slice(0, i).trim();
  }
  return value.trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).replace(/\\(["'])/g, "$1");
    }
  }
  return trimmed;
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = unquote(stripInlineComment(line.slice(idx + 1)));
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

function parseStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const parts = inner
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  return undefined;
}

function parseContext(value: string | undefined): SubagentContextMode | undefined {
  if (value === "fresh" || value === "fork") return value;
  return undefined;
}

export async function loadAgentsFromDir(
  dir: string,
  source: "bundled" | "user" | "project",
): Promise<AgentConfig[]> {
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(dir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      if (!frontmatter.name || !frontmatter.description) continue;

      agents.push({
        name: frontmatter.name,
        description: frontmatter.description,
        tools: parseStringArray(frontmatter.tools),
        model: frontmatter.model || undefined,
        maxOutput: parsePositiveInteger(frontmatter.maxOutput),
        maxSubagentDepth: parsePositiveInteger(frontmatter.maxSubagentDepth),
        output: frontmatter.output || undefined,
        defaultReads: parseStringArray(frontmatter.defaultReads || frontmatter.reads),
        defaultProgress: frontmatter.defaultProgress || frontmatter.progress || undefined,
        context: parseContext(frontmatter.context),
        worktree: parseBoolean(frontmatter.worktree),
        systemPrompt: body,
        source,
        filePath,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return agents;
}

export async function discoverAgents(
  cwd: string,
  scope: "user" | "project" | "both" = "user",
  bundledDir?: string,
): Promise<AgentConfig[]> {
  const agents = new Map<string, AgentConfig>();

  // Bundled agents (lowest priority — overridden by user and project)
  if (bundledDir) {
    for (const agent of await loadAgentsFromDir(bundledDir, "bundled")) {
      agents.set(agent.name, agent);
    }
  }

  if (scope === "user" || scope === "both") {
    const userDir = join(homedir(), ".pi", "agent", "agents");
    for (const agent of await loadAgentsFromDir(userDir, "user")) {
      agents.set(agent.name, agent);
    }
  }

  if (scope === "project" || scope === "both") {
    let dir = cwd;
    while (true) {
      const projectDir = join(dir, ".pi", "agents");
      if (existsSync(projectDir)) {
        for (const agent of await loadAgentsFromDir(projectDir, "project")) {
          agents.set(agent.name, agent); // project overrides user
        }
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return Array.from(agents.values());
}
