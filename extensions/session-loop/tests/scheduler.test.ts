// extensions/session-loop/tests/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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
  let executeFn: Mock;
  let errorFn: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    executeFn = vi.fn().mockResolvedValue(undefined);
    errorFn = vi.fn();
    scheduler = new JobScheduler(executeFn as any, errorFn as any);
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
