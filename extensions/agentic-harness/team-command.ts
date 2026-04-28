export interface ParsedTeamCommand {
  goal: string;
  agent?: string;
  backend?: "auto" | "native" | "tmux";
  workerCount?: number;
  worktreePolicy?: "off" | "on" | "auto";
  resume?: string;
  resumeMode?: "mark-interrupted" | "retry-stale";
  maxOutput?: number;
  commandTarget?: string;
  commandMessage?: string;
}

const BACKENDS = ["auto", "native", "tmux"] as const;
const WORKTREE_POLICIES = ["off", "on", "auto"] as const;
const RESUME_MODES = ["mark-interrupted", "retry-stale"] as const;

export const TEAM_COMMAND_KEYS = [
  "goal",
  "agent",
  "backend",
  "worker-count",
  "worktree-policy",
  "resume",
  "resume-mode",
  "max-output",
  "command",
  "message",
] as const;

export const TEAM_BACKEND_VALUES = BACKENDS;
export const TEAM_WORKTREE_POLICY_VALUES = WORKTREE_POLICIES;
export const TEAM_RESUME_MODE_VALUES = RESUME_MODES;

const isBackend = (v: string): v is (typeof BACKENDS)[number] =>
  (BACKENDS as readonly string[]).includes(v);
const isWorktreePolicy = (v: string): v is (typeof WORKTREE_POLICIES)[number] =>
  (WORKTREE_POLICIES as readonly string[]).includes(v);
const isResumeMode = (v: string): v is (typeof RESUME_MODES)[number] =>
  (RESUME_MODES as readonly string[]).includes(v);

export function parseTeamArgs(input: string): ParsedTeamCommand {
  const tokens = tokenize(input);
  const out: ParsedTeamCommand = { goal: "" };
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq < 0) {
      if (!out.goal) out.goal = stripQuotes(tok);
      continue;
    }
    const key = tok.slice(0, eq).trim().toLowerCase();
    const raw = stripQuotes(tok.slice(eq + 1));
    switch (key) {
      case "goal":
        out.goal = raw;
        break;
      case "agent":
        if (raw) out.agent = raw;
        break;
      case "backend":
        if (isBackend(raw)) out.backend = raw;
        break;
      case "worker-count":
      case "workercount": {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) out.workerCount = Math.floor(n);
        break;
      }
      case "worktree-policy":
      case "worktreepolicy":
        if (isWorktreePolicy(raw)) out.worktreePolicy = raw;
        break;
      case "resume":
      case "resume-run-id":
      case "resumerunid":
        if (raw) out.resume = raw;
        break;
      case "resume-mode":
      case "resumemode":
        if (isResumeMode(raw)) out.resumeMode = raw;
        break;
      case "max-output":
      case "maxoutput": {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) out.maxOutput = Math.floor(n);
        break;
      }
      case "command":
      case "command-target":
      case "commandtarget":
        if (raw) out.commandTarget = raw;
        break;
      case "message":
      case "command-message":
      case "commandmessage":
        if (raw) out.commandMessage = raw;
        break;
    }
  }
  return out;
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n") {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

export function isTeamFollowUpCommand(parsed: ParsedTeamCommand): boolean {
  return !!(parsed.resume && parsed.commandTarget && parsed.commandMessage);
}

