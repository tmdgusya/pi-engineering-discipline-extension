import { existsSync, readFileSync, writeFileSync } from "fs";

const stateFile = process.env.FIXTURE_STATE_FILE;

function updateState(patch) {
  const current = stateFile && existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf8"))
    : {};
  writeFileSync(stateFile, JSON.stringify({ ...current, ...patch }), "utf8");
}

if (stateFile) {
  updateState({ grandchildPid: process.pid, grandchildStartedAt: new Date().toISOString() });
}

const heartbeat = setInterval(() => {
  // keep process alive for process-tree cleanup tests
}, 1000);

const shutdown = () => {
  clearInterval(heartbeat);
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
