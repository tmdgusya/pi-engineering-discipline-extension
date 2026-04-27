import { describe, expect, it, vi } from "vitest";
import {
  buildAttachCommand,
  buildTmuxSessionName,
  createWorkerPanes,
  detectTmux,
  killTmuxSession,
  parsePaneIds,
  parseTmuxAvailability,
  type TmuxCommandRunner,
} from "../tmux.js";

function createMockRunner(outputs: string[] = []): { runner: TmuxCommandRunner; calls: Array<{ file: string; args: string[] }> } {
  const calls: Array<{ file: string; args: string[] }> = [];
  const runner: TmuxCommandRunner = (file, args, _options, callback) => {
    calls.push({ file, args: [...args] });
    callback(null, outputs.shift() ?? "", "");
  };
  return { runner, calls };
}

describe("tmux helpers", () => {
  it("builds deterministic session names and attach commands", () => {
    expect(buildTmuxSessionName("team-demo")).toBe("pi-team-demo");
    expect(buildTmuxSessionName("Team Demo!/run_1")).toBe("pi-team-demo-run_1");
    expect(buildAttachCommand({ sessionName: "pi-team-demo" })).toBe("tmux attach -t pi-team-demo");
  });

  it("parses tmux availability and pane ids", () => {
    expect(parseTmuxAvailability("/opt/homebrew/bin/tmux\n")).toEqual({ available: true, binary: "/opt/homebrew/bin/tmux" });
    expect(parseTmuxAvailability("\n")).toEqual({ available: false });
    expect(parsePaneIds("%1\n%2\n")).toEqual(["%1", "%2"]);
  });

  it("detects tmux through the injected command runner", async () => {
    const { runner, calls } = createMockRunner(["/usr/bin/tmux\n"]);

    await expect(detectTmux(runner)).resolves.toEqual({ available: true, binary: "/usr/bin/tmux" });
    expect(calls).toEqual([{ file: "which", args: ["tmux"] }]);
  });

  it("succeeds when command stderr contains warnings without an execution error", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const runner: TmuxCommandRunner = (file, args, _options, callback) => {
      calls.push({ file, args: [...args] });
      callback(null, "/usr/bin/tmux\n", "warning\n");
    };

    await expect(detectTmux(runner)).resolves.toEqual({ available: true, binary: "/usr/bin/tmux" });
    expect(calls).toEqual([{ file: "which", args: ["tmux"] }]);
  });

  it("constructs deterministic pane creation and logging commands", async () => {
    const { runner, calls } = createMockRunner(["%1\n", "", "%2\n", "", ""]);

    await expect(
      createWorkerPanes({ runId: "team-demo", workerCount: 2, logDir: "/tmp/John Doe/a;b", commandRunner: runner }),
    ).resolves.toEqual([
      {
        sessionName: "pi-team-demo",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-team-demo",
        logFile: "/tmp/John Doe/a;b/task-1.log",
      },
      {
        sessionName: "pi-team-demo",
        windowName: "workers",
        paneId: "%2",
        attachCommand: "tmux attach -t pi-team-demo",
        logFile: "/tmp/John Doe/a;b/task-2.log",
      },
    ]);
    expect(calls).toEqual([
      { file: "tmux", args: ["new-session", "-d", "-s", "pi-team-demo", "-n", "workers", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%1", "-o", "cat >> '/tmp/John Doe/a;b/task-1.log'"] },
      { file: "tmux", args: ["split-window", "-t", "pi-team-demo:workers", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%2", "-o", "cat >> '/tmp/John Doe/a;b/task-2.log'"] },
      { file: "tmux", args: ["select-layout", "-t", "pi-team-demo:workers", "tiled"] },
    ]);
  });

  it("retries session creation with a collision-safe suffix without killing the existing session", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const runner: TmuxCommandRunner = (file, args, _options, callback) => {
      calls.push({ file, args: [...args] });
      if (args[0] === "new-session" && args.includes("pi-run")) {
        callback(new Error("duplicate session: pi-run"), "", "duplicate session: pi-run");
        return;
      }
      if (args[0] === "new-session") {
        callback(null, "%1\n", "");
        return;
      }
      callback(null, "", "");
    };
    const suffixGenerator = vi.fn(() => "retry1");

    await expect(
      createWorkerPanes({ runId: "run", workerCount: 1, logDir: "/tmp/run", commandRunner: runner, suffixGenerator }),
    ).resolves.toEqual([
      {
        sessionName: "pi-run-attempt-retry1",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-run-attempt-retry1",
        logFile: "/tmp/run/task-1.log",
        sessionAttempt: "retry1",
      },
    ]);
    expect(suffixGenerator).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.args)).toEqual([
      ["new-session", "-d", "-s", "pi-run", "-n", "workers", "-P", "-F", "#{pane_id}"],
      ["new-session", "-d", "-s", "pi-run-attempt-retry1", "-n", "workers", "-P", "-F", "#{pane_id}"],
      ["pipe-pane", "-t", "%1", "-o", "cat >> '/tmp/run/task-1.log'"],
      ["select-layout", "-t", "pi-run-attempt-retry1:workers", "tiled"],
    ]);
    expect(calls.some((call) => call.args[0] === "kill-session")).toBe(false);
  });

  it("kills tmux sessions best-effort", async () => {
    const { runner, calls } = createMockRunner();

    await expect(killTmuxSession("pi-team-demo", runner)).resolves.toBeUndefined();
    expect(calls).toEqual([{ file: "tmux", args: ["kill-session", "-t", "pi-team-demo"] }]);
  });
});
