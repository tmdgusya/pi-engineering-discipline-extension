// extensions/session-loop/scheduler.ts
import { LoopJob, LoopJobInternal, ParsedInterval, LoopError, SchedulerStats } from './types.js';

const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 86400000 * 365;
const MAX_CONCURRENT_JOBS = 100;

export function parseInterval(input: string): ParsedInterval {
  const match = input.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    throw new LoopError(
      `Invalid interval format: "${input}". Use format like "5m", "30s", "2h", "1d"`,
      'INVALID_INTERVAL'
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase() as ParsedInterval['unit'];

  if (value <= 0) {
    throw new LoopError('Interval must be greater than 0', 'INVALID_INTERVAL');
  }

  const multipliers: Record<ParsedInterval['unit'], number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  const milliseconds = value * multipliers[unit];

  if (milliseconds < MIN_INTERVAL_MS) {
    throw new LoopError(`Interval too small. Minimum is ${MIN_INTERVAL_MS}ms`, 'INVALID_INTERVAL');
  }

  if (milliseconds > MAX_INTERVAL_MS) {
    throw new LoopError(`Interval too large. Maximum is ${MAX_INTERVAL_MS}ms`, 'INVALID_INTERVAL');
  }

  return { value, unit, milliseconds };
}

export class JobScheduler {
  private jobs = new Map<string, LoopJobInternal>();
  private jobIdCounter = 0;
  private onExecutePrompt: (prompt: string, signal: AbortSignal) => Promise<void>;
  private onError?: (jobId: string, error: Error) => void | Promise<void>;

  constructor(
    onExecutePrompt: (prompt: string, signal: AbortSignal) => Promise<void>,
    onError?: (jobId: string, error: Error) => void | Promise<void>
  ) {
    this.onExecutePrompt = onExecutePrompt;
    this.onError = onError;
  }

  private generateJobId(): string {
    return `loop-${++this.jobIdCounter}-${Date.now().toString(36)}`;
  }

  getStats(): SchedulerStats {
    let totalExecutions = 0;
    let totalErrors = 0;
    let executingJobs = 0;

    for (const job of this.jobs.values()) {
      totalExecutions += job.runCount;
      totalErrors += job.errorCount;
      if (job.isExecuting) executingJobs++;
    }

    return {
      totalJobs: this.jobs.size,
      activeJobs: this.jobs.size,
      executingJobs,
      totalExecutions,
      totalErrors,
    };
  }

  schedule(intervalInput: string, prompt: string): LoopJob {
    if (this.jobs.size >= MAX_CONCURRENT_JOBS) {
      throw new LoopError(
        `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
        'MAX_JOBS_EXCEEDED'
      );
    }

    const { milliseconds } = parseInterval(intervalInput);
    const jobId = this.generateJobId();
    const abortController = new AbortController();
    const now = new Date();

    const job: LoopJobInternal = {
      id: jobId,
      intervalMs: milliseconds,
      prompt: prompt.trim(),
      createdAt: now,
      lastRunAt: null,
      runCount: 0,
      errorCount: 0,
      nextRunAt: new Date(now.getTime() + milliseconds),
      timerId: null,
      isExecuting: false,
      abortController,
    };

    this.jobs.set(jobId, job);

    job.timerId = setInterval(() => {
      this.executeJob(jobId).catch(err => {
        console.error(`[session-loop] Interval execution of ${jobId} failed:`, err);
      });
    }, milliseconds);

    // Fire immediately (first run), fire-and-forget
    this.executeJob(jobId).catch(err => {
      console.error(`[session-loop] First execution of ${jobId} failed:`, err);
    });

    return this.toPublicJob(job);
  }

  stop(jobId: string): LoopJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new LoopError(`Job ${jobId} not found`, 'JOB_NOT_FOUND');
    }

    job.abortController.abort();
    if (job.timerId !== null) clearInterval(job.timerId);
    this.jobs.delete(jobId);

    return this.toPublicJob(job);
  }

  stopAll(): LoopJob[] {
    const stoppedJobs: LoopJob[] = [];

    for (const [, job] of this.jobs) {
      job.abortController.abort();
      if (job.timerId !== null) clearInterval(job.timerId);
      stoppedJobs.push(this.toPublicJob(job));
    }

    this.jobs.clear();
    console.log(`[session-loop] stopAll: Aborted ${stoppedJobs.length} jobs, timers cleared`);

    return stoppedJobs;
  }

  list(): LoopJob[] {
    return Array.from(this.jobs.values()).map(job => this.toPublicJob(job));
  }

  get(jobId: string): LoopJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? this.toPublicJob(job) : undefined;
  }

  private async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Guard: skip if already executing (prevents overlapping runs from setInterval)
    // Safe in single-threaded JS — no race between check and set within the same microtask
    if (job.isExecuting) {
      console.log(`[session-loop] Skipping job ${jobId}: still executing`);
      return;
    }

    if (job.abortController.signal.aborted) {
      return;
    }

    job.isExecuting = true;
    const startTime = Date.now();

    // Timeout: 2x interval or 60s minimum, whichever is larger
    const timeoutMs = Math.max(job.intervalMs * 2, 60_000);

    try {
      await Promise.race([
        this.onExecutePrompt(job.prompt, job.abortController.signal),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new LoopError(`Job ${jobId} timed out after ${timeoutMs}ms`, 'JOB_TIMEOUT')),
            timeoutMs
          )
        ),
      ]);

      job.runCount++;
      job.lastRunAt = new Date();
      job.nextRunAt = new Date(Date.now() + job.intervalMs);

      console.log(`[session-loop] Job ${jobId} executed successfully (${Date.now() - startTime}ms)`);
    } catch (error) {
      job.errorCount++;
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[session-loop] Job ${jobId} failed:`, err.message);

      if (this.onError) {
        try {
          await Promise.resolve(this.onError(jobId, err));
        } catch (cbError) {
          console.error('[session-loop] Error in error callback:', cbError);
        }
      }
    } finally {
      job.isExecuting = false;
    }
  }

  private toPublicJob(job: LoopJobInternal): LoopJob {
    return {
      id: job.id,
      intervalMs: job.intervalMs,
      prompt: job.prompt,
      createdAt: job.createdAt,
      lastRunAt: job.lastRunAt,
      runCount: job.runCount,
      errorCount: job.errorCount,
      nextRunAt: job.nextRunAt,
    };
  }
}
