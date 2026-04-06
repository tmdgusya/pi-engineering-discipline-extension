import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { JobScheduler } from './scheduler.js';
import { registerLoopCommands } from './commands.js';

export default function sessionLoopExtension(pi: ExtensionAPI) {
  console.log('Extension loading...');

  const scheduler = new JobScheduler(
    async (prompt, _signal) => {
      pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
    },
    async (jobId, error) => {
      console.error(`Job ${jobId} error:`, error.message);
    }
  );

  registerLoopCommands(pi, scheduler);

  pi.on('session_shutdown', async () => {
    const stopped = scheduler.stopAll();
    if (stopped.length > 0) {
      console.log(`Cleaned up ${stopped.length} job(s): ${stopped.map(j => j.id).join(', ')}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  pi.on('turn_end', async () => {
    const stats = scheduler.getStats();
    if (stats.totalJobs > 0) {
      console.log(`${stats.totalJobs} job(s) active, ${stats.executingJobs} executing`);
    }
  });

  console.log('Extension loaded: /loop, /loop-stop, /loop-list, /loop-stop-all');
}
