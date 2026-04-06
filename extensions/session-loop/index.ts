// extensions/session-loop/index.ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { JobScheduler } from './scheduler.js';
import { registerLoopCommands } from './commands.js';

export default function sessionLoopExtension(pi: ExtensionAPI) {
  console.log('[session-loop] Extension loading...');

  const scheduler = new JobScheduler(
    // Execute prompt callback (fire-and-forget)
    async (prompt, _signal) => {
      pi.sendUserMessage(prompt);
    },
    // Error callback
    async (jobId, error) => {
      console.error(`[session-loop] Job ${jobId} error:`, error.message);
    }
  );

  registerLoopCommands(pi, scheduler);

  // session_shutdown: immediately abort all jobs
  pi.on('session_shutdown', async () => {
    console.log('[session-loop] Session shutting down, aborting all jobs...');
    const stopped = scheduler.stopAll();
    if (stopped.length > 0) {
      console.log(
        `[session-loop] Cleaned up ${stopped.length} job(s): ${stopped.map(j => j.id).join(', ')}`
      );
    }

    // Grace period for executing jobs to notice the abort signal
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('[session-loop] Cleanup complete');
  });

  // turn_end: log active job count
  pi.on('turn_end', async () => {
    const stats = scheduler.getStats();
    if (stats.totalJobs > 0) {
      console.log(
        `[session-loop] ${stats.totalJobs} job(s) active, ${stats.executingJobs} executing`
      );
    }
  });

  console.log(
    '[session-loop] Extension loaded. Commands: /loop, /loop-stop, /loop-list, /loop-stop-all'
  );
}
