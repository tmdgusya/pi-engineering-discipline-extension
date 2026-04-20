import { describe, expect, it } from "vitest";
import { resolveSandboxLaunch } from "../sandbox/executor.js";

describe("resolveSandboxLaunch", () => {
  it("returns passthrough launch when sandbox is disabled", async () => {
    const launch = await resolveSandboxLaunch({
      command: "pi",
      args: ["--mode", "json"],
      cwd: "/repo",
      env: {},
      platform: process.platform,
      sandbox: undefined,
    });

    expect(launch.command).toBe("pi");
    expect(launch.applied).toBe(false);
  });

  it("throws when sandbox is required but approval is denied on unsupported platform", async () => {
    await expect(resolveSandboxLaunch({
      command: "pi",
      args: ["--mode", "json"],
      cwd: "/repo",
      env: {},
      platform: "freebsd",
      sandbox: {
        enabled: true,
        workspaceRoot: "/repo",
        networkMode: "off",
        approvalResolver: async () => ({ approved: false }),
      },
    })).rejects.toThrow(/Sandbox required but unavailable/);
  });

  it("allows unsandboxed fallback when approval is granted", async () => {
    const launch = await resolveSandboxLaunch({
      command: "pi",
      args: ["--mode", "json"],
      cwd: "/repo",
      env: {},
      platform: "freebsd",
      sandbox: {
        enabled: true,
        workspaceRoot: "/repo",
        networkMode: "off",
        approvalResolver: async () => ({ approved: true, scope: "once" }),
      },
    });
    expect(launch.applied).toBe(false);
    expect(launch.command).toBe("pi");
  });

  it("auto-allows unsandboxed fallback in always mode without calling approvalResolver", async () => {
    let called = false;
    const launch = await resolveSandboxLaunch({
      command: "pi",
      args: ["--mode", "json"],
      cwd: "/repo",
      env: {},
      platform: "freebsd",
      sandbox: {
        enabled: true,
        workspaceRoot: "/repo",
        networkMode: "off",
        approvalMode: "always",
        approvalResolver: async () => {
          called = true;
          return { approved: false };
        },
      },
    });
    expect(launch.applied).toBe(false);
    expect(called).toBe(false);
  });

  it("denies unsandboxed fallback in deny mode without calling approvalResolver", async () => {
    let called = false;
    await expect(resolveSandboxLaunch({
      command: "pi",
      args: ["--mode", "json"],
      cwd: "/repo",
      env: {},
      platform: "freebsd",
      sandbox: {
        enabled: true,
        workspaceRoot: "/repo",
        networkMode: "off",
        approvalMode: "deny",
        approvalResolver: async () => {
          called = true;
          return { approved: true, scope: "once" };
        },
      },
    })).rejects.toThrow(/Sandbox required but unavailable/);
    expect(called).toBe(false);
  });
});
