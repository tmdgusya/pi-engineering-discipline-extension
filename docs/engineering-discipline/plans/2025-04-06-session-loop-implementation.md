# Session Loop Extension Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Implement a session-scoped loop/cron extension for pi that allows N concurrent recurring jobs with proper cleanup, error isolation, and timeout protection.

**Architecture:**
- `JobScheduler` class managing N concurrent intervals via `Map<string, LoopJobInternal>`
- Per-job error isolation with try/catch + `Promise.race` timeout
- `AbortController` per job for cooperative cancellation
- `session_shutdown` event triggers `stopAll()` with 500ms grace period
- Commands: `/loop`, `/loop-stop`, `/loop-list`, `/loop-stop-all`

**Tech Stack:** TypeScript (ES2022, strict), pi ExtensionAPI, vitest

**Work Scope:**
- **In scope:**
  - `/loop <interval> <prompt>` — schedule recurring prompts (5s, 10m, 2h, 1d formats)
  - `/loop-stop [id]` — cancel a job (interactive select if no ID)
  - `/loop-list` — list active jobs with stats
  - `/loop-stop-all` — cancel all jobs with confirmation
  - JobScheduler with max 100 concurrent jobs, 1s min / 1yr max interval
  - Per-job timeout (`max(interval×2, 60s)`)
  - Session lifecycle cleanup on `session_shutdown`
  - Unit tests with vitest
  - Extension registration in root `package.json`
- **Out of scope:**
  - Persistence across sessions (intentionally session-scoped)
  - External cron integration (systemd, AWS Lambda, etc.)
  - Distributed job coordination
  - Job history/audit logging

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/session-loop && npx vitest run`
- **What it validates:** Scheduler logic (schedule, stop, stopAll, timeout, error isolation), interval parsing, type correctness

---

## File Structure Mapping

| File | Responsibility |
|------|----------------|
| `extensions/session-loop/package.json` | Package config, deps, scripts |
| `extensions/session-loop/tsconfig.json` | TypeScript compiler options |
| `extensions/session-loop/types.ts` | Interfaces: `LoopJob`, `LoopJobInternal`, `SchedulerStats`, `LoopError` |
| `extensions/session-loop/scheduler.ts` | `JobScheduler` class + `parseInterval()` utility |
| `extensions/session-loop/commands.ts` | Command registration: `/loop`, `/loop-stop`, `/loop-list`, `/loop-stop-all` |
| `extensions/session-loop/index.ts` | Extension entry point, lifecycle hooks |
| `extensions/session-loop/tests/scheduler.test.ts` | Unit tests for scheduler + parseInterval |
| `extensions/session-loop/README.md` | Usage documentation |

**Modified files:**
| File | Change |
|------|--------|
| `package.json` (root) | Add `extensions/session-loop/index.ts` to `pi.extensions` array |

---

## Task 1: Project Setup and Type Definitions

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/session-loop/package.json`
- Create: `extensions/session-loop/tsconfig.json`
- Create: `extensions/session-loop/types.ts`

- [ ] **Step 1: Create package.json**

```json
// extensions/session-loop/package.json
{
  "name": "pi-session-loop",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.9.3",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// extensions/session-loop/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
// extensions/session-loop/types.ts

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

export interface LoopJobInternal extends LoopJob {
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
      | 'JOB_EXECUTION_FAILED'
      | 'MAX_JOBS_EXCEEDED'
      | 'JOB_TIMEOUT'
  ) {
    super(message);
    this.name = 'LoopError';
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd extensions/session-loop
npm install
```

- [ ] **Step 5: Commit**

```bash
git add extensions/session-loop/package.json extensions/session-loop/tsconfig.json extensions/session-loop/types.ts
git commit -m "feat(session-loop): project setup and type definitions"
```

---

## Task 2: JobScheduler Implementation

**Dependencies:** Task 1 (imports types)
**Files:**
- Create: `extensions/session-loop/scheduler.ts`

