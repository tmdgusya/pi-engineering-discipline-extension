import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactSecretsInString,
  escapeHtml,
  sanitizeForDisplay,
  signMessage,
  verifyMessage,
  checkApiCompatibility,
  grantPermission,
  hasPermission,
  revokePermission,
  revokeAllPermissions,
  logSecurityEvent,
  getSecurityLog,
  hasHighSeverityEvents,
} from "../src/security.js";

describe("security.ts", () => {
  describe("redactSecrets", () => {
    it("redacts keys matching secret patterns", () => {
      const obj = { apiKey: "sk-123", name: "alice" };
      const result = redactSecrets(obj);
      expect(result.apiKey).toBe("[REDACTED]");
      expect(result.name).toBe("alice");
    });

    it("redacts nested objects", () => {
      const obj = { config: { token: "abc", host: "localhost" } };
      const result = redactSecrets(obj);
      expect((result.config as any).token).toBe("[REDACTED]");
      expect((result.config as any).host).toBe("localhost");
    });

    it("redacts inside arrays", () => {
      const obj = { items: [{ password: "123" }, { label: "ok" }] };
      const result = redactSecrets(obj);
      expect((result.items as any[])[0].password).toBe("[REDACTED]");
      expect((result.items as any[])[1].label).toBe("ok");
    });
  });

  describe("escapeHtml", () => {
    it("escapes angle brackets", () => {
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    });
    it("escapes ampersand", () => {
      expect(escapeHtml("a&b")).toBe("a&amp;b");
    });
    it("escapes quotes", () => {
      expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
    });
  });

  describe("sanitizeForDisplay", () => {
    it("strips javascript: URIs", () => {
      const result = sanitizeForDisplay("javascript:alert(1)");
      expect(result).not.toContain("javascript:");
    });
    it("truncates long strings", () => {
      const long = "a".repeat(20000);
      const result = sanitizeForDisplay(long);
      expect(result.length).toBeLessThan(11000);
    });
  });

  describe("signMessage / verifyMessage", () => {
    it("round-trips a valid message", () => {
      const signed = signMessage({ data: 42 });
      const result = verifyMessage(signed);
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual({ data: 42 });
    });

    it("rejects tampered checksum", () => {
      const signed = signMessage({ data: 42 });
      signed.checksum = "bad";
      expect(verifyMessage(signed).valid).toBe(false);
    });

    it("rejects wrong prefix", () => {
      const signed = signMessage("hello");
      signed.prefix = "WRONG";
      expect(verifyMessage(signed).valid).toBe(false);
    });
  });

  describe("checkApiCompatibility", () => {
    it("returns true for matching major.minor", () => {
      expect(checkApiCompatibility("0.65.3")).toBe(true);
    });
    it("returns false for different major.minor", () => {
      expect(checkApiCompatibility("1.0.0")).toBe(false);
    });
    it("returns false for garbage", () => {
      expect(checkApiCompatibility("not-a-version")).toBe(false);
    });
  });

  describe("permissions", () => {
    it("grant and check", () => {
      grantPermission("ext1", "hud:read");
      expect(hasPermission("ext1", "hud:read")).toBe(true);
      expect(hasPermission("ext1", "hud:write")).toBe(false);
    });

    it("revoke specific", () => {
      grantPermission("ext2", "hud:write");
      revokePermission("ext2", "hud:write");
      expect(hasPermission("ext2", "hud:write")).toBe(false);
    });

    it("revoke all", () => {
      grantPermission("ext3", "hud:read");
      grantPermission("ext3", "hud:write");
      revokeAllPermissions("ext3");
      expect(hasPermission("ext3", "hud:read")).toBe(false);
      expect(hasPermission("ext3", "hud:write")).toBe(false);
    });
  });

  describe("security log", () => {
    it("logs and retrieves events", () => {
      logSecurityEvent("secret_detected", "test", "low");
      const log = getSecurityLog(1);
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe("secret_detected");
    });

    it("hasHighSeverityEvents detects high severity", () => {
      logSecurityEvent("permission_rejected", "blocked", "high");
      expect(hasHighSeverityEvents()).toBe(true);
    });
  });
});
