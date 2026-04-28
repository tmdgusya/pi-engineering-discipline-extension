import { describe, expect, it, vi } from "vitest";
import {
  appendNoUnderlineStyleFlags,
  buildAttachCommand,
  buildTmuxSessionName,
  createWorkerPanes,
  detectTmux,
  enableMouseScrolling,
  killTmuxPane,
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
    const { runner, calls } = createMockRunner([
      "%1\n", // new-session
      "",     // set-option mouse on
      "",     // set-option set-clipboard on
      "",     // show-options mode-style (empty global)
      "",     // show-options copy-mode-selection-style (empty global)
      "",     // pipe-pane task-1
      "%2\n", // split-window
      "",     // pipe-pane task-2
      "",     // select-layout
    ]);

    await expect(
      createWorkerPanes({
        runId: "team-demo",
        workerCount: 2,
        logDir: "/tmp/John Doe/a;b",
        commandRunner: runner,
        env: {},
      }),
    ).resolves.toEqual([
      {
        sessionName: "pi-team-demo",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-team-demo",
        logFile: "/tmp/John Doe/a;b/task-1.log",
        eventLogFile: "/tmp/John Doe/a;b/task-1.events.jsonl",
        placement: "detached-session",
      },
      {
        sessionName: "pi-team-demo",
        windowName: "workers",
        paneId: "%2",
        attachCommand: "tmux attach -t pi-team-demo",
        logFile: "/tmp/John Doe/a;b/task-2.log",
        eventLogFile: "/tmp/John Doe/a;b/task-2.events.jsonl",
        placement: "detached-session",
      },
    ]);
    expect(calls).toEqual([
      { file: "tmux", args: ["new-session", "-d", "-s", "pi-team-demo", "-n", "workers", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "mouse", "on"] },
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "set-clipboard", "on"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "pi-team-demo", "mode-style"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "pi-team-demo", "copy-mode-selection-style"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%1", "-o", "cat >> '/tmp/John Doe/a;b/task-1.log'"] },
      { file: "tmux", args: ["split-window", "-t", "pi-team-demo:workers", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%2", "-o", "cat >> '/tmp/John Doe/a;b/task-2.log'"] },
      { file: "tmux", args: ["select-layout", "-t", "pi-team-demo:workers", "tiled"] },
    ]);
  });

  it("splits worker panes into the current tmux window when already inside tmux", async () => {
    const { runner, calls } = createMockRunner([
      "dev-session\nmain\n@3\n", // display-message
      "",                          // set-option mouse on
      "",                          // set-option set-clipboard on
      "",                          // show-options mode-style (empty global)
      "",                          // show-options copy-mode-selection-style (empty global)
      "%11\n",                     // split-window worker 1
      "",                          // pipe-pane task-1
      "%12\n",                     // split-window worker 2
      "",                          // pipe-pane task-2
      "",                          // select-layout
    ]);

    await expect(
      createWorkerPanes({
        runId: "team-demo",
        workerCount: 2,
        logDir: "/tmp/current-window",
        commandRunner: runner,
        env: { TMUX: "/tmp/tmux-1000/default,123,0", TMUX_PANE: "%9" },
      }),
    ).resolves.toEqual([
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%11",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/current-window/task-1.log",
        eventLogFile: "/tmp/current-window/task-1.events.jsonl",
        placement: "current-window",
      },
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%12",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/current-window/task-2.log",
        eventLogFile: "/tmp/current-window/task-2.events.jsonl",
        placement: "current-window",
      },
    ]);
    expect(calls).toEqual([
      { file: "tmux", args: ["display-message", "-p", "-t", "%9", "#{session_name}\n#{window_name}\n#{window_id}"] },
      { file: "tmux", args: ["set-option", "-t", "dev-session", "mouse", "on"] },
      { file: "tmux", args: ["set-option", "-t", "dev-session", "set-clipboard", "on"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "dev-session", "mode-style"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "dev-session", "copy-mode-selection-style"] },
      { file: "tmux", args: ["split-window", "-t", "%9", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%11", "-o", "cat >> '/tmp/current-window/task-1.log'"] },
      { file: "tmux", args: ["split-window", "-t", "%9", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%12", "-o", "cat >> '/tmp/current-window/task-2.log'"] },
      { file: "tmux", args: ["select-layout", "-t", "@3", "tiled"] },
    ]);
  });

  it("retries session creation with a collision-safe suffix without killing the existing session", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const runner: TmuxCommandRunner = (file, args, _options, callback) => {
      calls.push({ file, args: [...args] });
      if (args[0] === "new-session" && args.includes("pi-run") && !args.some((arg) => arg.includes("attempt"))) {
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
      createWorkerPanes({
        runId: "run",
        workerCount: 1,
        logDir: "/tmp/run",
        commandRunner: runner,
        suffixGenerator,
        env: {},
      }),
    ).resolves.toEqual([
      {
        sessionName: "pi-run-attempt-retry1",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-run-attempt-retry1",
        logFile: "/tmp/run/task-1.log",
        eventLogFile: "/tmp/run/task-1.events.jsonl",
        sessionAttempt: "retry1",
        placement: "detached-session",
      },
    ]);
    expect(suffixGenerator).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.args)).toEqual([
      ["new-session", "-d", "-s", "pi-run", "-n", "workers", "-P", "-F", "#{pane_id}"],
      ["new-session", "-d", "-s", "pi-run-attempt-retry1", "-n", "workers", "-P", "-F", "#{pane_id}"],
      ["set-option", "-t", "pi-run-attempt-retry1", "mouse", "on"],
      ["set-option", "-t", "pi-run-attempt-retry1", "set-clipboard", "on"],
      ["show-options", "-gv", "-t", "pi-run-attempt-retry1", "mode-style"],
      ["show-options", "-gv", "-t", "pi-run-attempt-retry1", "copy-mode-selection-style"],
      ["pipe-pane", "-t", "%1", "-o", "cat >> '/tmp/run/task-1.log'"],
      ["select-layout", "-t", "pi-run-attempt-retry1:workers", "tiled"],
    ]);
    expect(calls.some((call) => call.args[0] === "kill-session")).toBe(false);
  });

  it("skips mouse-scroll setup when PI_TEAM_MOUSE=0 is set in the call env", async () => {
    const { runner, calls } = createMockRunner(["%1\n", "", ""]);

    await expect(
      createWorkerPanes({
        runId: "team-demo",
        workerCount: 1,
        logDir: "/tmp/optout",
        commandRunner: runner,
        env: { PI_TEAM_MOUSE: "0" },
      }),
    ).resolves.toEqual([
      {
        sessionName: "pi-team-demo",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-team-demo",
        logFile: "/tmp/optout/task-1.log",
        eventLogFile: "/tmp/optout/task-1.events.jsonl",
        placement: "detached-session",
      },
    ]);
    expect(calls).toEqual([
      { file: "tmux", args: ["new-session", "-d", "-s", "pi-team-demo", "-n", "workers", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%1", "-o", "cat >> '/tmp/optout/task-1.log'"] },
      { file: "tmux", args: ["select-layout", "-t", "pi-team-demo:workers", "tiled"] },
    ]);
    expect(calls.some((call) => call.args.includes("mouse"))).toBe(false);
    expect(calls.some((call) => call.args.includes("set-clipboard"))).toBe(false);
  });

  it("skips mouse-scroll setup in the current-window branch when PI_TEAM_MOUSE=0", async () => {
    const { runner, calls } = createMockRunner([
      "dev-session\nmain\n@3\n", // display-message
      "%11\n",                     // split-window worker 1
      "",                          // pipe-pane task-1
      "",                          // select-layout
    ]);

    await expect(
      createWorkerPanes({
        runId: "team-demo",
        workerCount: 1,
        logDir: "/tmp/current-window-optout",
        commandRunner: runner,
        env: { TMUX: "/tmp/tmux-1000/default,123,0", TMUX_PANE: "%9", PI_TEAM_MOUSE: "0" },
      }),
    ).resolves.toEqual([
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%11",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/current-window-optout/task-1.log",
        eventLogFile: "/tmp/current-window-optout/task-1.events.jsonl",
        placement: "current-window",
      },
    ]);
    expect(calls).toEqual([
      { file: "tmux", args: ["display-message", "-p", "-t", "%9", "#{session_name}\n#{window_name}\n#{window_id}"] },
      { file: "tmux", args: ["split-window", "-t", "%9", "-P", "-F", "#{pane_id}"] },
      { file: "tmux", args: ["pipe-pane", "-t", "%11", "-o", "cat >> '/tmp/current-window-optout/task-1.log'"] },
      { file: "tmux", args: ["select-layout", "-t", "@3", "tiled"] },
    ]);
    expect(calls.some((call) => call.args.includes("mouse"))).toBe(false);
    expect(calls.some((call) => call.args.includes("set-clipboard"))).toBe(false);
  });

  it("kills tmux sessions and panes best-effort", async () => {
    const { runner, calls } = createMockRunner();

    await expect(killTmuxSession("pi-team-demo", runner)).resolves.toBeUndefined();
    await expect(killTmuxPane("%11", runner)).resolves.toBeUndefined();
    expect(calls).toEqual([
      { file: "tmux", args: ["kill-session", "-t", "pi-team-demo"] },
      { file: "tmux", args: ["kill-pane", "-t", "%11"] },
    ]);
  });
});

