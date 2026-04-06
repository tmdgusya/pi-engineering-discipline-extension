# Session Loop Extension Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Implement a robust session-scoped loop/cron extension for pi coding agent that allows N concurrent recurring jobs with proper cleanup and error handling.

**Architecture:** 
- Job Scheduler: TypeScript class managing N concurrent intervals using Map-based storage
- Event Loop Safety: Proper async/await handling with unhandled rejection guards
- Lifecycle Management: Automatic cleanup on session_shutdown, job execution tracking
- Error Isolation: Per-job error handling preventing one job failure from affecting others

**Tech Stack:** TypeScript, pi ExtensionAPI, Node.js Event Loop

**Work Scope:**
- **In scope:** 
  - `/loop` command for scheduling recurring prompts
  - `/loop-stop` command for cancelling jobs
  - `/loop-list` command for viewing active jobs
  - Job execution with proper error handling
  - Session lifecycle integration (cleanup on shutdown)
  - Concurrent job management (N jobs)
- **Out of scope:**
  - Persistence across sessions (intentionally session-scoped)
  - External cron integration (systemd, AWS Lambda, etc.)
  - Distributed job coordination
  - Job history/audit logging

**Verification Strategy:**
- **Level:** test-suite (build + manual verification)
- **Command:** Manual test protocol (see Task 4)
- **What it validates:** Jobs schedule correctly, execute at intervals, clean up properly on session end, concurrent jobs work independently

---

## File Structure Mapping

| File | Responsibility |
|------|----------------|
| `extensions/session-loop/index.ts` | Main extension entry, API registration |
| `extensions/session-loop/scheduler.ts` | JobScheduler class - core interval management |
| `extensions/session-loop/types.ts` | TypeScript interfaces and types |
| `extensions/session-loop/commands.ts` | /loop, /loop-stop, /loop-list command implementations |

---

## Task 1: Project Setup and Type Definitions

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/session-loop/types.ts`
- Create: `extensions/session-loop/tsconfig.json` (if needed for type checking)

- [ ] **Step 1: Define core types**

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
    public readonly code: 'INVALID_INTERVAL' | 'JOB_NOT_FOUND' | 'JOB_EXECUTION_FAILED' | 'MAX_JOBS_EXCEEDED' | 'JOB_TIMEOUT'
  ) {
    super(message);
    this.name = 'LoopError';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/session-loop/types.ts
git commit -m "feat(session-loop): define core types for loop extension"
```

---

## Task 2: JobScheduler Implementation

**Dependencies:** Task 1 (types dependency)
**Files:**
- Create: `extensions/session-loop/scheduler.ts`

- [ ] **Step 1: Implement interval parsing utility**

```typescript
// extensions/session-loop/scheduler.ts (top of file)
import { LoopJob, LoopJobInternal, ParsedInterval, LoopError, SchedulerStats } from './types.js';

const MIN_INTERVAL_MS = 1000; // 1 second minimum
const MAX_INTERVAL_MS = 86400000 * 365; // 1 year maximum
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
    throw new LoopError(
      `Interval too small. Minimum is ${MIN_INTERVAL_MS}ms`,
      'INVALID_INTERVAL'
    );
  }

  if (milliseconds > MAX_INTERVAL_MS) {
    throw new LoopError(
      `Interval too large. Maximum is ${MAX_INTERVAL_MS}ms`,
      'INVALID_INTERVAL'
    );
  }

  return { value, unit, milliseconds };
}
```

- [ ] **Step 2: Implement JobScheduler class structure**

```typescript
// extensions/session-loop/scheduler.ts (continued)
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

  // Continue with Step 3...
```

- [ ] **Step 3: Implement schedule method**

```typescript
// extensions/session-loop/scheduler.ts (continued in class)
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

    // Setup the interval (set before first execution to ensure cleanup works even if first run hangs)
    job.timerId = setInterval(() => {
      this.executeJob(jobId);
    }, milliseconds);

    // Execute immediately (first run) - FIRE IMMEDIATELY as per requirement
    // Fire-and-forget: don't await, let it run asynchronously
    this.executeJob(jobId).catch(err => {
      console.error(`[session-loop] First execution of ${jobId} failed:`, err);
    });

    return this.toPublicJob(job);
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
```

- [ ] **Step 4: Implement executeJob with error isolation**

```typescript
// extensions/session-loop/scheduler.ts (continued in class)
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
          setTimeout(() => reject(new LoopError(
            `Job ${jobId} timed out after ${timeoutMs}ms`,
            'JOB_TIMEOUT'
          )), timeoutMs)
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
```

