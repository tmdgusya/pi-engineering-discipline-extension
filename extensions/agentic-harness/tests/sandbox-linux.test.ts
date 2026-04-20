import { describe, expect, it } from "vitest";
import { buildLinuxSandboxLaunch } from "../sandbox/adapters/linux.js";

describe("linux sandbox adapter", () => {
  it("adds unshare-net when network mode is off", () => {
    const launch = buildLinuxSandboxLaunch("pi", ["--mode", "json"], "/repo", "/repo", "off");
    expect(launch.command).toBe("bwrap");
    expect(launch.args).toContain("--unshare-net");
  });

  it("throws when cwd is outside workspace root", () => {
    expect(() =>
      buildLinuxSandboxLaunch("pi", [], "/tmp/outside", "/repo", "off"),
    ).toThrow(/outside workspace root/);
  });
});