describe("appendNoUnderlineStyleFlags", () => {
  it("appends every missing no-underline flag to a non-empty style", () => {
    expect(appendNoUnderlineStyleFlags("fg=colour231,bg=colour24,bold")).toBe(
      "fg=colour231,bg=colour24,bold,nounderscore,nodouble-underscore,nocurly-underscore,nodotted-underscore,nodashed-underscore",
    );
  });

  it("does not duplicate flags that are already present", () => {
    expect(appendNoUnderlineStyleFlags("fg=colour231,nounderscore,bold")).toBe(
      "fg=colour231,nounderscore,bold,nodouble-underscore,nocurly-underscore,nodotted-underscore,nodashed-underscore",
    );
  });

  it("normalizes whitespace-separated tokens", () => {
    expect(appendNoUnderlineStyleFlags("fg=colour231 bold")).toBe(
      "fg=colour231,bold,nounderscore,nodouble-underscore,nocurly-underscore,nodotted-underscore,nodashed-underscore",
    );
  });
});

describe("enableMouseScrolling", () => {
  it("issues mouse on, set-clipboard on, and underline-mitigation queries against the session target", async () => {
    const { runner, calls } = createMockRunner(["", "", "", ""]);

    await enableMouseScrolling(runner, "tmux", "pi-team-demo");

    expect(calls).toEqual([
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "mouse", "on"] },
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "set-clipboard", "on"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "pi-team-demo", "mode-style"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "pi-team-demo", "copy-mode-selection-style"] },
    ]);
  });

  it("rewrites style options with no-underline flags when the global value is non-empty", async () => {
    const { runner, calls } = createMockRunner([
      "", // set-option mouse on
      "", // set-option set-clipboard on
      "fg=colour231,bg=colour24,bold\n", // show-options mode-style
      "", // set-option mode-style sanitized
      "fg=colour231,nounderscore\n", // show-options copy-mode-selection-style
      "", // set-option copy-mode-selection-style sanitized
    ]);

    await enableMouseScrolling(runner, "tmux", "pi-team-demo");

    expect(calls).toEqual([
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "mouse", "on"] },
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "set-clipboard", "on"] },
      { file: "tmux", args: ["show-options", "-gv", "-t", "pi-team-demo", "mode-style"] },
      {
        file: "tmux",
        args: [
          "set-option",
          "-t",
          "pi-team-demo",
          "mode-style",
          "fg=colour231,bg=colour24,bold,nounderscore,nodouble-underscore,nocurly-underscore,nodotted-underscore,nodashed-underscore",
        ],
      },
      { file: "tmux", args: ["show-options", "-gv", "-t", "pi-team-demo", "copy-mode-selection-style"] },
      {
        file: "tmux",
        args: [
          "set-option",
          "-t",
          "pi-team-demo",
          "copy-mode-selection-style",
          "fg=colour231,nounderscore,nodouble-underscore,nocurly-underscore,nodotted-underscore,nodashed-underscore",
        ],
      },
    ]);
  });

  it("ignores set-option failures so pane creation still proceeds", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const runner: TmuxCommandRunner = (file, args, _options, callback) => {
      calls.push({ file, args: [...args] });
      if (args[0] === "set-option" && args[3] === "mouse") {
        callback(new Error("server not available"), "", "server not available");
        return;
      }
      callback(null, "", "");
    };

    await expect(enableMouseScrolling(runner, "tmux", "pi-team-demo")).resolves.toBeUndefined();
    expect(calls).toEqual([
      { file: "tmux", args: ["set-option", "-t", "pi-team-demo", "mouse", "on"] },
    ]);
  });
});