- [ ] **Step 5: Implement stop and list methods**

```typescript
// extensions/session-loop/scheduler.ts (continued in class)
  stop(jobId: string): LoopJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new LoopError(`Job ${jobId} not found`, 'JOB_NOT_FOUND');
    }

    // Abort any ongoing execution
    job.abortController.abort();

    // Clear the interval
    if (job.timerId !== null) clearInterval(job.timerId);

    // Remove from map
    this.jobs.delete(jobId);

    return this.toPublicJob(job);
  }

  stopAll(): LoopJob[] {
    const stoppedJobs: LoopJob[] = [];

    // IMMEDIATE ABORT: Signal all jobs to stop immediately (cooperative cancellation)
    // Note: Jobs must check abortController.signal to respond to cancellation
    for (const [jobId, job] of this.jobs) {
      // 1. Signal cancellation - jobs should check signal.aborted and exit early
      job.abortController.abort();
      // 2. Stop the timer to prevent new executions
      clearInterval(job.timerId);
      stoppedJobs.push(this.toPublicJob(job));
    }

    this.jobs.clear();
    
    // Note: Any currently executing jobs will continue until they check the signal
    // or complete. This is the best we can do with cooperative cancellation in JS.
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
} // End of class
```

- [ ] **Step 6: Commit**

```bash
git add extensions/session-loop/scheduler.ts
git commit -m "feat(session-loop): implement JobScheduler with error isolation"
```

---

## Task 3: Command Implementations

**Dependencies:** Task 1, Task 2
**Files:**
- Create: `extensions/session-loop/commands.ts`

- [ ] **Step 1: Implement command handlers**

```typescript
// extensions/session-loop/commands.ts
import { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { JobScheduler, parseInterval } from './scheduler.js';
import { LoopError } from './types.js';

export function registerLoopCommands(pi: ExtensionAPI, scheduler: JobScheduler) {
  // /loop command - schedule a recurring prompt
  pi.registerCommand('loop', {
    description: 'Schedule a prompt to run on a recurring interval (e.g., /loop 5m check status)',
    getArgumentCompletions: (prefix) => {
      const intervals = ['5s', '10s', '30s', '1m', '5m', '10m', '30m', '1h'];
      return intervals
        .filter(i => i.startsWith(prefix))
        .map(i => ({ label: i, description: `Run every ${i}` }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      
      if (!trimmed) {
        ctx.ui.notify('Usage: /loop <interval> <prompt>', 'warning');
        return;
      }

      // Parse interval from start of args
      const parts = trimmed.split(/\s+/);
      let intervalStr: string;
      let prompt: string;

      // Try to parse first token as interval
      try {
        parseInterval(parts[0]);
        intervalStr = parts[0];
        prompt = parts.slice(1).join(' ');
      } catch {
        // Default to 1 minute if no valid interval found
        intervalStr = '1m';
        prompt = trimmed;
      }

      if (!prompt) {
        ctx.ui.notify('Error: Prompt is required. Usage: /loop <interval> <prompt>', 'error');
        return;
      }

      try {
        const job = scheduler.schedule(intervalStr, prompt);
        ctx.ui.notify(
          `✓ Scheduled job ${job.id}: "${prompt}" every ${intervalStr}`,
          'success'
        );
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

  // /loop-stop command - stop a specific job
  pi.registerCommand('loop-stop', {
    description: 'Stop a specific loop job by ID',
    handler: async (args, ctx) => {
      const jobId = args.trim();
      
      if (!jobId) {
        // List jobs and ask user to select
        const jobs = scheduler.list();
        if (jobs.length === 0) {
          ctx.ui.notify('No active jobs to stop', 'warning');
          return;
        }

        // ctx.ui.select() accepts string[] — format: "jobId | interval | prompt"
        const options = jobs.map(j => `${j.id} | every ${j.intervalMs}ms | ${j.prompt.substring(0, 40)}`);
        const selected = await ctx.ui.select('Select a job to stop:', options);

        if (!selected) return;

        // Extract job ID from the formatted string (first segment before " | ")
        const selectedJobId = selected.split(' | ')[0];

        try {
          const stopped = scheduler.stop(selectedJobId);
          ctx.ui.notify(`✓ Stopped job ${stopped.id}`, 'success');
        } catch (error) {
          ctx.ui.notify(`Error: ${error instanceof Error ? error.message : error}`, 'error');
        }
        return;
      }

      try {
        const stopped = scheduler.stop(jobId);
        ctx.ui.notify(`✓ Stopped job ${stopped.id}`, 'success');
      } catch (error) {
        if (error instanceof LoopError && error.code === 'JOB_NOT_FOUND') {
          ctx.ui.notify(`Error: Job ${jobId} not found`, 'error');
        } else {
          ctx.ui.notify(`Error: ${error instanceof Error ? error.message : error}`, 'error');
        }
      }
    },
  });

  // /loop-list command - list all active jobs
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
      console.log('=' .repeat(60));
      
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
      console.log('=' .repeat(60) + '\n');

      ctx.ui.notify(`Found ${jobs.length} active job(s)`, 'info');
    },
  });

  // /loop-stop-all command - stop all jobs
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
      ctx.ui.notify(`✓ Stopped ${stopped.length} job(s)`, 'success');
      console.log(`[session-loop] Stopped all jobs: ${stopped.map(j => j.id).join(', ')}`);
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/session-loop/commands.ts
git commit -m "feat(session-loop): implement /loop, /loop-stop, /loop-list commands"
```

