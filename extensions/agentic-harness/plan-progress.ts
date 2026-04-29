import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { parsePlan, type ParsedPlan, type PlanTask } from "./plan-parser.js";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TrackedTask extends PlanTask {
  status: TaskStatus;
  startedAt?: number;
  completedAt?: number;
}

export const PLAN_PROGRESS_SPINNER_MS = 400;

type PlanProgressChangeListener = () => void;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function normalizeMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function significantWords(text: string): string[] {
  return normalizeMatchText(text)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

function textMatches(input: string, taskName: string): boolean {
  const normalizedInput = normalizeMatchText(input);
  const normalizedTaskName = normalizeMatchText(taskName);
  if (!normalizedInput || !normalizedTaskName) return false;

  if (
    normalizedInput.includes(normalizedTaskName) ||
    normalizedTaskName.includes(normalizedInput)
  ) {
    return true;
  }

  const inputWords = significantWords(input);
  const taskWords = significantWords(taskName);
  if (inputWords.length === 0 || taskWords.length === 0) return false;

  const taskWordSet = new Set(taskWords);
  const overlap = inputWords.filter((word) => taskWordSet.has(word)).length;
  return overlap >= 1;
}

export class PlanProgressTracker {
  private plan: ParsedPlan | null = null;
  private tasks: TrackedTask[] = [];
  private currentSpinnerFrame = 0;
  private spinnerFrames = ["◐", "◓", "◑", "◒"];
  private lastSpinnerUpdate = 0;
  private changeListeners = new Set<PlanProgressChangeListener>();
  private readonly SPINNER_INTERVAL_MS = PLAN_PROGRESS_SPINNER_MS;

  loadPlan(markdown: string): void {
    this.plan = parsePlan(markdown);
    this.tasks = this.plan.tasks.map((t) => ({
      ...t,
      status: "pending" as TaskStatus,
    }));
    this.currentSpinnerFrame = 0;
    this.lastSpinnerUpdate = Date.now();
    this.notifyChanged();
  }

  clear(): void {
    const hadPlan = this.hasPlan();
    this.plan = null;
    this.tasks = [];
    if (hadPlan) this.notifyChanged();
  }

  setOnChange(listener: PlanProgressChangeListener | null): void {
    this.changeListeners.clear();
    if (listener) this.changeListeners.add(listener);
  }

  subscribeOnChange(listener: PlanProgressChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private notifyChanged(): void {
    for (const listener of [...this.changeListeners]) listener();
  }

  hasPlan(): boolean {
    return this.plan !== null && this.tasks.length > 0;
  }

  getGoal(): string {
    return this.plan?.goal || "";
  }

  startTask(taskId: number): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task?.status === "pending") {
      task.status = "running";
      task.startedAt = Date.now();
      this.notifyChanged();
    }
  }

  startTaskByMatch(text: string): number | null {
    if (!this.hasPlan()) return null;

    const normalized = normalizeMatchText(text);
    for (const task of this.tasks) {
      if (task.status !== "pending") continue;
      if (
        normalized.includes(`task ${task.id}`) ||
        textMatches(text, task.name)
      ) {
        task.status = "running";
        task.startedAt = Date.now();
        this.notifyChanged();
        return task.id;
      }
    }
    return null;
  }

  completeTask(taskId: number, success: boolean): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task?.status === "running") {
      task.status = success ? "completed" : "failed";
      task.completedAt = Date.now();
      this.notifyChanged();
    }
  }

  completeTaskByMatch(text: string, success: boolean): number | null {
    if (!this.hasPlan()) return null;

    const normalized = normalizeMatchText(text);
    for (const task of this.tasks) {
      if (task.status !== "running") continue;
      if (
        normalized.includes(`task ${task.id}`) ||
        textMatches(text, task.name)
      ) {
        task.status = success ? "completed" : "failed";
        task.completedAt = Date.now();
        this.notifyChanged();
        return task.id;
      }
    }
    return null;
  }

  getSpinner(): string {
    const now = Date.now();
    if (now - this.lastSpinnerUpdate > this.SPINNER_INTERVAL_MS) {
      this.currentSpinnerFrame =
        (this.currentSpinnerFrame + 1) % this.spinnerFrames.length;
      this.lastSpinnerUpdate = now;
    }
    return this.spinnerFrames[this.currentSpinnerFrame];
  }

  getProgress(): {
    completed: number;
    total: number;
    failed: number;
    running: number;
    pending: number;
  } {
    const completed = this.tasks.filter((t) => t.status === "completed").length;
    const failed = this.tasks.filter((t) => t.status === "failed").length;
    const running = this.tasks.filter((t) => t.status === "running").length;
    const pending = this.tasks.filter((t) => t.status === "pending").length;
    return { completed, total: this.tasks.length, failed, running, pending };
  }

  render(theme: Theme, maxWidth: number): string[] {
    if (!this.hasPlan()) return [];

    const width = Math.max(0, maxWidth);
    if (width === 0) return [];

    const t = theme;
    const lines: string[] = [];
    const clampLine = (line: string) => truncateToWidth(line, width);

    const goal = this.getGoal();
    const headerText = truncateToWidth(goal ? `▸ ${goal}` : "▸ Plan", width);
    lines.push(clampLine(t.fg("accent", t.bold(headerText))));

    const { completed, total, failed, running } = this.getProgress();
    const pct = Math.round((completed / total) * 100);
    const barWidth = Math.min(12, Math.max(1, Math.floor(width / 8)));
    const filled = Math.round((pct / 100) * barWidth);
    const bar =
      t.fg("success", "█".repeat(filled)) +
      t.fg("dim", "░".repeat(barWidth - filled));

    const parts: string[] = [];
    parts.push(`${bar} ${t.fg("dim", `${completed}/${total}`)}`);
    if (failed > 0) parts.push(t.fg("error", `${failed} failed`));
    if (running > 0) parts.push(t.fg("warning", `${running} running`));
    lines.push(clampLine("  " + parts.join(t.fg("dim", " │ "))));

    for (const task of this.tasks) {
      let icon: string;
      let color: Parameters<Theme["fg"]>[0];

      switch (task.status) {
        case "completed":
          icon = "✓";
          color = "success";
          break;
        case "failed":
          icon = "✗";
          color = "error";
          break;
        case "running":
          icon = this.getSpinner();
          color = "warning";
          break;
        default:
          icon = "○";
          color = "dim";
      }

      const textColor: Parameters<Theme["fg"]>[0] = color === "dim" ? "dim" : "toolOutput";
      const name = truncateToWidth(task.name, Math.max(0, width - 4));
      const taskLine = `${t.fg(color, icon)} ${t.fg(textColor, name)}`;
      lines.push(clampLine(`  ${taskLine}`));
    }

    return lines;
  }
}
