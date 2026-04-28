import { describe, expect, it } from "vitest";
import {
  buildTeamCommandPrompt,
  getTeamArgumentCompletions,
  parseTeamArgs,
  TEAM_BACKEND_VALUES,
  TEAM_RESUME_MODE_VALUES,
  TEAM_WORKTREE_POLICY_VALUES,
} from "../team-command.js";

describe("parseTeamArgs", () => {
  it("parses required goal with quoted spaces", () => {
    const out = parseTeamArgs('goal="prototype the API client" agent=worker');
    expect(out.goal).toBe("prototype the API client");
    expect(out.agent).toBe("worker");
  });

  it("accepts a bare first token as the goal when no goal= key is given", () => {
    const out = parseTeamArgs('"draft the rfc"');
    expect(out.goal).toBe("draft the rfc");
  });

  it("normalizes kebab-case and camelCase keys", () => {
    const out = parseTeamArgs('goal="x" worker-count=3 worktreePolicy=auto resume-mode=retry-stale max-output=1024');
    expect(out.workerCount).toBe(3);
    expect(out.worktreePolicy).toBe("auto");
    expect(out.resumeMode).toBe("retry-stale");
    expect(out.maxOutput).toBe(1024);
  });

  it("rejects out-of-domain enum values silently", () => {
    const out = parseTeamArgs('goal="x" backend=ftp worktree-policy=hot');
    expect(out.backend).toBeUndefined();
    expect(out.worktreePolicy).toBeUndefined();
  });

  it("ignores zero/negative numeric values for worker-count and max-output", () => {
    const out = parseTeamArgs('goal="x" worker-count=0 max-output=-5');
    expect(out.workerCount).toBeUndefined();
    expect(out.maxOutput).toBeUndefined();
  });
});

describe("buildTeamCommandPrompt", () => {
  it("emits goal and known params verbatim and quotes string values", () => {
    const prompt = buildTeamCommandPrompt({
      goal: "build the API client",
      agent: "worker",
      backend: "native",
      workerCount: 2,
    });
    expect(prompt).toContain('goal="build the API client"');
    expect(prompt).toContain('agent="worker"');
    expect(prompt).toContain('backend="native"');
    expect(prompt).toContain("workerCount=2");
    expect(prompt).toContain("Invoke the `team` tool");
  });

  it("omits unset optional params", () => {
    const prompt = buildTeamCommandPrompt({ goal: "x" });
    expect(prompt).not.toMatch(/agent=/);
    expect(prompt).not.toMatch(/backend=/);
    expect(prompt).not.toMatch(/resumeRunId=/);
  });
});

describe("getTeamArgumentCompletions", () => {
  const sources = {
    listAgents: async () => ["worker", "explorer", "validator"],
    listResumeRuns: async () => [
      { runId: "run-2025-01-03", status: "completed" },
      { runId: "run-2025-01-02", status: "interrupted" },
      { runId: "run-2025-01-01", status: "failed" },
    ],
  };

  it("suggests all keys when no fragment is typed", async () => {
    const out = await getTeamArgumentCompletions("", sources);
    const values = out.map((i) => i.value);
    expect(values).toContain("goal=");
    expect(values).toContain("agent=");
    expect(values).toContain("backend=");
    expect(values).toContain("resume=");
  });

  it("filters keys by typed prefix", async () => {
    const out = await getTeamArgumentCompletions("goal=x ag", sources);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe("agent=");
  });

  it("completes static enum values for backend=", async () => {
    const out = await getTeamArgumentCompletions("goal=x backend=", sources);
    expect(out.map((i) => i.value)).toEqual(
      TEAM_BACKEND_VALUES.map((v) => `backend=${v}`),
    );
  });

  it("completes worktree-policy and resume-mode enums", async () => {
    const wp = await getTeamArgumentCompletions("worktree-policy=", sources);
    expect(wp.map((i) => i.value)).toEqual(
      TEAM_WORKTREE_POLICY_VALUES.map((v) => `worktree-policy=${v}`),
    );
    const rm = await getTeamArgumentCompletions("resume-mode=", sources);
    expect(rm.map((i) => i.value)).toEqual(
      TEAM_RESUME_MODE_VALUES.map((v) => `resume-mode=${v}`),
    );
  });

  it("completes agent= using listAgents", async () => {
    const out = await getTeamArgumentCompletions("agent=w", sources);
    expect(out.map((i) => i.value)).toEqual(["agent=worker"]);
  });

  it("completes resume= using listResumeRuns and surfaces status as description", async () => {
    const out = await getTeamArgumentCompletions("resume=", sources);
    expect(out).toHaveLength(3);
    expect(out[0]!.value).toBe("resume=run-2025-01-03");
    expect(out[0]!.description).toBe("completed");
  });

  it("respects resumeLimit", async () => {
    const out = await getTeamArgumentCompletions("resume=", { ...sources, resumeLimit: 2 });
    expect(out).toHaveLength(2);
  });

  it("returns empty for unknown keys", async () => {
    const out = await getTeamArgumentCompletions("nonsense=", sources);
    expect(out).toEqual([]);
  });
});

describe("team follow-up command parsing", () => {
  it("parses follow-up target and message without requiring goal", () => {
    const out = parseTeamArgs('resume=team-123 command=worker-1 message="check the failing test"');
    expect(out.goal).toBe("");
    expect(out.resume).toBe("team-123");
    expect(out.commandTarget).toBe("worker-1");
    expect(out.commandMessage).toBe("check the failing test");
  });

  it("serializes follow-up mode without a goal", () => {
    const prompt = buildTeamCommandPrompt({
      goal: "",
      resume: "team-123",
      commandTarget: "task-1",
      commandMessage: "write status",
    });
    expect(prompt).toContain("follow-up command mode");
    expect(prompt).toContain('resumeRunId="team-123"');
    expect(prompt).toContain('commandTarget="task-1"');
    expect(prompt).toContain('commandMessage="write status"');
    expect(prompt).not.toContain("goal=");
  });
});
