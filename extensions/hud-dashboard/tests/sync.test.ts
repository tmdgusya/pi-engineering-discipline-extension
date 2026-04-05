import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { optimisticManager, reconciler, heartbeatMonitor, stateMutex } from "../src/sync.js";
import { hudStore, hudActions } from "../src/state.js";

describe("sync.ts", () => {
  beforeEach(() => {
    hudActions.reset();
  });

  describe("OptimisticUpdateManager", () => {
    it("getPendingCount starts at 0", () => {
      expect(optimisticManager.getPendingCount()).toBe(0);
    });

    it("commit removes from pending", () => {
      optimisticManager.startOptimistic("u1", "test", (s) => ({ ...s, currentGoal: "x" }));
      expect(optimisticManager.isPending("u1")).toBe(true);
      optimisticManager.commit("u1");
      expect(optimisticManager.isPending("u1")).toBe(false);
    });

    it("rollback restores previous state", () => {
      hudActions.setCurrentGoal("original");
      optimisticManager.startOptimistic("u2", "test", (s) => ({ ...s, currentGoal: "optimistic" }));
      expect(hudStore.getState().currentGoal).toBe("optimistic");
      optimisticManager.rollback("u2");
      expect(hudStore.getState().currentGoal).toBe("original");
    });
  });

  describe("DebouncedReconciler", () => {
    afterEach(() => { reconciler.cancel(); });

    it("flush runs the function immediately", () => {
      let ran = false;
      reconciler.schedule(() => { ran = true; });
      reconciler.flush();
      expect(ran).toBe(true);
    });

    it("cancel prevents execution", async () => {
      let ran = false;
      reconciler.schedule(() => { ran = true; });
      reconciler.cancel();
      await new Promise(r => setTimeout(r, 200));
      expect(ran).toBe(false);
    });
  });

  describe("HeartbeatMonitor", () => {
    it("isHealthy returns true initially", () => {
      expect(heartbeatMonitor.isHealthy()).toBe(true);
    });

    it("beat resets missed beats", () => {
      heartbeatMonitor.beat();
      expect(heartbeatMonitor.isHealthy()).toBe(true);
    });
  });

  describe("AtomicMutex", () => {
    it("lock and unlock work", async () => {
      await stateMutex.lock();
      expect(stateMutex.isLocked()).toBe(true);
      stateMutex.unlock();
      expect(stateMutex.isLocked()).toBe(false);
    });
  });
});
