import type { ExtensionState } from "./state.js";
import { PI_TOOL_NAME_SET } from "./pi-tools.js";

/** Tool results older than this are truncated during microcompaction (60 min) */
export const MICROCOMPACT_AGE_MS = 60 * 60 * 1000;

const COMPACTABLE_TOOLS = PI_TOOL_NAME_SET;

export function microcompactMessages<T extends { role: string; timestamp: number; toolName?: string; isError?: boolean; content?: any }>(
  messages: T[],
  now: number = Date.now(),
): T[] {
  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (msg.isError) return msg;
    if (!msg.toolName || !COMPACTABLE_TOOLS.has(msg.toolName)) return msg;

    const age = now - msg.timestamp;
    if (age < MICROCOMPACT_AGE_MS) return msg;

    // Truncate old tool result content
    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
          if (c.type !== "text") return c;
          return {
            ...c,
            text: `[Compacted] ${msg.toolName} result, ${Math.round(age / 60000)}min ago`,
          };
        })
      : msg.content;

    return { ...msg, content };
  });
}

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool. Tool calls will be REJECTED and will waste your only turn.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`;

const NO_TOOLS_TRAILER =
  "\n\nREMINDER: Do NOT call any tools. Respond with plain text only — " +
  "an <analysis> block followed by a <summary> block.";

function getPhaseSection(
  phase: ExtensionState["phase"],
  goalDoc: string | null,
): string {
  if (phase === "idle") return "";

  const docRef = goalDoc
    ? `\n\nACTIVE GOAL DOCUMENT: \`${goalDoc}\`\nThis document contains the authoritative goal for the current work. Reference it in your summary to anchor the user's intent.\n`
    : "";

  switch (phase) {
    case "clarifying":
      if (!goalDoc) return "";
      return `${docRef}
## Active Workflow: Agentic Clarification
The session is in agentic-clarification mode. Your summary MUST emphasize:
- What scope has been established vs. what remains ambiguous
- Key decisions made during Q&A
- The state of the Context Brief (complete, in-progress, or not yet started)`;

    case "planning":
      if (!goalDoc) return "";
      return `${docRef}
## Active Workflow: Agentic Plan Crafting
The session is in agentic-plan-crafting mode. Your summary MUST emphasize:
- Overall task progress — which plan tasks are done, in-progress, or blocked
- Key implementation decisions and their rationale
- Current task being worked on and its exact state`;

    case "ultraplanning":
      if (!goalDoc) return "";
      return `${docRef}
## Active Workflow: Agentic Milestone Planning
The session is in agentic-milestone-planning mode. Your summary MUST emphasize:
- Which reviewers have completed and their key findings
- The state of the milestone DAG (complete, in-progress)
- Trade-off decisions made with the user`;

    case "reviewing":
      return `${docRef}
## Active Workflow: Code Review
The session is in /review mode. Your summary MUST emphasize:
- The resolved review target (PR, branch, or local diff) and how it was obtained
- The files and diff regions that were inspected
- The current finding set across bugs, security, performance, test coverage, and consistency
- Whether the review concluded with findings or with \"No changes to review\"`;

    case "ultrareviewing":
      return `${docRef}
## Active Workflow: Deep Code Review
The session is in /ultrareview mode. Your summary MUST emphasize:
- The resolved review target and where the shared diff artifact/report path was written
- Stage 1 reviewer coverage (roles, seeds, and whether all 10 completed)
- Stage 2 verification status and the final surviving findings
- Stage 3 synthesis status, saved report path, and top-priority findings streamed to chat`;

    default:
      return "";
  }
}

export function getCompactionPrompt(
  phase: ExtensionState["phase"],
  goalDoc: string | null,
  customInstructions?: string,
): string {
  const phaseSection = getPhaseSection(phase, goalDoc);

  let prompt = `${NO_TOOLS_PREAMBLE}Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like file names, full code snippets, function signatures, file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness.
${phaseSection}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable and a summary of why each file is important.
4. Errors and Fixes: List all errors encountered and how they were fixed. Include user feedback.
5. Problem Solving: Document problems solved and ongoing troubleshooting efforts.
6. All User Messages: List ALL user messages that are not tool results. These are critical for understanding the user's feedback and changing intent.
7. Pending Tasks: Outline any pending tasks you have been explicitly asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request. Include file names and code snippets.
9. Optional Next Step: List the next step directly in line with the user's most recent explicit request. Include direct quotes from the most recent conversation to prevent task drift.

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Important Code Snippet]

4. Errors and Fixes:
    - [Error description]:
      - [How you fixed it]

5. Problem Solving:
   [Description]

6. All User Messages:
    - [Detailed non tool use user message]

7. Pending Tasks:
   - [Task 1]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]
</summary>
</example>

Please provide your summary based on the conversation so far, following this structure.`;

  if (customInstructions?.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }

  prompt += NO_TOOLS_TRAILER;

  return prompt;
}

export function formatCompactSummary(summary: string): string {
  let formatted = summary;

  // Strip analysis scratchpad
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, "");

  // Extract summary block
  const match = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${(match[1] || "").trim()}`,
    );
  }

  // Clean extra whitespace
  formatted = formatted.replace(/\n\n+/g, "\n\n");

  return formatted.trim();
}
