import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export interface ExtensionState {
  phase: "idle" | "clarifying" | "planning" | "ultraplanning";
  activeGoalDocument: string | null;
}

export const DEFAULT_STATE: ExtensionState = {
  phase: "idle",
  activeGoalDocument: null,
};

export async function loadState(path: string): Promise<ExtensionState> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      phase: parsed.phase ?? "idle",
      activeGoalDocument: parsed.activeGoalDocument ?? null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(
  path: string,
  state: ExtensionState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

export async function updateState(
  path: string,
  partial: Partial<ExtensionState>,
): Promise<ExtensionState> {
  const current = await loadState(path);
  const next = { ...current, ...partial };
  await saveState(path, next);
  return next;
}
