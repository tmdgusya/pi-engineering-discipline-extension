import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultTeamTasks } from "../team.js";
import {
  createTeamRunRecord,
  listTeamRuns,
  markStaleRunningTasks,
  readTeamRunRecord,
  recordTeamMessage,
  writeTeamRunRecord,
} from "../team-state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pi-team-state-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("team-state", () => {
  it("round-trips a durable team run record", async () => {
    await withTempDir(async (dir) => {
      const record = createTeamRunRecord({
        runId: "team-state-roundtrip",
        goal: "Persist team state",
        options: { goal: "Persist team state", workerCount: 1, worktreePolicy: "off" },
        tasks: createDefaultTeamTasks("Persist team state", 1, "worker"),
        now: "2026-04-27T00:00:00.000Z",
      });

      const file = await writeTeamRunRecord(record, dir);
      const restored = await readTeamRunRecord("team-state-roundtrip", dir);
      const listed = await listTeamRuns(dir);

      expect(file).toContain("team-state-roundtrip");
      expect(restored).toMatchObject({
        runId: "team-state-roundtrip",
        goal: "Persist team state",
        status: "created",
        options: { workerCount: 1, worktreePolicy: "off" },
      });
      expect(restored.events.map((event) => event.type)).toEqual(["run_created", "task_created"]);
      expect(restored.messages).toEqual([]);
      expect(listed.map((run) => run.runId)).toEqual(["team-state-roundtrip"]);
    });
  });

  it("records durable inbox/outbox messages", () => {
    let record = createTeamRunRecord({
      runId: "team-message-test",
      goal: "Record messages",
      tasks: createDefaultTeamTasks("Record messages", 1, "worker"),
      now: "2026-04-27T00:00:00.000Z",
    });

    record = recordTeamMessage(record, {
      taskId: "task-1",
      from: "leader",
      to: "worker-1",
      kind: "inbox",
      body: "do the work",
      createdAt: "2026-04-27T00:00:01.000Z",
      deliveredAt: "2026-04-27T00:00:01.000Z",
    });
    record = recordTeamMessage(record, {
      taskId: "task-1",
      from: "worker-1",
      to: "leader",
      kind: "outbox",
      body: "done",
      createdAt: "2026-04-27T00:00:02.000Z",
    });

    expect(record.messages.map((message) => message.kind)).toEqual(["inbox", "outbox"]);
    expect(record.messages[0]).toMatchObject({ id: "team-message-test-message-1", deliveredAt: "2026-04-27T00:00:01.000Z" });
    expect(record.events.filter((event) => event.type === "message_recorded")).toHaveLength(2);
  });

  it("does not collide temp files during concurrent writes in the same millisecond", async () => {
    await withTempDir(async (dir) => {
      const record = createTeamRunRecord({
        runId: "team-state-concurrent-write",
        goal: "Persist concurrently",
        tasks: createDefaultTeamTasks("Persist concurrently", 1, "worker"),
        now: "2026-04-27T00:00:00.000Z",
      });
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_777_300_000_000);

      try {
        await expect(Promise.all([
          writeTeamRunRecord(record, dir),
          writeTeamRunRecord(record, dir),
          writeTeamRunRecord(record, dir),
        ])).resolves.toHaveLength(3);
      } finally {
        nowSpy.mockRestore();
      }

      const restored = await readTeamRunRecord("team-state-concurrent-write", dir);
      expect(restored.runId).toBe("team-state-concurrent-write");
    });
  });

  it("marks stale in-progress tasks interrupted or retryable on resume", () => {
    const [task] = createDefaultTeamTasks("Resume safely", 1, "worker");
    task.status = "in_progress";
    task.startedAt = "2026-04-27T00:00:00.000Z";
    task.updatedAt = "2026-04-27T00:00:00.000Z";
    const record = createTeamRunRecord({
      runId: "team-resume-test",
      goal: "Resume safely",
      tasks: [task],
      now: "2026-04-27T00:00:00.000Z",
    });

    const interrupted = markStaleRunningTasks(record, {
      now: "2026-04-27T00:01:00.000Z",
      staleTaskMs: 1_000,
      mode: "mark-interrupted",
    });
    const retryable = markStaleRunningTasks(record, {
      now: "2026-04-27T00:01:00.000Z",
      staleTaskMs: 1_000,
      mode: "retry-stale",
    });

    expect(interrupted.tasks[0].status).toBe("interrupted");
    expect(interrupted.tasks[0].errorMessage).toContain("interrupted");
    expect(retryable.tasks[0].status).toBe("pending");
  });
});
