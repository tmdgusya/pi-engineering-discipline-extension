// extensions/session-loop/commands.ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { JobScheduler, parseInterval } from './scheduler.js';
import { LoopError } from './types.js';

export function registerLoopCommands(pi: ExtensionAPI, scheduler: JobScheduler) {
  // /loop <interval> <prompt>
  pi.registerCommand('loop', {
    description: 'Schedule a prompt to run on a recurring interval (e.g., /loop 5m check status)',
    getArgumentCompletions: (prefix) => {
      const intervals = ['5s', '10s', '30s', '1m', '5m', '10m', '30m', '1h'];
      return intervals
        .filter(i => i.startsWith(prefix))
        .map(i => ({ value: i, label: i, description: `Run every ${i}` }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (!trimmed) {
        ctx.ui.notify('Usage: /loop <interval> <prompt>', 'warning');
        return;
      }

      const parts = trimmed.split(/\s+/);
      let intervalStr: string;
      let prompt: string;

      try {
        parseInterval(parts[0]);
        intervalStr = parts[0];
        prompt = parts.slice(1).join(' ');
      } catch {
        intervalStr = '1m';
        prompt = trimmed;
      }

      if (!prompt) {
        ctx.ui.notify('Error: Prompt is required. Usage: /loop <interval> <prompt>', 'error');
        return;
      }

      try {
        const job = scheduler.schedule(intervalStr, prompt);
        ctx.ui.notify(`Scheduled job ${job.id}: "${prompt}" every ${intervalStr}`, 'info');
        console.log(`[session-loop] Created job ${job.id} with interval ${intervalStr}`);
      } catch (error) {
        if (error instanceof LoopError) {
          ctx.ui.notify(`Error: ${error.message}`, 'error');
        } else {
          ctx.ui.notify(`Unexpected error: ${error}`, 'error');
        }
      }
    },
  });

  // /loop-stop [job-id]
  pi.registerCommand('loop-stop', {
    description: 'Stop a specific loop job by ID (interactive select if no ID given)',
    handler: async (args, ctx) => {
      const jobId = args.trim();

      if (!jobId) {
        const jobs = scheduler.list();
        if (jobs.length === 0) {
          ctx.ui.notify('No active jobs to stop', 'warning');
          return;
        }

        // ctx.ui.select() accepts string[] — format: "jobId | interval | prompt"
        const options = jobs.map(
          j => `${j.id} | every ${j.intervalMs}ms | ${j.prompt.substring(0, 40)}`
        );
        const selected = await ctx.ui.select('Select a job to stop:', options);

        if (!selected) return;

        // Extract job ID from the formatted string (first segment before " | ")
        const selectedJobId = selected.split(' | ')[0];

        try {
          const stopped = scheduler.stop(selectedJobId);
          ctx.ui.notify(`Stopped job ${stopped.id}`, 'info');
        } catch (error) {
          ctx.ui.notify(
            `Error: ${error instanceof Error ? error.message : error}`,
            'error'
          );
        }
        return;
      }

      try {
        const stopped = scheduler.stop(jobId);
        ctx.ui.notify(`Stopped job ${stopped.id}`, 'info');
      } catch (error) {
        if (error instanceof LoopError && error.code === 'JOB_NOT_FOUND') {
          ctx.ui.notify(`Error: Job ${jobId} not found`, 'error');
        } else {
          ctx.ui.notify(
            `Error: ${error instanceof Error ? error.message : error}`,
            'error'
          );
        }
      }
    },
  });

  // /loop-list
  pi.registerCommand('loop-list', {
    description: 'List all active loop jobs',
    handler: async (_args, ctx) => {
      const jobs = scheduler.list();
      const stats = scheduler.getStats();

      if (jobs.length === 0) {
        ctx.ui.notify('No active jobs', 'info');
        return;
      }

      console.log('\n📋 Active Loop Jobs');
      console.log('='.repeat(60));

      for (const job of jobs) {
        const lastRun = job.lastRunAt ? job.lastRunAt.toLocaleTimeString() : 'never';
        const nextRun = job.nextRunAt ? job.nextRunAt.toLocaleTimeString() : 'calculating...';
        const intervalSec = Math.round(job.intervalMs / 1000);

        console.log(`\n  Job: ${job.id}`);
        console.log(`  Prompt: ${job.prompt}`);
        console.log(`  Interval: ${intervalSec}s (${job.intervalMs}ms)`);
        console.log(`  Runs: ${job.runCount} | Errors: ${job.errorCount}`);
        console.log(`  Last run: ${lastRun} | Next run: ${nextRun}`);
      }

      console.log('\n📊 Stats');
      console.log(`  Total jobs: ${stats.totalJobs}`);
      console.log(`  Executing now: ${stats.executingJobs}`);
      console.log(`  Total runs: ${stats.totalExecutions}`);
      console.log(`  Total errors: ${stats.totalErrors}`);
      console.log('='.repeat(60) + '\n');

      ctx.ui.notify(`Found ${jobs.length} active job(s)`, 'info');
    },
  });

  // /loop-stop-all
  pi.registerCommand('loop-stop-all', {
    description: 'Stop all active loop jobs',
    handler: async (_args, ctx) => {
      const jobs = scheduler.list();

      if (jobs.length === 0) {
        ctx.ui.notify('No active jobs to stop', 'warning');
        return;
      }

      const confirmed = await ctx.ui.confirm(
        'Stop all jobs?',
        `This will stop ${jobs.length} job(s).`
      );

      if (!confirmed) {
        ctx.ui.notify('Cancelled', 'info');
        return;
      }

      const stopped = scheduler.stopAll();
      ctx.ui.notify(`Stopped ${stopped.length} job(s)`, 'info');
      console.log(`[session-loop] Stopped all jobs: ${stopped.map(j => j.id).join(', ')}`);
    },
  });
}
