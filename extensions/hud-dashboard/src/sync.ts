import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hudStore, hudActions, type HUDState } from "./state.js";
import { hudEventBus } from "./eventBus.js";

interface OptimisticUpdate<T> {
  id: string;
  type: string;
  previousState: HUDState;
  newState: T;
  committed: boolean;
  timestamp: number;
}

class OptimisticUpdateManager {
  private pending = new Map<string, OptimisticUpdate<unknown>>();
  private maxPending = 50;
  private rollbackListeners: Array<(update: OptimisticUpdate<unknown>) => void> = [];

  startOptimistic<T>(id: string, type: string, apply: (state: HUDState) => T): T {
    const currentState = hudStore.getState();
    const newState = apply(currentState);
    hudStore.setState(() => newState as unknown as HUDState);

    const update: OptimisticUpdate<T> = {
      id, type, previousState: currentState, newState, committed: false, timestamp: Date.now(),
    };
    this.pending.set(id, update as OptimisticUpdate<unknown>);

    if (this.pending.size > this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (oldest) this.pending.delete(oldest);
    }

    return newState;
  }

  commit(id: string): void {
    const update = this.pending.get(id);
    if (update) {
      update.committed = true;
      this.pending.delete(id);
    }
  }

  rollback(id: string): boolean {
    const update = this.pending.get(id);
    if (!update) return false;

    hudStore.setState(() => update.previousState);
    this.pending.delete(id);

    for (const listener of this.rollbackListeners) {
      try { listener(update); } catch (e) { console.error("[HUD Optimistic] Rollback listener error:", e); }
    }
    return true;
  }

  rollbackAll(): void {
    for (const [id] of this.pending) {
      this.rollback(id);
    }
  }

  onRollback(listener: (update: OptimisticUpdate<unknown>) => void): () => void {
    this.rollbackListeners.push(listener);
    return () => {
      const idx = this.rollbackListeners.indexOf(listener);
      if (idx !== -1) this.rollbackListeners.splice(idx, 1);
    };
  }

  isPending(id: string): boolean { return this.pending.has(id); }
  getPendingCount(): number { return this.pending.size; }
}

export const optimisticManager = new OptimisticUpdateManager();

class DebouncedReconciler {
  private timeoutMs: number;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconciliationFn: (() => void) | null = null;

  constructor(timeoutMs = 100) {
    this.timeoutMs = timeoutMs;
  }

  schedule(fn: () => void): void {
    this.reconciliationFn = fn;
    if (this.pendingTimeout) clearTimeout(this.pendingTimeout);

    this.pendingTimeout = setTimeout(() => {
      this.pendingTimeout = null;
      if (this.reconciliationFn) {
        try { this.reconciliationFn(); } catch (e) { console.error("[HUD Reconciler] Error:", e); }
      }
    }, this.timeoutMs);
  }

  cancel(): void {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  flush(): void {
    this.cancel();
    if (this.reconciliationFn) this.reconciliationFn();
  }

  setTimeout(ms: number): void { this.timeoutMs = ms; }
}

export const reconciler = new DebouncedReconciler(100);

class HeartbeatMonitor {
  private intervalMs = 30000;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeat = Date.now();
  private missedBeats = 0;
  private maxMissedBeats = 3;
  private listeners: Array<(connected: boolean) => void> = [];

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.check(), this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  beat(): void {
    this.lastHeartbeat = Date.now();
    this.missedBeats = 0;
    this.notifyListeners(true);
  }

  private check(): void {
    const elapsed = Date.now() - this.lastHeartbeat;
    if (elapsed > this.intervalMs * 2) {
      this.missedBeats++;
      if (this.missedBeats >= this.maxMissedBeats) {
        console.warn(`[HUD Heartbeat] Connection lost (${this.missedBeats} missed)`);
        this.notifyListeners(false);
      }
    } else {
      this.missedBeats = 0;
      this.notifyListeners(true);
    }
  }

  onStatusChange(listener: (connected: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notifyListeners(connected: boolean): void {
    for (const listener of this.listeners) {
      try { listener(connected); } catch (e) { console.error("[HUD Heartbeat] Listener error:", e); }
    }
  }

  getTimeSinceLastBeat(): number { return Date.now() - this.lastHeartbeat; }
  isHealthy(): boolean { return this.missedBeats < this.maxMissedBeats; }
}

export const heartbeatMonitor = new HeartbeatMonitor();

// Mutex for atomic state operations
export class AtomicMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.locked) { this.locked = true; return; }
    return new Promise(resolve => { this.waiters.push(resolve); });
  }

  unlock(): void {
    if (this.waiters.length > 0) { this.waiters.shift()!(); }
    else { this.locked = false; }
  }

  isLocked(): boolean { return this.locked; }
}

export const stateMutex = new AtomicMutex();

export async function atomicStateMutation<T>(
  id: string,
  mutate: () => T
): Promise<{ success: boolean; result?: T; error?: string }> {
  await stateMutex.lock();

  try {
    const optimisticId = `atomic:${id}`;
    const result = optimisticManager.startOptimistic(optimisticId, `atomic:${id}`, () => mutate());
    optimisticManager.commit(optimisticId);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  } finally {
    stateMutex.unlock();
  }
}

// State reconciliation

interface ReconciliationState {
  localState: HUDState;
  lastSyncTime: number;
  pendingSyncs: number;
}

const reconciliationState: ReconciliationState = {
  localState: hudStore.getState(),
  lastSyncTime: Date.now(),
  pendingSyncs: 0,
};

export function reconcileState(externalState: Partial<HUDState>): void {
  reconciliationState.pendingSyncs++;

  reconciler.schedule(() => {
    reconciliationState.pendingSyncs--;
    const currentState = hudStore.getState();

    // Local state takes precedence for active fields
    const mergedState: Partial<HUDState> = {
      ...externalState,
      workflowStatus: currentState.workflowStatus,
      activeToolCalls: currentState.activeToolCalls,
      metrics: currentState.metrics,
    };

    hudStore.setState(s => ({ ...s, ...mergedState }));
    reconciliationState.localState = hudStore.getState();
    reconciliationState.lastSyncTime = Date.now();
  });
}

export function forceSync(): void {
  reconciler.flush();
  reconciliationState.lastSyncTime = Date.now();
}

export function getReconciliationStatus(): {
  pendingSyncs: number;
  timeSinceLastSync: number;
  isSynced: boolean;
} {
  return {
    pendingSyncs: reconciliationState.pendingSyncs,
    timeSinceLastSync: Date.now() - reconciliationState.lastSyncTime,
    isSynced: reconciliationState.pendingSyncs === 0,
  };
}

export function initStateSync(pi: ExtensionAPI): void {
  heartbeatMonitor.start();

  hudEventBus.subscribe("heartbeat", () => {
    heartbeatMonitor.beat();
    hudActions.setProviderConnected(true);
  });

  hudEventBus.subscribe("workflow:end", () => { forceSync(); });

  optimisticManager.onRollback((update) => {
    console.log(`[HUD StateSync] Rolled back: ${update.type}`);
  });

  pi.on("session_shutdown", () => {
    heartbeatMonitor.stop();
    optimisticManager.rollbackAll();
    reconciler.cancel();
  });

  setInterval(() => {
    if (!heartbeatMonitor.isHealthy()) hudActions.setProviderConnected(false);
  }, 10000);
}
