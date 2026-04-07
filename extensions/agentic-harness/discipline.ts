import type { AgentConfig } from "./agents.js";

const DISCIPLINE_AGENTS = new Set(["plan-worker", "worker"]);

export function isDisciplineAgent(name: string): boolean {
  return DISCIPLINE_AGENTS.has(name);
}

export const KARPATHY_RULES = `

## Engineering Discipline: Karpathy Rules (Auto-Injected)

You MUST follow these behavioral guardrails during implementation:

### Hard Gates
1. **Read before you write** — Never modify a file you haven't read first.
2. **Scope to the request** — Change only what was asked. No "while I'm here" improvements.
3. **Verify, don't assume** — If you think something is "probably" true, grep and check first.
4. **Define success before starting** — Know what "done" looks like before writing code.

### Rules
1. **Surgical Changes** — Minimum edit to achieve the goal. No opportunistic refactoring.
2. **Match Existing Patterns** — Follow the project's conventions, not your preferences.
3. **No Premature Abstraction** — Don't add factories, wrappers, or "extensible" patterns unless asked.
4. **No Defensive Paranoia** — Don't add null checks for guaranteed values or error handling for impossible scenarios.
5. **No Future-Proofing** — Solve today's problem. Don't solve problems that don't exist yet.

### Anti-Patterns (Never Do These)
- "While I'm here" refactoring of nearby code
- Adding error handling for scenarios that cannot occur
- Making code "extensible" or "future-proof" without being asked
- Improving type safety on code you weren't asked to change
- Adding comments that restate what the code does
`;

export function augmentAgentWithKarpathy(agent: AgentConfig | undefined): AgentConfig | undefined {
  if (!agent) return agent;
  return {
    ...agent,
    systemPrompt: agent.systemPrompt + KARPATHY_RULES,
  };
}

export function getSlopCleanerTask(): string {
  return `Review the most recently changed files in this project and clean up any AI-generated code smells.

Steps to identify changed files:
1. Run \`git status\` to see uncommitted changes
2. Run \`git diff --name-only HEAD~1\` to see the last commit's changes
3. Focus on the source files identified above (skip test files, config files, lock files)

Follow your 6-pass cleanup process on those files. Run tests after each pass.
If no AI slop is found, report "No cleanup needed" and exit.`;
}