export function buildTeamCommandPrompt(parsed: ParsedTeamCommand): string {
  const isFollowUp = isTeamFollowUpCommand(parsed);
  const params: string[] = [];
  if (!isFollowUp) params.push(`goal=${JSON.stringify(parsed.goal)}`);
  if (parsed.agent) params.push(`agent=${JSON.stringify(parsed.agent)}`);
  if (parsed.workerCount !== undefined) params.push(`workerCount=${parsed.workerCount}`);
  if (parsed.backend) params.push(`backend=${JSON.stringify(parsed.backend)}`);
  if (parsed.worktreePolicy) params.push(`worktreePolicy=${JSON.stringify(parsed.worktreePolicy)}`);
  if (parsed.resume) params.push(`resumeRunId=${JSON.stringify(parsed.resume)}`);
  if (parsed.resumeMode) params.push(`resumeMode=${JSON.stringify(parsed.resumeMode)}`);
  if (parsed.maxOutput !== undefined) params.push(`maxOutput=${parsed.maxOutput}`);
  if (parsed.commandTarget) params.push(`commandTarget=${JSON.stringify(parsed.commandTarget)}`);
  if (parsed.commandMessage) params.push(`commandMessage=${JSON.stringify(parsed.commandMessage)}`);
  if (isFollowUp) {
    return [
      "The user wants to enqueue a durable follow-up command for an existing team run.",
      "Invoke the `team` tool in follow-up command mode with these parameters verbatim:",
      params.map((p) => `  ${p}`).join("\n"),
      "Do not create a new team goal. The existing run is the source of truth; enqueue the command before any tmux wake-up attempt and report the durable command result.",
    ].join("\n\n");
  }
  return [
    "The user wants to dispatch a lightweight native team run.",
    "Invoke the `team` tool with these parameters verbatim:",
    params.map((p) => `  ${p}`).join("\n"),
    "Do not modify the goal or expand it. Use the existing team tool guidelines to split the goal into bounded worker tasks. Report the synthesis after the tool returns.",
  ].join("\n\n");
}

export interface TeamAutocompleteSources {
  listAgents(): Promise<string[]> | string[];
  listResumeRuns(): Promise<{ runId: string; status: string }[]> | { runId: string; status: string }[];
  resumeLimit?: number;
}

export interface TeamCompletionItem {
  value: string;
  label: string;
  description?: string;
}

function lastToken(argumentPrefix: string): { fragment: string } {
  const trimmed = argumentPrefix.replace(/^\s+/, "");
  const lastSpace = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
  return { fragment: lastSpace < 0 ? trimmed : trimmed.slice(lastSpace + 1) };
}

export async function getTeamArgumentCompletions(
  argumentPrefix: string,
  sources: TeamAutocompleteSources,
): Promise<TeamCompletionItem[]> {
  const { fragment } = lastToken(argumentPrefix);
  const limit = sources.resumeLimit ?? 20;
  const eq = fragment.indexOf("=");
  if (eq < 0) {
    return TEAM_COMMAND_KEYS.filter((k) => k.startsWith(fragment.toLowerCase())).map((k) => ({
      value: `${k}=`,
      label: `${k}=`,
      description: keyDescription(k),
    }));
  }
  const key = fragment.slice(0, eq).toLowerCase();
  const partial = fragment.slice(eq + 1).toLowerCase();
  const fromValues = (values: readonly string[]): TeamCompletionItem[] =>
    values
      .filter((v) => v.toLowerCase().startsWith(partial))
      .map((v) => ({ value: `${key}=${v}`, label: `${key}=${v}` }));
  switch (key) {
    case "agent": {
      const all = await sources.listAgents();
      return all
        .filter((a) => a.toLowerCase().startsWith(partial))
        .map((a) => ({ value: `${key}=${a}`, label: `${key}=${a}` }));
    }
    case "backend":
      return fromValues(BACKENDS);
    case "worktree-policy":
    case "worktreepolicy":
      return fromValues(WORKTREE_POLICIES);
    case "resume-mode":
    case "resumemode":
      return fromValues(RESUME_MODES);
    case "resume":
    case "resume-run-id":
    case "resumerunid": {
      const runs = await sources.listResumeRuns();
      return runs
        .filter((r) => r.runId.toLowerCase().startsWith(partial))
        .slice(0, limit)
        .map((r) => ({
          value: `${key}=${r.runId}`,
          label: `${key}=${r.runId}`,
          description: r.status,
        }));
    }
    default:
      return [];
  }
}

function keyDescription(key: string): string | undefined {
  switch (key) {
    case "goal":
      return "Required. Quoted goal for the team run.";
    case "agent":
      return "Worker agent name. Default: worker.";
    case "backend":
      return "auto | native | tmux. Defaults to auto.";
    case "worker-count":
      return "Number of parallel workers.";
    case "worktree-policy":
      return "off | on | auto.";
    case "resume":
      return "Resume a persisted team run by id.";
    case "resume-mode":
      return "How to handle stale in-progress tasks when resuming.";
    case "max-output":
      return "Cap retained worker output characters.";
    case "command":
      return "Follow-up target worker owner or task id for an existing resumed run.";
    case "message":
      return "Follow-up command message to enqueue for the target.";
    default:
      return undefined;
  }
}
