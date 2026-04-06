export interface LoopJob {
  id: string;
  intervalMs: number;
  prompt: string;
  createdAt: Date;
  lastRunAt: Date | null;
  runCount: number;
  errorCount: number;
  nextRunAt: Date | null;
}

export interface JobInternal extends LoopJob {
  timerId: ReturnType<typeof setInterval> | null;
  isExecuting: boolean;
  abortController: AbortController;
}

export interface SchedulerStats {
  totalJobs: number;
  activeJobs: number;
  executingJobs: number;
  totalExecutions: number;
  totalErrors: number;
}

export type IntervalUnit = 's' | 'm' | 'h' | 'd';

export interface ParsedInterval {
  value: number;
  unit: IntervalUnit;
  milliseconds: number;
}

export class LoopError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_INTERVAL'
      | 'JOB_NOT_FOUND'
      | 'MAX_JOBS_EXCEEDED'
      | 'JOB_TIMEOUT'
  ) {
    super(message);
    this.name = 'LoopError';
  }
}
