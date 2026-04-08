import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listIssuesByLabel,
  getIssueWithComments,
  swapLabels,
  lockIssue,
  markNeedsClarification,
  resumeFromClarification,
  hasNewCommentsAfter,
  detectRepo,
} from "../github.js";
import { AUTONOMOUS_LABELS } from "../types.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
const mockExec = execSync as unknown as ReturnType<typeof vi.fn>;

describe("github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listIssuesByLabel", () => {
    it("should list issues with the ready label", async () => {
      mockExec.mockReturnValue(
        JSON.stringify([
          {
            number: 42,
            title: "Add login page",
            body: "We need a login page",
            labels: [{ name: "autonomous-dev:ready" }],
            author: { login: "alice" },
            createdAt: "2026-04-01T00:00:00Z",
          },
        ])
      );

      const issues = await listIssuesByLabel("owner/repo", AUTONOMOUS_LABELS.READY);
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(42);
      expect(issues[0].title).toBe("Add login page");
      expect(issues[0].author).toBe("alice");
      const call = mockExec.mock.calls[0][0] as string;
      expect(call).toContain("--json number,title,body,labels,author,createdAt");
      expect(call).not.toMatch(/--json\s*$/);
    });

    it("should exclude issues with specified labels", async () => {
      mockExec.mockReturnValue(JSON.stringify([]));
      await listIssuesByLabel("owner/repo", AUTONOMOUS_LABELS.READY, [
        AUTONOMOUS_LABELS.IN_PROGRESS,
      ]);
      expect(mockExec).toHaveBeenCalledTimes(1);
      const call = mockExec.mock.calls[0][0] as string;
      expect(call).toContain("-label:autonomous-dev:in-progress");
    });
  });

  describe("getIssueWithComments", () => {
    it("should return issue with comments", async () => {
      mockExec
        .mockReturnValueOnce(
          JSON.stringify({
            number: 42,
            title: "Test issue",
            body: "Body text",
            labels: [{ name: "autonomous-dev:ready" }],
            author: { login: "bob" },
            createdAt: "2026-04-01T00:00:00Z",
          })
        )
        .mockReturnValueOnce(
          JSON.stringify({
            comments: [
              {
                id: 1,
                author: { login: "alice" },
                body: "I think we should use OAuth",
                createdAt: "2026-04-02T00:00:00Z",
                isBot: false,
              },
            ],
          })
        );

      const ctx = await getIssueWithComments("owner/repo", 42);
      expect(ctx.issue.number).toBe(42);
      expect(ctx.comments).toHaveLength(1);
      expect(ctx.comments[0].author).toBe("alice");
    });
  });

  describe("swapLabels", () => {
    it("should remove old labels and add new ones", async () => {
      mockExec.mockReturnValue("");
      await swapLabels("owner/repo", 42, ["old-label"], ["new-label"]);

      // First call: remove, Second call: add
      expect(mockExec).toHaveBeenCalledTimes(2);
      expect((mockExec.mock.calls[0][0] as string)).toContain("--remove-label");
      expect((mockExec.mock.calls[1][0] as string)).toContain("--add-label");
    });
  });

  describe("lockIssue", () => {
    it("should swap ready → in-progress", async () => {
      mockExec.mockReturnValue("");
      await lockIssue("owner/repo", 42);

      expect(mockExec).toHaveBeenCalledTimes(2);
      const removeCall = mockExec.mock.calls[0][0] as string;
      const addCall = mockExec.mock.calls[1][0] as string;
      expect(removeCall).toContain(AUTONOMOUS_LABELS.READY);
      expect(addCall).toContain(AUTONOMOUS_LABELS.IN_PROGRESS);
    });
  });

  describe("markNeedsClarification", () => {
    it("should swap in-progress → needs-clarification", async () => {
      mockExec.mockReturnValue("");
      await markNeedsClarification("owner/repo", 42);

      expect(mockExec).toHaveBeenCalledTimes(2);
      const removeCall = mockExec.mock.calls[0][0] as string;
      const addCall = mockExec.mock.calls[1][0] as string;
      expect(removeCall).toContain(AUTONOMOUS_LABELS.IN_PROGRESS);
      expect(addCall).toContain(AUTONOMOUS_LABELS.NEEDS_CLARIFICATION);
    });
  });

  describe("resumeFromClarification", () => {
    it("should swap needs-clarification → in-progress", async () => {
      mockExec.mockReturnValue("");
      await resumeFromClarification("owner/repo", 42);

      expect(mockExec).toHaveBeenCalledTimes(2);
      const removeCall = mockExec.mock.calls[0][0] as string;
      const addCall = mockExec.mock.calls[1][0] as string;
      expect(removeCall).toContain(AUTONOMOUS_LABELS.NEEDS_CLARIFICATION);
      expect(addCall).toContain(AUTONOMOUS_LABELS.IN_PROGRESS);
    });
  });

  describe("hasNewCommentsAfter", () => {
    const comments = [
      { id: 1, author: "bot", body: "Question", createdAt: "2026-04-01T10:00:00Z", isFromBot: true },
      { id: 2, author: "alice", body: "Answer", createdAt: "2026-04-01T11:00:00Z", isFromBot: false },
      { id: 3, author: "bot", body: "Follow-up", createdAt: "2026-04-01T12:00:00Z", isFromBot: true },
    ];

    it("should detect new non-bot comments after timestamp", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T10:00:00Z")).toBe(true);
    });

    it("should return false when no new non-bot comments", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T12:00:00Z")).toBe(false);
    });

    it("should include bot comments when excludeBot is false", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T11:00:00Z", false)).toBe(true);
    });

    it("should return false for exact timestamp match", () => {
      expect(hasNewCommentsAfter(comments, "2026-04-01T11:00:00Z")).toBe(false);
    });
  });

  describe("detectRepo", () => {
    it("should parse HTTPS remote URL", async () => {
      mockExec.mockReturnValue("https://github.com/owner/repo.git\n");
      const repo = await detectRepo();
      expect(repo).toBe("owner/repo");
    });

    it("should parse SSH remote URL", async () => {
      mockExec.mockReturnValue("git@github.com:owner/repo.git\n");
      const repo = await detectRepo();
      expect(repo).toBe("owner/repo");
    });

    it("should parse GitHub URL without .git suffix", async () => {
      mockExec.mockReturnValue("https://github.com/owner/repo");
      const repo = await detectRepo();
      expect(repo).toBe("owner/repo");
    });

    it("should return null on failure", async () => {
      mockExec.mockImplementation(() => {
        throw new Error("no remote");
      });
      const repo = await detectRepo();
      expect(repo).toBeNull();
    });

    it("should return null for non-GitHub URLs", async () => {
      mockExec.mockReturnValue("https://gitlab.com/owner/repo.git\n");
      const repo = await detectRepo();
      expect(repo).toBeNull();
    });
  });
});
