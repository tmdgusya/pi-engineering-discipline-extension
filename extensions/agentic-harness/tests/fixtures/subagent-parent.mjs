import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const grandchildScript = join(__dirname, "subagent-grandchild.mjs");
const stateFile = process.env.FIXTURE_STATE_FILE;
const taskArg = process.argv.find((arg) => arg.startsWith("Task: ")) || "Task: success-hang";
const mode = taskArg.replace(/^Task:\s*/, "").trim();

function updateState(patch) {
  if (!stateFile) return;
  const current = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf8") || "{}")
    : {};
  writeFileSync(stateFile, JSON.stringify({ ...current, ...patch }), "utf8");
}

const grandchild = spawn(process.execPath, [grandchildScript], {
  cwd: process.cwd(),
  stdio: ["ignore", "ignore", "ignore"],
  env: process.env,
});

grandchild.unref();

updateState({
  parentPid: process.pid,
  mode,
  runId: process.env.PI_SUBAGENT_RUN_ID,
  parentRunId: process.env.PI_SUBAGENT_PARENT_RUN_ID,
  rootRunId: process.env.PI_SUBAGENT_ROOT_RUN_ID,
  owner: process.env.PI_SUBAGENT_OWNER,
  grandchildPid: grandchild.pid,
});

const assistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: mode === "success-hang" ? "fixture complete" : mode === "agent-end-fail" ? "fixture failed after completion" : "fixture waiting" }],
};

console.log(JSON.stringify({ type: "message_end", message: assistantMessage }));
if (mode === "success-hang" || mode === "agent-end-fail") {
  console.log(JSON.stringify({ type: "agent_end", messages: [assistantMessage] }));
}

if (mode === "agent-end-fail") {
  setTimeout(() => {
    process.exit(1);
  }, 25);
} else {
  setInterval(() => {
    // keep process and descendant alive until parent kills the process group
  }, 1000);
}
