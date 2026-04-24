import { mkdir, open, stat, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "path";

export interface ArtifactContext {
  rootDir: string;
  runDir: string;
  outputFile?: string;
  progressFile?: string;
  readFiles: string[];
}

export interface BoundedReadResult {
  text: string;
  originalBytes: number;
  truncated: boolean;
}

export interface ArtifactOptions {
  cwd: string;
  rootRunId: string;
  runId: string;
  agentName: string;
  output?: string;
  reads?: string[];
  progress?: string;
}

function baseRunsDir(cwd: string): string {
  return process.env.PI_SUBAGENT_ARTIFACT_ROOT || join(cwd, ".pi", "agent", "runs");
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveArtifactPath(runDir: string, value: string): string {
  if (isAbsolute(value) || value === "~" || value.startsWith("~/")) {
    throw new Error(`Artifact paths must be relative to the run directory: ${value}`);
  }
  const target = resolve(runDir, value);
  if (!isInside(runDir, target)) {
    throw new Error(`Artifact path escapes the run directory: ${value}`);
  }
  return target;
}

export function resolveDeclaredReadPath(cwd: string, value: string): string {
  if (isAbsolute(value) || value === "~" || value.startsWith("~/")) {
    throw new Error(`Declared reads must be workspace-relative paths: ${value}`);
  }
  const target = resolve(cwd, value);
  if (!isInside(resolve(cwd), target)) {
    throw new Error(`Declared read path escapes the workspace: ${value}`);
  }
  return target;
}

export async function createArtifactContext(options: ArtifactOptions): Promise<ArtifactContext> {
  const rootDir = resolve(baseRunsDir(options.cwd), sanitizeSegment(options.rootRunId));
  const runDir = join(rootDir, "subagents", `${sanitizeSegment(options.agentName)}-${sanitizeSegment(options.runId)}`);
  await mkdir(runDir, { recursive: true });

  const outputFile = options.output ? resolveArtifactPath(runDir, options.output) : undefined;
  const progressFile = options.progress ? resolveArtifactPath(runDir, options.progress) : undefined;
  const readFiles = (options.reads || []).map((path) => resolveDeclaredReadPath(options.cwd, path));

  for (const file of [outputFile, progressFile]) {
    if (file) await mkdir(dirname(file), { recursive: true });
  }
  await writeFile(join(runDir, "run.json"), `${JSON.stringify({
    agentName: options.agentName,
    runId: options.runId,
    rootRunId: options.rootRunId,
    cwd: options.cwd,
    outputFile,
    progressFile,
    readFiles,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf-8");

  return { rootDir, runDir, outputFile, progressFile, readFiles };
}

export function describeRelative(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

export async function readFilePrefix(file: string, maxBytes: number): Promise<BoundedReadResult> {
  const info = await stat(file);
  const bytesToRead = Math.min(info.size, Math.max(0, maxBytes));
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf-8"),
      originalBytes: info.size,
      truncated: info.size > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

export async function readDeclaredFiles(files: string[], cwd: string, maxBytesPerFile = 24000): Promise<string> {
  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = await readFilePrefix(file, maxBytesPerFile);
      const displayed = content.truncated
        ? `${content.text}\n\n[truncated read: ${content.originalBytes} -> ${maxBytesPerFile} bytes]`
        : content.text;
      sections.push(`### ${describeRelative(cwd, file)}\n\n\`\`\`\n${displayed}\n\`\`\``);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        sections.push(`### ${describeRelative(cwd, file)}\n[missing]`);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      sections.push(`### ${describeRelative(cwd, file)}\n[error reading file: ${message}]`);
    }
  }
  return sections.length > 0 ? `\n\nDeclared read files:\n${sections.join("\n\n")}` : "";
}