---

## Task 4: Main Extension Entry

**Dependencies:** Task 1, Task 2, Task 3
**Files:**
- Create: `extensions/session-loop/index.ts`

- [ ] **Step 1: Implement main extension entry point**

```typescript
// extensions/session-loop/index.ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { JobScheduler } from './scheduler.js';
import { registerLoopCommands } from './commands.js';

export default function sessionLoopExtension(pi: ExtensionAPI) {
  console.log('[session-loop] Extension loading...');

  // Create scheduler instance
  const scheduler = new JobScheduler(
    // Execute prompt callback
    async (prompt, signal) => {
      // Send the prompt to the session (fire-and-forget)
      // pi.sendUserMessage() is the correct API — pi.session.prompt() does NOT exist
      pi.sendUserMessage(prompt);
    },
    // Error callback (supports async)
    async (jobId, error) => {
      console.error(`[session-loop] Job ${jobId} error:`, error.message);
    }
  );

  // Register commands
  registerLoopCommands(pi, scheduler);

  // Handle session shutdown - CRITICAL for cleanup
  // REQUIREMENT: Immediate abort on session shutdown
  pi.on('session_shutdown', async () => {
    console.log('[session-loop] Session shutting down, IMMEDIATELY aborting all jobs...');
    const stopped = scheduler.stopAll();
    if (stopped.length > 0) {
      console.log(`[session-loop] Aborted and cleaned up ${stopped.length} job(s): ${stopped.map(j => j.id).join(', ')}`);
    }
    
    // Grace period for executing jobs to notice the abort signal
    // 500ms is realistic for async operations to check signal.aborted
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('[session-loop] Cleanup complete');
  });

  // Optional: Display active jobs count in status
  pi.on('turn_end', async () => {
    const stats = scheduler.getStats();
    if (stats.totalJobs > 0) {
      // Could set status line here if API supports
      console.log(`[session-loop] ${stats.totalJobs} job(s) active, ${stats.executingJobs} executing`);
    }
  });

  console.log('[session-loop] Extension loaded. Commands: /loop, /loop-stop, /loop-list, /loop-stop-all');
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/session-loop/index.ts
git commit -m "feat(session-loop): main extension entry with lifecycle management"
```

---

## Task 5: Manual Testing Protocol

**Dependencies:** All preceding tasks
**Files:** None (verification task)

- [ ] **Step 1: Build and install extension**

```bash
# Build (if TypeScript compilation needed)
cd extensions/session-loop
# If tsconfig exists: npx tsc

# Or copy directly to pi extensions directory
cp -r extensions/session-loop ~/.pi/agent/extensions/

# Reload pi
pi /reload
```

- [ ] **Step 2: Test basic scheduling**

Run in pi:
```
/loop 5s echo hello
```

Expected:
- Success notification appears
- Job ID displayed
- "hello" appears every 5 seconds in output

- [ ] **Step 3: Test multiple concurrent jobs**

Run in pi:
```
/loop 3s job A running
/loop 4s job B running
/loop 5s job C running
/loop-list
```

Expected:
- All 3 jobs created successfully
- /loop-list shows 3 jobs with different intervals
- All three prompts execute at their respective intervals

- [ ] **Step 4: Test job stop**

Run in pi:
```
/loop-stop <job-id-from-list>
/loop-list
```

Expected:
- Stopped job no longer appears in list
- That job's prompt no longer executes

- [ ] **Step 5: Test stop all**

Run in pi:
```
/loop 2s test job
/loop-stop-all
/loop-list
```

Expected:
- Confirmation dialog appears
- After confirmation, all jobs stopped
- /loop-list shows no jobs

