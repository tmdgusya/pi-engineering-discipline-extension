// plan-parser.ts
/**
 * Parses plan markdown files into structured task data.
 * Used to enforce the validator information barrier —
 * validator prompts are built from parsed plan data, not LLM-composed text.
 */

export interface PlanTask {
  /** Task number extracted from "### Task N:" header */
  id: number;
  /** Task name (text after "Task N:") */
  name: string;
  /** Raw dependencies line */
  dependencies: string;
  /** All file paths (Create, Modify, Test) */
  files: string[];
  /** Commands extracted from "Run: `...`" lines */
  testCommands: string[];
  /** Criteria extracted from "Expected: ..." lines, paired with their Run commands */
  acceptanceCriteria: string[];
  /** Whether this is the final verification task */
  isFinal: boolean;
  /** Full text of all steps (for reference, not sent to validator) */
  fullStepsText: string;
}

export interface ParsedPlan {
  /** Plan goal from "**Goal:**" line */
  goal: string;
  /** Verification command from Verification Strategy */
  verificationCommand: string;
  /** All parsed tasks */
  tasks: PlanTask[];
}

export function parsePlan(markdown: string): ParsedPlan {
  const goal = extractField(markdown, "Goal");
  const verificationCommand = extractVerificationCommand(markdown);
  const tasks = extractTasks(markdown);
  return { goal, verificationCommand, tasks };
}

function extractField(md: string, field: string): string {
  const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, "m");
  const match = md.match(re);
  return match ? match[1].trim() : "";
}

function extractVerificationCommand(md: string): string {
  const match = md.match(/\*\*Command:\*\*\s*`([^`]+)`/m);
  return match ? match[1].trim() : "";
}

function extractTasks(md: string): PlanTask[] {
  // Split on task headers: ### Task N: ... or ### Task N (Final): ...
  const taskHeaderRe = /^### Task (\d+)(?:\s*\(Final\))?:\s*(.+)$/gm;
  const headers: { index: number; id: number; name: string; isFinal: boolean }[] = [];

  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = taskHeaderRe.exec(md)) !== null) {
    headers.push({
      index: headerMatch.index,
      id: parseInt(headerMatch[1], 10),
      name: headerMatch[2].trim(),
      isFinal: headerMatch[0].includes("(Final)"),
    });
  }

  const tasks: PlanTask[] = [];

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : md.length;
    const section = md.slice(start, end);

    const dependencies = extractField(section, "Dependencies");
    const files = extractFiles(section);
    const { testCommands, acceptanceCriteria } = extractRunExpected(section);
    const fullStepsText = extractStepsText(section);

    tasks.push({
      id: headers[i].id,
      name: headers[i].name,
      dependencies,
      files,
      testCommands,
      acceptanceCriteria,
      isFinal: headers[i].isFinal,
      fullStepsText,
    });
  }

  return tasks;
}

function extractFiles(section: string): string[] {
  const files: string[] = [];
  const fileRe = /(?:Create|Modify|Test):\s*`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(section)) !== null) {
    // Strip line range suffixes like ":123-145"
    const path = m[1].replace(/:\d+-\d+$/, "");
    if (!files.includes(path)) files.push(path);
  }
  return files;
}

function extractRunExpected(section: string): {
  testCommands: string[];
  acceptanceCriteria: string[];
} {
  const testCommands: string[] = [];
  const acceptanceCriteria: string[] = [];
  const lines = section.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const runMatch = lines[i].match(/^Run:\s*`([^`]+)`/);
    if (runMatch) {
      const cmd = runMatch[1].trim();
      if (!testCommands.includes(cmd)) testCommands.push(cmd);

      // Look for Expected: on the next line
      if (i + 1 < lines.length) {
        const expMatch = lines[i + 1].match(/^Expected:\s*(.+)/);
        if (expMatch) {
          acceptanceCriteria.push(`${cmd} → ${expMatch[1].trim()}`);
        }
      }
    }
  }

  return { testCommands, acceptanceCriteria };
}

function extractStepsText(section: string): string {
  const match = section.match(/^- \[ \] \*\*Step 1:/m);
  if (!match || match.index === undefined) return "";
  return section.slice(match.index).trim();
}
