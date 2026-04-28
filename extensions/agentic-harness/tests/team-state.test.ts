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

import {
  acknowledgeTeamCommand,
  blockTeamCommand,
  completeTeamCommand,
  enqueueTeamCommand,
  markStaleCommands,
  projectTeamTasksFromCommands,
  retryTeamCommand,
  startTeamCommand,
  TEAM_COMMAND_MAX_ATTEMPT,
} from "../team-state.js";

describe("team command lifecycle", () => {
  it("records queued to acknowledged to started to completed command state", () => {
    let record = createTeamRunRecord({
      runId: "team-command-lifecycle",
      goal: "Command lifecycle",
      tasks: createDefaultTeamTasks("Command lifecycle", 1, "worker"),
      now: "2026-04-28T00:00:00.000Z",
    });

    record = enqueueTeamCommand(record, {
      taskId: "task-1",
      owner: "worker-1",
      body: "do it",
      createdAt: "2026-04-28T00:00:01.000Z",
    });
    const id = record.commands[0]!.id;
    record = acknowledgeTeamCommand(record, id, { now: "2026-04-28T00:00:02.000Z", expectedStatusVersion: 0 });
    record = startTeamCommand(record, id, { now: "2026-04-28T00:00:03.000Z", expectedStatusVersion: 1 });
    record = completeTeamCommand(record, id, {
      now: "2026-04-28T00:00:04.000Z",
      expectedStatusVersion: 2,
      resultSummary: "done",
      artifactRefs: ["final.md"],
    });

    expect(record.commands[0]).toMatchObject({
      id: "team-command-lifecycle-command-1",
      status: "completed",
      statusVersion: 3,
      attempt: 1,
      resultSummary: "done",
      artifactRefs: ["final.md"],
    });
    expect(record.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "command_enqueued",
      "command_acknowledged",
      "command_started",
      "command_completed",
    ]));
  });

  it("guards stale statusVersion transitions and keeps command unchanged", () => {
    let record = createTeamRunRecord({
      runId: "team-command-conflict",
      goal: "Command conflict",
      tasks: createDefaultTeamTasks("Command conflict", 1, "worker"),
      now: "2026-04-28T00:00:00.000Z",
    });
    record = enqueueTeamCommand(record, {
      taskId: "task-1",
      owner: "worker-1",
      body: "do it",
      createdAt: "2026-04-28T00:00:01.000Z",
    });
    const id = record.commands[0]!.id;
    record = acknowledgeTeamCommand(record, id, { now: "2026-04-28T00:00:02.000Z", expectedStatusVersion: 7 });

    expect(record.commands[0]).toMatchObject({ status: "queued", statusVersion: 0 });
    expect(record.events.at(-1)).toMatchObject({ type: "command_conflict", commandId: id });
  });

  it("retries stale commands with same id and bounded attempt cap", () => {
    let record = createTeamRunRecord({
      runId: "team-command-retry",
      goal: "Command retry",
      tasks: createDefaultTeamTasks("Command retry", 1, "worker"),
      now: "2026-04-28T00:00:00.000Z",
    });
    record = enqueueTeamCommand(record, {
      taskId: "task-1",
      owner: "worker-1",
      body: "do it",
      createdAt: "2026-04-28T00:00:01.000Z",
    });
    const id = record.commands[0]!.id;
    record = startTeamCommand(record, id, { now: "2026-04-28T00:00:02.000Z" });
    record = retryTeamCommand(record, id, { now: "2026-04-28T00:01:00.000Z", reason: "stale" });
    record = retryTeamCommand(record, id, { now: "2026-04-28T00:02:00.000Z", reason: "stale again" });
    record = retryTeamCommand(record, id, { now: "2026-04-28T00:03:00.000Z", reason: "cap" });

    expect(record.commands).toHaveLength(1);
    expect(record.commands[0]).toMatchObject({ id, attempt: TEAM_COMMAND_MAX_ATTEMPT, status: "blocked" });
    expect(record.commands[0]!.attempt).toBeLessThanOrEqual(3);
    expect(record.commands[0]!.body).toBe("do it");
  });

  it("normalizes pre-command records on read", async () => {
    await withTempDir(async (dir) => {
      const record: any = createTeamRunRecord({
        runId: "team-old-record",
        goal: "Old record",
        tasks: createDefaultTeamTasks("Old record", 1, "worker"),
        now: "2026-04-28T00:00:00.000Z",
      });
      delete record.commands;
      const { writeFile, mkdir } = await import("fs/promises");
      const { dirname, join } = await import("path");
      const file = join(dir, "team-old-record", "team-run.json");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(record)}\n`, "utf-8");

      const restored = await readTeamRunRecord("team-old-record", dir);
      expect(restored.commands).toEqual([]);
      expect(restored.tasks).toHaveLength(1);
    });
  });

  it("marks stale commands retryable or stale according to resume mode", () => {
    let record = createTeamRunRecord({
      runId: "team-stale-command",
      goal: "Stale command",
      tasks: createDefaultTeamTasks("Stale command", 1, "worker"),
      now: "2026-04-28T00:00:00.000Z",
    });
    record = enqueueTeamCommand(record, {
      taskId: "task-1",
      owner: "worker-1",
      body: "do it",
      createdAt: "2026-04-28T00:00:00.000Z",
    });
    const retryable = markStaleCommands(record, {
      now: "2026-04-28T00:01:00.000Z",
      staleTaskMs: 1_000,
      mode: "retry-stale",
    });
    const stale = markStaleCommands(record, {
      now: "2026-04-28T00:01:00.000Z",
      staleTaskMs: 1_000,
      mode: "mark-interrupted",
    });

    expect(retryable.commands[0]).toMatchObject({ id: record.commands[0]!.id, status: "queued", attempt: 2 });
    expect(stale.commands[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("stale") });
  });
});

describe("team command projection and idempotency", () => {
  it("keeps duplicate ack/start idempotent", () => {
    let record = createTeamRunRecord({
      runId: "team-command-idempotent",
      goal: "Idempotent command",
      tasks: createDefaultTeamTasks("Idempotent command", 1, "worker"),
      now: "2026-04-28T00:00:00.000Z",
    });
    record = enqueueTeamCommand(record, {
      taskId: "task-1",
      owner: "worker-1",
      body: "do it",
      createdAt: "2026-04-28T00:00:01.000Z",
    });
    const id = record.commands[0]!.id;
    record = acknowledgeTeamCommand(record, id, { now: "2026-04-28T00:00:02.000Z" });
    record = acknowledgeTeamCommand(record, id, { now: "2026-04-28T00:00:03.000Z" });
    record = startTeamCommand(record, id, { now: "2026-04-28T00:00:04.000Z" });
    record = startTeamCommand(record, id, { now: "2026-04-28T00:00:05.000Z" });

    expect(record.commands[0]).toMatchObject({ status: "started", statusVersion: 2 });
    expect(record.events.filter((event) => event.type === "command_acknowledged")).toHaveLength(1);
    expect(record.events.filter((event) => event.type === "command_started")).toHaveLength(1);
  });

  it("projects blocked command state onto the owning task", () => {
    let record = createTeamRunRecord({
      runId: "team-command-project",
      goal: "Project command",
      tasks: createDefaultTeamTasks("Project command", 1, "worker"),
      now: "2026-04-28T00:00:00.000Z",
    });
    record = enqueueTeamCommand(record, {
      taskId: "task-1",
      owner: "worker-1",
      body: "do it",
      createdAt: "2026-04-28T00:00:01.000Z",
    });
    record = blockTeamCommand(record, record.commands[0]!.id, {
      now: "2026-04-28T00:00:02.000Z",
      errorMessage: "blocked by wake-up failure",
    });

    const projected = projectTeamTasksFromCommands(record);
    expect(projected.tasks[0]).toMatchObject({ status: "blocked", errorMessage: "blocked by wake-up failure" });
  });
});
