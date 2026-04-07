import type { PlanTask } from "./plan-parser.js";

export function buildValidatorPrompt(
  task: PlanTask,
  verificationCommand?: string,
): string {
  const filesSection = task.files.length > 0
    ? task.files.map((f) => `- \`${f}\``).join("\n")
    : "- (No specific files listed)";

  const criteriaSection = task.acceptanceCriteria.length > 0
    ? task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")
    : "- All files listed above exist and contain correct implementation";

  const testSection = buildTestSection(task.testCommands, verificationCommand);

  return `You are an independent validator. You have no knowledge of how this task
was implemented. Your job is to judge whether the codebase currently meets
the goal described below, by reading files and running tests yourself.

## Task Goal

${task.name}

## Acceptance Criteria

${criteriaSection}

## Files To Inspect

${filesSection}

## Test Commands

${testSection}

## Your Review Process

1. Read each file in the file list directly from disk.
2. For each acceptance criterion, determine whether it is met
   based on what you see in the code. Record PASS or FAIL per criterion.
3. Run every test command listed above. Record results.
4. Run the full test suite to check for regressions.
5. Check for residual issues: placeholder code (TODO, FIXME, stubs),
   debug code (console.log, print statements), commented-out blocks.

## Your Output

Report your verdict as PASS or FAIL.

- If PASS: confirm which criteria were verified and which tests passed.
- If FAIL: list exactly which criteria failed and why, with file paths
  and line numbers. Do not suggest fixes — only describe what is wrong.`;
}

function buildTestSection(
  testCommands: string[],
  verificationCommand?: string,
): string {
  const parts: string[] = [];

  if (testCommands.length > 0) {
    parts.push("### Task-Specific Tests");
    for (const cmd of testCommands) {
      parts.push(`- \`${cmd}\``);
    }
  } else {
    parts.push("No specific test commands for this task.");
  }

  if (verificationCommand) {
    parts.push("");
    parts.push("### Full Test Suite");
    parts.push(`- \`${verificationCommand}\``);
  }

  return parts.join("\n");
}
