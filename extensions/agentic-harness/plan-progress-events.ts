import { readFile } from "fs/promises";
import { isAbsolute, resolve } from "path";
import { parsePlan } from "./plan-parser.js";
import type { PlanProgressTracker } from "./plan-progress.js";

export type PlanLoadOptions = {
  text?: string;
  path?: string;
  cwd?: string;
};

export type PlanToolResultEvent = {
  toolName: string;
  input?: Record<string, unknown>;
  content?: unknown;
};


const ENGINEERING_PLAN_PATH_RE = /(?:^|\/)docs\/engineering-discipline\/plans\/[^/\s"'`<>),]+\.md$/i;
const GENERIC_PLAN_PATH_RE = /(?:^|\/)(?:plans|plan)\/[^/\s"'`<>),]+\.md$/i;
const ENGINEERING_PLAN_PATH_IN_TEXT_RE = /(?:[^\s"'`<>),]*docs\/engineering-discipline\/plans\/[^\s"'`<>),]+\.md)/gi;

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isPlanMarkdownPath(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return ENGINEERING_PLAN_PATH_RE.test(normalized) || GENERIC_PLAN_PATH_RE.test(normalized);
}

function hasPlanTasks(markdown: string): boolean {
  try {
    return parsePlan(markdown).tasks.length > 0;
  } catch {
    return false;
  }
}

function resolvePlanPath(filePath: string, cwd?: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd ?? process.cwd(), filePath);
}

function addPlanPath(paths: string[], candidate: unknown): void {
  if (typeof candidate !== "string") return;
  if (!isPlanMarkdownPath(candidate)) return;
  if (!paths.includes(candidate)) paths.push(candidate);
}

function addTaskTextPlanPaths(paths: string[], taskText: unknown): void {
  if (typeof taskText !== "string") return;
  for (const match of taskText.matchAll(ENGINEERING_PLAN_PATH_IN_TEXT_RE)) {
    addPlanPath(paths, match[0]);
  }
}

function addReads(paths: string[], reads: unknown): void {
  if (!Array.isArray(reads)) return;
  for (const readPath of reads) addPlanPath(paths, readPath);
}

function addSubagentItems(paths: string[], items: unknown): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    addPlanPath(paths, record.planFile);
    addReads(paths, record.reads);
    addTaskTextPlanPaths(paths, record.task);
  }
}

export function extractPlanPathsFromArgs(args: unknown): string[] {
  const paths: string[] = [];
  if (!args || typeof args !== "object") return paths;

  const record = args as Record<string, unknown>;
  addPlanPath(paths, record.planFile);
  addReads(paths, record.reads);
  addTaskTextPlanPaths(paths, record.task);
  addSubagentItems(paths, record.tasks);
  addSubagentItems(paths, record.chain);

  return paths;
}

export function extractToolResultText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const textContent = content.find((item) => {
    return !!item && typeof item === "object" && (item as { type?: unknown }).type === "text";
  }) as { text?: unknown } | undefined;
  return typeof textContent?.text === "string" ? textContent.text : undefined;
}

export function getToolExecutionArgs(
  event: unknown,
  storedArgs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (event && typeof event === "object" && "args" in event) {
    const args = (event as { args?: unknown }).args;
    if (args && typeof args === "object") {
      return args as Record<string, unknown>;
    }
  }
  return storedArgs;
}

export async function loadPlanFromTextOrFile(
  tracker: PlanProgressTracker,
  options: PlanLoadOptions,
): Promise<boolean> {
  if (options.text && hasPlanTasks(options.text)) {
    tracker.loadPlan(options.text);
    return true;
  }

  if (!options.path || !isPlanMarkdownPath(options.path)) return false;

  try {
    const fileText = await readFile(resolvePlanPath(options.path, options.cwd), "utf-8");
    if (!hasPlanTasks(fileText)) return false;
    tracker.loadPlan(fileText);
    return true;
  } catch {
    return false;
  }
}

export async function loadPlanFromToolResultEvent(
  tracker: PlanProgressTracker,
  event: PlanToolResultEvent,
  cwd?: string,
): Promise<boolean> {
  if (event.toolName !== "read" && event.toolName !== "write") return false;

  const filePath = event.input?.path;
  if (typeof filePath !== "string" || !isPlanMarkdownPath(filePath)) return false;

  const text = event.toolName === "write"
    ? (typeof event.input?.content === "string" ? event.input.content : undefined)
    : extractToolResultText(event.content);

  return loadPlanFromTextOrFile(tracker, { text, path: filePath, cwd });
}

export async function reloadPlanFromSubagentArgs(
  tracker: PlanProgressTracker,
  args: unknown,
  cwd?: string,
): Promise<boolean> {
  for (const planPath of extractPlanPathsFromArgs(args)) {
    if (await loadPlanFromTextOrFile(tracker, { path: planPath, cwd })) {
      return true;
    }
  }
  return false;
}

function subagentItemRecords(args: unknown): Record<string, unknown>[] {
  if (!args || typeof args !== "object") return [];

  const record = args as Record<string, unknown>;
  const items: Record<string, unknown>[] = [];

  if (typeof record.agent === "string" || typeof record.task === "string") {
    items.push(record);
  }

  for (const key of ["tasks", "chain"] as const) {
    const nested = record[key];
    if (!Array.isArray(nested)) continue;
    for (const item of nested) {
      if (item && typeof item === "object") {
        items.push(item as Record<string, unknown>);
      }
    }
  }

  return items;
}

function taskText(item: Record<string, unknown>): string {
  return typeof item.task === "string" ? item.task : "";
}

export function startPlanSubagentTasks(
  tracker: PlanProgressTracker,
  args: unknown,
): number[] {
  if (!tracker.hasPlan()) return [];

  const matchedIds: number[] = [];
  for (const item of subagentItemRecords(args)) {
    const matchedId = tracker.startTaskByMatch(taskText(item));
    if (matchedId !== null) matchedIds.push(matchedId);
  }
  return matchedIds;
}

export function completePlanSubagentTasks(
  tracker: PlanProgressTracker,
  args: unknown,
  success: boolean,
  matchedTaskIds?: number[],
): number[] {
  if (!tracker.hasPlan()) return [];

  if (matchedTaskIds && matchedTaskIds.length > 0) {
    for (const taskId of matchedTaskIds) {
      tracker.completeTask(taskId, success);
    }
    return matchedTaskIds;
  }

  const completedIds: number[] = [];
  for (const item of subagentItemRecords(args)) {
    const matchedId = tracker.completeTaskByMatch(taskText(item), success);
    if (matchedId !== null) completedIds.push(matchedId);
  }
  return completedIds;
}
