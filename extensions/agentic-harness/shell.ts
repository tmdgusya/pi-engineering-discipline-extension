// POSIX `'...'` quoting is unsafe when the value contains control characters
// (LF, CR, NUL, …) AND the result is delivered to a TTY via tmux send-keys —
// the pty interprets a literal 0x0A byte as Enter, which can break commands
// mid-arg (see TEAM_ARCH.md / tests/tmux-command.test.ts). Switch to ANSI-C
// quoting (`$'...'`, supported by bash 3.2+ and zsh) so control bytes travel
// as escape sequences.
export function shellQuote(value: string): string {
  if (!/[\x00-\x1f\x7f]/.test(value)) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `$'${escaped}'`;
}