- [ ] **Step 6: Test session shutdown cleanup**

Run in pi:
```
/loop 2s this should not persist
/quit
# Restart pi
/loop-list
```

Expected:
- After restart, /loop-list shows no jobs
- (Jobs are intentionally session-scoped)

- [ ] **Step 7: Test error handling**

Run in pi:
```
/loop 1s invalidcommandthatdoesnotexist
# Wait a few intervals
/loop-list
```

Expected:
- Job continues running despite errors
- Error count increments in /loop-list
- Other jobs (if any) unaffected

- [ ] **Step 8: Test rapid job creation (stress test)**

Run a script in pi or create multiple jobs quickly:
```
/loop 10s stress test 1
/loop 10s stress test 2
... (repeat 10+ times quickly)
/loop-list
```

Expected:
- All jobs created without race conditions
- /loop-list shows correct count

---

## Task 6 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Verify spec compliance**

Check each success criterion:
- [ ] N concurrent jobs work correctly (tested with 10+ jobs)
- [ ] Session shutdown cleans up all jobs
- [ ] Error isolation works (one job failing doesn't affect others)
- [ ] TypeScript event loop properly handles async execution
- [ ] Commands work: /loop, /loop-stop, /loop-list, /loop-stop-all

- [ ] **Step 2: Code review checklist**

- [ ] All intervals properly cleaned up on session_shutdown
- [ ] No global state that persists across sessions
- [ ] Error handlers don't throw unhandled exceptions
- [ ] AbortController properly passed to async operations
- [ ] Map iteration is safe (no modification during iteration)
- [ ] Job execution timeout prevents hung jobs (Promise.race)
- [ ] Async error callbacks properly awaited (Promise.resolve wrapping)
- [ ] ctx.ui.select() uses string[] format (not object array)
- [ ] pi.sendUserMessage() used (not pi.session.prompt())

- [ ] **Step 3: Document installation**

```bash
cat > extensions/session-loop/README.md << 'EOF'
# Session Loop Extension

Session-scoped recurring jobs for pi coding agent.

## Installation

```bash
cp -r extensions/session-loop ~/.pi/agent/extensions/
```

## Commands

- `/loop <interval> <prompt>` - Schedule recurring prompt
  - Intervals: `5s`, `10m`, `2h`, `1d` (seconds, minutes, hours, days)
  - Example: `/loop 5m check git status`
- `/loop-stop [job-id]` - Stop a specific job (interactive if no ID)
- `/loop-list` - List all active jobs
- `/loop-stop-all` - Stop all jobs

## Architecture

- Jobs are session-scoped (cleaned up on session end)
- Maximum 100 concurrent jobs
- 1 second minimum interval
- Errors in one job don't affect others
EOF
git add extensions/session-loop/README.md
git commit -m "docs(session-loop): add README with usage instructions"
```

- [ ] **Step 4: Final commit and tag**

```bash
git log --oneline -10
# Verify all commits present
git tag session-loop-v1.0.0
echo "Session Loop Extension v1.0.0 complete!"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ N concurrent jobs - JobScheduler uses Map, supports MAX_CONCURRENT_JOBS (100)
- ✅ Event loop safety - async/await with proper error boundaries
- ✅ Session lifecycle - session_shutdown handler cleans up all jobs
- ✅ Error isolation - try/catch in executeJob, per-job error counting
- ✅ Commands - /loop, /loop-stop, /loop-list, /loop-stop-all implemented

**2. Placeholder scan:**
- ✅ No TBD/TODO in plan
- ✅ All code is complete in task steps
- ✅ No "implement later" references

**3. Type consistency:**
- ✅ LoopJob interface used consistently
- ✅ LoopError has proper error codes
- ✅ SchedulerStats matches JobScheduler.getStats() return type

**4. Dependency verification:**
- ✅ Task 1: No dependencies (parallelizable)
- ✅ Task 2: Depends on Task 1 (types)
- ✅ Task 3: Depends on Task 1, 2
- ✅ Task 4: Depends on Task 1, 2, 3
- ✅ Task 5, 6: Final verification, depends on all prior

**5. Verification coverage:**
- ✅ Manual test protocol in Task 5
- ✅ E2E verification in Task 6
- ✅ Success criteria explicitly listed

**Plan complete and saved to `docs/engineering-discipline/plans/2025-01-10-session-loop-extension.md`.**

**How would you like to proceed?**

1. **Subagent execution (recommended)** — dispatch a fresh subagent per task, review between tasks
2. **Inline execution** — execute tasks in this session using the run-plan skill