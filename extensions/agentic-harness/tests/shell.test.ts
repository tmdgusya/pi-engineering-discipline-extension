import { describe, expect, it } from "vitest";
import { shellQuote } from "../shell.js";

describe("shellQuote", () => {
  it("quotes paths with spaces and shell metacharacters", () => {
    expect(shellQuote("/Users/John Doe/a;b&c`d$e.log")).toBe("'/Users/John Doe/a;b&c`d$e.log'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("/tmp/it's.log")).toBe("'/tmp/it'\\''s.log'");
  });

  it("uses ANSI-C quoting when value contains a literal newline", () => {
    const out = shellQuote("first\nsecond");
    expect(out).toBe("$'first\\nsecond'");
    expect(out.includes("\n")).toBe(false);
  });

  it("uses ANSI-C quoting for tab, carriage return, and other control bytes", () => {
    expect(shellQuote("a\tb")).toBe("$'a\\tb'");
    expect(shellQuote("a\rb")).toBe("$'a\\rb'");
    expect(shellQuote("a\x07b")).toBe("$'a\\x07b'");
    expect(shellQuote("a\x00b")).toBe("$'a\\x00b'");
    expect(shellQuote("a\x7fb")).toBe("$'a\\x7fb'");
  });

  it("escapes backslash and single quote inside ANSI-C output", () => {
    const out = shellQuote("it's\nback\\slash");
    expect(out).toBe("$'it\\'s\\nback\\\\slash'");
    expect(out.includes("\n")).toBe(false);
  });

  it("never emits a raw control byte for any input that contains one", () => {
    const samples = [
      "\n",
      "leading\nbody",
      "trailing\n",
      "multi\nline\nprompt\nwith\nmany\nbreaks",
      "tabs\tand\nnewlines",
      "with\rcarriage",
      "quoted'with\nlf",
      "한글 멀티\n라인 프롬프트",
    ];
    for (const value of samples) {
      const quoted = shellQuote(value);
      expect(quoted).toMatch(/^\$'.*'$/);
      // No raw byte in 0x00-0x1f or 0x7f survives in the quoted output.
      expect(/[\x00-\x1f\x7f]/.test(quoted)).toBe(false);
    }
  });
});
