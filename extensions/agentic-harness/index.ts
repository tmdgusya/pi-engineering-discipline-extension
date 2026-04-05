import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  // 1. Clarify Command
  pi.registerCommand("clarify", {
    description: "Start the clarification Q&A loop to resolve ambiguity",
    handler: async (args, ctx) => {
      const goal = await ctx.ui.input("What is the end goal of this work?", args || "");
      if (!goal) return;

      const scope = await ctx.ui.input("What's included and what's excluded?", "");
      if (!scope) return;

      const constraints = await ctx.ui.input("Are there existing constraints (time, dependencies)?", "");
      if (!constraints) return;

      ctx.ui.setStatus("harness", "Exploring codebase & synthesizing...");
      
      pi.sendUserMessage(
        `I need to clarify a task.\nGoal: ${goal}\nScope: ${scope}\nConstraints: ${constraints}\n\nPlease generate a Context Brief based on your analysis.`
      );
      
      ctx.ui.setStatus("harness", undefined);
    }
  });

  // 2. Plan Command
  pi.registerCommand("plan", {
    description: "Generate an implementation plan from a Context Brief",
    handler: async (args, ctx) => {
      const ok = await ctx.ui.confirm("Craft Plan", "Do you want to start plan crafting based on the current context?");
      if (!ok) return;

      ctx.ui.setStatus("harness", "Crafting implementation plan...");
      
      pi.sendUserMessage(
        `Please write an executable implementation plan for the current context following the plan-crafting skill rules. Ensure there are no placeholders and full verification is included.`
      );
      
      ctx.ui.setStatus("harness", undefined);
    }
  });

  // 3. Ultraplan Command (Milestone Planning)
  pi.registerCommand("ultraplan", {
    description: "Spawn parallel reviewers to generate a milestone DAG",
    handler: async (args, ctx) => {
      const confirmed = await ctx.ui.confirm(
        "Start Ultraplan", 
        "This will decompose the complex task into milestones. Continue?"
      );
      
      if (!confirmed) return;

      // Launch Custom TUI Dashboard to monitor parallel agents
      const reports = await ctx.ui.custom<Record<string, string>>((tui, theme, keybindings, done) => {
        const text = new Text("", 1, 1);
        
        const agents = [
          { name: "Security", status: "Starting...", done: false },
          { name: "Architecture", status: "Starting...", done: false },
          { name: "Data Flow", status: "Starting...", done: false },
          { name: "Edge Cases", status: "Starting...", done: false },
          { name: "UX & State", status: "Starting...", done: false },
        ];
        
        const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let frame = 0;
        
        const updateText = () => {
          let content = theme.fg("accent", "╭─ Ultraplan Milestone Review ─────────────────────────────╮\n");
          content += theme.fg("accent", "│") + "                                                          " + theme.fg("accent", "│\n");
          
          let doneCount = 0;
          for (const a of agents) {
            if (a.done) doneCount++;
            
            const icon = a.done ? theme.fg("success", "[✓]") : theme.fg("warning", `[${spinner[frame % spinner.length]}]`);
            const paddedName = a.name.padEnd(16);
            const paddedStatus = a.status.padEnd(27);
            
            content += theme.fg("accent", "│") + `  ${icon} ${theme.bold(paddedName)} : ${paddedStatus}` + theme.fg("accent", "│\n");
          }
          
          content += theme.fg("accent", "│") + "                                                          " + theme.fg("accent", "│\n");
          
          if (doneCount === agents.length) {
            content += theme.fg("accent", "│") + theme.fg("success", "  Synthesizing DAG... (All agents completed)              ") + theme.fg("accent", "│\n");
          } else {
            content += theme.fg("accent", "│") + theme.fg("dim", `  Waiting for agents... (${doneCount}/${agents.length})                           `) + theme.fg("accent", "│\n");
          }
          
          content += theme.fg("accent", "╰──────────────────────────────────────────────────────────╯\n");
          
          text.setText(content);
          tui.invalidate();
        };

        // UI Animation Loop
        const anim = setInterval(() => {
          frame++;
          updateText();
        }, 80);

        const prompts = [
          { name: "Security", prompt: "Perform a security review of the proposed changes. Output a concise bulleted list of risks and mitigations." },
          { name: "Architecture", prompt: "Perform an architectural review of the proposed changes. Focus on coupling, cohesion, and system design. Output a concise bulleted list." },
          { name: "Data Flow", prompt: "Perform a data flow review of the proposed changes. Trace how state moves through the system. Output a concise bulleted list." },
          { name: "Edge Cases", prompt: "Perform an edge case analysis of the proposed changes. Identify unhandled states and failure modes. Output a concise bulleted list." },
          { name: "UX & State", prompt: "Perform a UX and state transition review. Identify loading states, error states, and user flow issues. Output a concise bulleted list." }
        ];

        const outputReports: Record<string, string> = {};

        // Run real parallel execution via pi.exec
        Promise.all(agents.map(async (a, index) => {
          a.status = "Analyzing codebase...";
          const prompt = prompts[index].prompt;
          
          const result = await pi.exec("pi", [
            "-p", 
            "--no-tools", 
            "--no-extensions", 
            "--no-skills", 
            prompt
          ], { signal: ctx.signal });
          
          outputReports[a.name] = result.stdout;
          a.status = "Completed";
          a.done = true;
        })).then(() => {
          setTimeout(() => {
            clearInterval(anim);
            done(outputReports);
          }, 1500);
        });

        updateText();
        return text;
      });

      if (!reports) return; // In case of early abort

      const reviewText = Object.entries(reports)
        .map(([name, output]) => `### ${name} Reviewer\n${output}`)
        .join("\n\n");

      // Send the synthesis prompt to the main agent
      pi.sendUserMessage(
        `All 5 independent reviewers have completed their analysis. Here are their reports:\n\n${reviewText}\n\nPlease synthesize their findings into a milestone dependency DAG based on the ultraplan rules.`
      );
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Agentic Harness extension loaded. Try /clarify, /plan, or /ultraplan.", "info");
  });
}
