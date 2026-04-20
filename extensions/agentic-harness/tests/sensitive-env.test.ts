import { describe, expect, it } from "vitest";
import { isSensitiveEnvPath } from "../sandbox/sensitive-env.js";

describe("isSensitiveEnvPath", () => {
  it("matches .env and .env.* files", () => {
    expect(isSensitiveEnvPath(".env", "/repo")).toBe(true);
    expect(isSensitiveEnvPath(".env.local", "/repo")).toBe(true);
    expect(isSensitiveEnvPath("config/.env.production", "/repo")).toBe(true);
  });

  it("does not match non-env files", () => {
    expect(isSensitiveEnvPath("README.md", "/repo")).toBe(false);
    expect(isSensitiveEnvPath("env.txt", "/repo")).toBe(false);
  });
});
