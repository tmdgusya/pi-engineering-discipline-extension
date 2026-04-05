import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadState, saveState, updateState, DEFAULT_STATE } from "../state.js";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

describe("Extension State", () => {
  let stateDir: string;
  let statePath: string;

  beforeEach(() => {
    stateDir = join(tmpdir(), `pi-test-${randomBytes(4).toString("hex")}`);
    statePath = join(stateDir, "extension-state.json");
  });

  afterEach(async () => {
    try {
      await unlink(statePath);
    } catch {}
  });

  it("should return default state when file does not exist", async () => {
    const state = await loadState(statePath);
    expect(state).toEqual(DEFAULT_STATE);
  });

  it("should save and load state", async () => {
    const state = {
      phase: "planning" as const,
      activeGoalDocument: "docs/engineering-discipline/plans/2026-04-05-feature.md",
    };
    await saveState(statePath, state);
    const loaded = await loadState(statePath);
    expect(loaded).toEqual(state);
  });

  it("should update partial state", async () => {
    await saveState(statePath, {
      phase: "clarifying",
      activeGoalDocument: "docs/brief.md",
    });
    await updateState(statePath, { phase: "planning" });
    const loaded = await loadState(statePath);
    expect(loaded.phase).toBe("planning");
    expect(loaded.activeGoalDocument).toBe("docs/brief.md");
  });

  it("should handle corrupt JSON gracefully", async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(statePath, "not json{{{", "utf-8");
    const state = await loadState(statePath);
    expect(state).toEqual(DEFAULT_STATE);
  });
});
