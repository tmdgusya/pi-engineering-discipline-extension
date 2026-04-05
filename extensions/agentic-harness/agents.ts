import { readdir, readFile } from "fs/promises";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "bundled" | "user" | "project";
  filePath: string;
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
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
        tools: frontmatter.tools
          ? frontmatter.tools.split(",").map((t) => t.trim())
          : undefined,
        model: frontmatter.model || undefined,
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