- [ ] **Step 1: Create scheduler.ts with parseInterval and JobScheduler class**

Write the complete file `extensions/session-loop/scheduler.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add extensions/session-loop/scheduler.ts
git commit -m "feat(session-loop): implement JobScheduler with timeout and error isolation"
```

---

## Task 3: Unit Tests for Scheduler

**Dependencies:** Task 2 (imports scheduler)
**Files:**
- Create: `extensions/session-loop/tests/scheduler.test.ts`

- [ ] **Step 1: Create scheduler.test.ts**

Write the complete file `extensions/session-loop/tests/scheduler.test.ts`:

```typescript
// extensions/session-loop/tests/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseInterval, JobScheduler } from '../scheduler.js';
import { LoopError } from '../types.js';

// ─── parseInterval ───────────────────────────────────────────

describe('parseInterval', () => {
  it('parses seconds', () => {
    const result = parseInterval('5s');
    expect(result).toEqual({ value: 5, unit: 's', milliseconds: 5000 });
  });

  it('parses minutes', () => {
    const result = parseInterval('10m');
    expect(result).toEqual({ value: 10, unit: 'm', milliseconds: 600000 });
  });

  it('parses hours', () => {
    const result = parseInterval('2h');
    expect(result).toEqual({ value: 2, unit: 'h', milliseconds: 7200000 });
  });

  it('parses days', () => {
    const result = parseInterval('1d');
    expect(result).toEqual({ value: 1, unit: 'd', milliseconds: 86400000 });
  });

  it('is case-insensitive', () => {
    const result = parseInterval('5S');
    expect(result.milliseconds).toBe(5000);
  });

  it('trims whitespace', () => {
    const result = parseInterval('  5s  ');
    expect(result.milliseconds).toBe(5000);
  });

  it('allows whitespace between value and unit', () => {
    const result = parseInterval('5 s');
    expect(result.milliseconds).toBe(5000);
  });

  it('throws on invalid format', () => {
    expect(() => parseInterval('abc')).toThrow(LoopError);
    expect(() => parseInterval('abc')).toThrow('Invalid interval format');
  });

  it('throws on empty string', () => {
    expect(() => parseInterval('')).toThrow(LoopError);
  });

  it('throws on zero value', () => {
    expect(() => parseInterval('0s')).toThrow('greater than 0');
  });

  it('throws on decimal values', () => {
    expect(() => parseInterval('1.5m')).toThrow(LoopError);
  });

  it('throws on interval exceeding max (1 year)', () => {
    expect(() => parseInterval('366d')).toThrow('too large');
  });

  it('has correct error code', () => {
    try {
      parseInterval('bad');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LoopError);
      expect((e as LoopError).code).toBe('INVALID_INTERVAL');
    }
  });
});

// ─── JobScheduler ────────────────────────────────────────────

describe('JobScheduler', () => {
  let scheduler: JobScheduler;
  let executeFn: ReturnType<typeof vi.fn>;
  let errorFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    executeFn = vi.fn().mockResolvedValue(undefined);
    errorFn = vi.fn();
    scheduler = new JobScheduler(executeFn, errorFn);
  });

  afterEach(() => {
    // Clean up all jobs to clear intervals
    scheduler.stopAll();
    vi.useRealTimers();
  });

  describe('schedule', () => {
    it('creates a job and returns public LoopJob', () => {
      const job = scheduler.schedule('5s', 'test prompt');
      expect(job.id).toMatch(/^loop-/);
      expect(job.intervalMs).toBe(5000);
      expect(job.prompt).toBe('test prompt');
      expect(job.runCount).toBe(0);
      expect(job.errorCount).toBe(0);
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.lastRunAt).toBeNull();
    });

    it('trims prompt whitespace', () => {
      const job = scheduler.schedule('5s', '  hello world  ');
      expect(job.prompt).toBe('hello world');
    });

    it('fires immediately on schedule', async () => {
      scheduler.schedule('5s', 'test');
      // Allow microtask queue to flush
      await vi.advanceTimersByTimeAsync(0);
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledWith('test', expect.any(AbortSignal));
    });

    it('fires again at interval', async () => {
      scheduler.schedule('5s', 'test');
      await vi.advanceTimersByTimeAsync(0); // immediate
      expect(executeFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000); // 5s later
      expect(executeFn).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5000); // 10s later
      expect(executeFn).toHaveBeenCalledTimes(3);
    });

    it('throws MAX_JOBS_EXCEEDED when at limit', () => {
      // Schedule 100 jobs
      for (let i = 0; i < 100; i++) {
        scheduler.schedule('1h', `job ${i}`);
      }

      expect(() => scheduler.schedule('1h', 'one more')).toThrow(LoopError);
      try {
        scheduler.schedule('1h', 'one more');
      } catch (e) {
        expect((e as LoopError).code).toBe('MAX_JOBS_EXCEEDED');
      }
    });
  });

  describe('stop', () => {
    it('removes a job by ID', () => {
      const job = scheduler.schedule('5s', 'test');
      const stopped = scheduler.stop(job.id);
      expect(stopped.id).toBe(job.id);
      expect(scheduler.list()).toHaveLength(0);
    });

    it('throws JOB_NOT_FOUND for unknown ID', () => {
      expect(() => scheduler.stop('nonexistent')).toThrow(LoopError);
      try {
        scheduler.stop('nonexistent');
      } catch (e) {
        expect((e as LoopError).code).toBe('JOB_NOT_FOUND');
      }
    });

    it('stops interval from firing after stop', async () => {
      const job = scheduler.schedule('5s', 'test');
      await vi.advanceTimersByTimeAsync(0); // immediate
      expect(executeFn).toHaveBeenCalledTimes(1);

      scheduler.stop(job.id);

      await vi.advanceTimersByTimeAsync(10000);
      expect(executeFn).toHaveBeenCalledTimes(1); // no more
    });
  });

  describe('stopAll', () => {
    it('removes all jobs', () => {
      scheduler.schedule('5s', 'job 1');
      scheduler.schedule('10s', 'job 2');
      scheduler.schedule('15s', 'job 3');

      const stopped = scheduler.stopAll();
      expect(stopped).toHaveLength(3);
      expect(scheduler.list()).toHaveLength(0);
    });

    it('returns empty array when no jobs', () => {
      const stopped = scheduler.stopAll();
      expect(stopped).toEqual([]);
    });
  });

  describe('list', () => {
    it('lists all active jobs', () => {
      scheduler.schedule('5s', 'first');
      scheduler.schedule('10s', 'second');
      const jobs = scheduler.list();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].prompt).toBe('first');
      expect(jobs[1].prompt).toBe('second');
    });

    it('returns empty array when no jobs', () => {
      expect(scheduler.list()).toEqual([]);
    });
  });

  describe('get', () => {
    it('returns a job by ID', () => {
      const job = scheduler.schedule('5s', 'test');
      const found = scheduler.get(job.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(job.id);
    });

    it('returns undefined for unknown ID', () => {
      expect(scheduler.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('returns correct stats', async () => {
      scheduler.schedule('5s', 'job 1');
      scheduler.schedule('10s', 'job 2');
      await vi.advanceTimersByTimeAsync(0); // immediate runs

      const stats = scheduler.getStats();
      expect(stats.totalJobs).toBe(2);
      expect(stats.activeJobs).toBe(2);
      expect(stats.totalExecutions).toBe(2); // each ran once
      expect(stats.totalErrors).toBe(0);
    });
  });

  describe('error isolation', () => {
    it('increments errorCount on failure', async () => {
      executeFn.mockRejectedValueOnce(new Error('boom'));
      const job = scheduler.schedule('5s', 'failing');
      await vi.advanceTimersByTimeAsync(0);

      const updated = scheduler.get(job.id);
      expect(updated!.errorCount).toBe(1);
      expect(updated!.runCount).toBe(0);
    });

    it('calls onError callback on failure', async () => {
      executeFn.mockRejectedValueOnce(new Error('boom'));
      scheduler.schedule('5s', 'failing');
      await vi.advanceTimersByTimeAsync(0);

      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(errorFn).toHaveBeenCalledWith(expect.stringMatching(/^loop-/), expect.any(Error));
    });

    it('continues scheduling after error', async () => {
      executeFn.mockRejectedValueOnce(new Error('boom'));
      const job = scheduler.schedule('5s', 'resilient');
      await vi.advanceTimersByTimeAsync(0); // immediate: fails

      executeFn.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(5000); // 5s: succeeds

      const updated = scheduler.get(job.id);
      expect(updated!.errorCount).toBe(1);
      expect(updated!.runCount).toBe(1);
    });

    it('one failing job does not affect another', async () => {
      executeFn
        .mockRejectedValueOnce(new Error('boom'))  // job1 immediate
        .mockResolvedValueOnce(undefined);           // job2 immediate

      scheduler.schedule('5s', 'failing');
      scheduler.schedule('5s', 'working');
      await vi.advanceTimersByTimeAsync(0);

      const stats = scheduler.getStats();
      expect(stats.totalErrors).toBe(1);
      expect(stats.totalExecutions).toBe(1);
    });
  });

  describe('timeout', () => {
    it('times out a job that takes too long', async () => {
      // Create a promise that never resolves
      executeFn.mockImplementation(() => new Promise(() => {}));

      const job = scheduler.schedule('5s', 'hanging');
      // Timeout = max(5000 * 2, 60000) = 60000ms
      await vi.advanceTimersByTimeAsync(60_000);

      const updated = scheduler.get(job.id);
      expect(updated!.errorCount).toBe(1);
      expect(errorFn).toHaveBeenCalledWith(
        expect.stringMatching(/^loop-/),
        expect.objectContaining({ code: 'JOB_TIMEOUT' })
      );
    });
  });

  describe('abort', () => {
    it('passes AbortSignal to execute function', async () => {
      scheduler.schedule('5s', 'test');
      await vi.advanceTimersByTimeAsync(0);

      const signal = executeFn.mock.calls[0][1];
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('aborts signal on stop', async () => {
      let capturedSignal: AbortSignal | null = null;
      executeFn.mockImplementation(async (_prompt: string, signal: AbortSignal) => {
        capturedSignal = signal;
      });

      const job = scheduler.schedule('5s', 'test');
      await vi.advanceTimersByTimeAsync(0);
      scheduler.stop(job.id);

      expect(capturedSignal!.aborted).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd extensions/session-loop
npx vitest run
```

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add extensions/session-loop/tests/scheduler.test.ts
git commit -m "test(session-loop): unit tests for parseInterval and JobScheduler"
```

---

## Task 4: Command Implementations

**Dependencies:** Task 2 (imports scheduler, parseInterval)
**Files:**
- Create: `extensions/session-loop/commands.ts`

- [ ] **Step 1: Create commands.ts**

Write the complete file `extensions/session-loop/commands.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add extensions/session-loop/commands.ts
git commit -m "feat(session-loop): implement /loop, /loop-stop, /loop-list, /loop-stop-all commands"
```

---

## Task 5: Extension Entry Point and Registration

**Dependencies:** Task 2, Task 4 (imports scheduler, commands)
**Files:**
- Create: `extensions/session-loop/index.ts`
- Modify: `package.json` (root) — add extension to `pi.extensions` array

- [ ] **Step 1: Create index.ts**

Write the complete file `extensions/session-loop/index.ts`:

```typescript
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
```

- [ ] **Step 2: Register extension in root package.json**

Add `"extensions/session-loop/index.ts"` to the `pi.extensions` array in the root `package.json`. The array should become:

```json
"pi": {
  "extensions": [
    "extensions/agentic-harness/index.ts",
    "extensions/hud-dashboard/src/index.ts",
    "extensions/session-loop/index.ts"
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add extensions/session-loop/index.ts package.json
git commit -m "feat(session-loop): extension entry point and root registration"
```

---

## Task 6: Documentation

**Dependencies:** Task 5
**Files:**
- Create: `extensions/session-loop/README.md`

- [ ] **Step 1: Create README.md**

Write the complete file `extensions/session-loop/README.md`:

```markdown
# Session Loop Extension

Session-scoped recurring jobs for pi coding agent.

## Commands

| Command | Description |
|---------|-------------|
| `/loop <interval> <prompt>` | Schedule a recurring prompt |
| `/loop-stop [job-id]` | Stop a job (interactive select if no ID) |
| `/loop-list` | List all active jobs with stats |
| `/loop-stop-all` | Stop all jobs (with confirmation) |

## Interval Format

| Format | Example | Duration |
|--------|---------|----------|
| `Ns` | `5s` | 5 seconds |
| `Nm` | `10m` | 10 minutes |
| `Nh` | `2h` | 2 hours |
| `Nd` | `1d` | 1 day |

Minimum: 1 second. Maximum: 365 days.

## Examples

```bash
# Check git status every 5 minutes
/loop 5m check git status and report changes

# Run a health check every 30 seconds
/loop 30s verify the dev server is running on port 3000

# List active jobs
/loop-list

# Stop a specific job
/loop-stop loop-1-abc123

# Stop all jobs
/loop-stop-all
```

## Architecture

- **Session-scoped**: All jobs are cleaned up on session end. No persistence.
- **Concurrent**: Up to 100 simultaneous jobs.
- **Error-isolated**: One failing job does not affect others.
- **Timeout-protected**: Jobs timeout at `max(interval × 2, 60s)`.
- **Cooperative cancellation**: Uses `AbortController` per job.

## Development

```bash
cd extensions/session-loop
npm install
npm test        # Run unit tests
npm run build   # Type-check only (no emit)
```
```

- [ ] **Step 2: Commit**

```bash
git add extensions/session-loop/README.md
git commit -m "docs(session-loop): add README with usage and architecture"
```

---

## Task 7 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run test suite**

```bash
cd extensions/session-loop
npx vitest run
```

Expected: ALL PASS

- [ ] **Step 2: Run type check**

```bash
cd extensions/session-loop
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Verify plan success criteria**

Manually check each success criterion:
- [ ] `parseInterval` correctly parses `5s`, `10m`, `2h`, `1d` and rejects invalid formats
- [ ] `JobScheduler.schedule()` creates jobs with immediate first execution
- [ ] `JobScheduler.stop()` clears interval, aborts signal, removes job
- [ ] `JobScheduler.stopAll()` cleans up all jobs
- [ ] `JobScheduler.list()` returns public job data without internal fields
- [ ] Error isolation: one job failing does not crash others
- [ ] Timeout: hung jobs are terminated after `max(interval×2, 60s)`
- [ ] `session_shutdown` triggers `stopAll()` with 500ms grace period
- [ ] Commands use correct API: `ctx.ui.notify(msg, "info"|"warning"|"error")`, `ctx.ui.select(title, string[])`, `ctx.ui.confirm(title, msg)`
- [ ] Extension entry uses `pi.sendUserMessage()` (not `pi.session.prompt()`)
- [ ] Extension registered in root `package.json` `pi.extensions` array
- [ ] Max 100 concurrent jobs enforced
- [ ] `timerId` is nullable (`| null`), null-checked before `clearInterval`
- [ ] `onError` callback supports async (return type `void | Promise<void>`)

- [ ] **Step 4: Verify file structure**

```bash
find extensions/session-loop -type f | sort
```

Expected output:
```
extensions/session-loop/README.md
extensions/session-loop/commands.ts
extensions/session-loop/index.ts
extensions/session-loop/package.json
extensions/session-loop/scheduler.ts
extensions/session-loop/tests/scheduler.test.ts
extensions/session-loop/tsconfig.json
extensions/session-loop/types.ts
```

---

## Self-Review

**1. Spec coverage:**
- ✅ N concurrent jobs — `JobScheduler` uses `Map`, max 100
- ✅ Event loop safety — `async/await` + `Promise.race` timeout
- ✅ Session lifecycle — `session_shutdown` → `stopAll()` + 500ms grace
- ✅ Error isolation — per-job try/catch, error counting
- ✅ Commands — `/loop`, `/loop-stop`, `/loop-list`, `/loop-stop-all`
- ✅ Unit tests — vitest tests for scheduler + parseInterval (missing from original spec)
- ✅ Package setup — `package.json`, `tsconfig.json` (missing from original spec)
- ✅ Extension registration in root `package.json` (missing from original spec)

**2. Placeholder scan:**
- ✅ No TBD/TODO in plan
- ✅ All code is complete in task steps
- ✅ No "implement later" references

**3. Type consistency:**
- ✅ `LoopJob` / `LoopJobInternal` used consistently
- ✅ `LoopError` codes match between types.ts and scheduler.ts
- ✅ `parseInterval` signature consistent between scheduler.ts and commands.ts
- ✅ `ctx.ui.notify` uses only valid types: `"info" | "warning" | "error"` (NOT `"success"`)
- ✅ `ctx.ui.select` uses `string[]` (NOT `{label, value}[]`)
- ✅ `pi.sendUserMessage()` used (NOT `pi.session.prompt()`)
- ✅ `getArgumentCompletions` returns `AutocompleteItem[]` with `{value, label, description}`

**4. Dependency verification:**
- ✅ Task 1 (types + setup): no dependencies — parallelizable
- ✅ Task 2 (scheduler): depends on Task 1 (imports types)
- ✅ Task 3 (tests): depends on Task 2 (imports scheduler)
- ✅ Task 4 (commands): depends on Task 2 (imports scheduler, parseInterval)
- ✅ Task 5 (entry + registration): depends on Task 2, Task 4 (imports scheduler, commands; modifies root package.json)
- ✅ Task 6 (docs): depends on Task 5
- ✅ Task 7 (final): depends on all
- ✅ No file conflicts: Tasks 3 and 4 can run in parallel (different files, both depend on Task 2)

**5. Verification coverage:**
- ✅ Unit tests in Task 3 (vitest)
- ✅ Type check in Task 7 (`tsc --noEmit`)
- ✅ Final verification in Task 7

**Fixes applied vs original spec:**
| # | Issue | Fix |
|---|-------|-----|
| 1 | `pi.session.prompt()` doesn't exist | → `pi.sendUserMessage()` |
| 2 | `ctx.ui.select()` object format | → `string[]` + ID parsing |
| 3 | `ctx.ui.notify()` `'success'` type invalid | → `'info'` |
| 4 | No job execution timeout | → `Promise.race` with timeout |
| 5 | `onError` can't handle async | → `void \| Promise<void>` + `Promise.resolve` wrapping |
| 6 | `timerId: null as unknown as ...` cast | → nullable type `\| null` |
| 7 | `stopAll` no null check on timerId | → `if (job.timerId !== null)` |
| 8 | Grace period 100ms too short | → 500ms |
| 9 | No `package.json` for extension | → Added |
| 10 | No unit tests | → Added vitest test suite |
| 11 | Not registered in root `package.json` | → Added registration |
| 12 | `getArgumentCompletions` missing `value` field | → Added `AutocompleteItem` format |
