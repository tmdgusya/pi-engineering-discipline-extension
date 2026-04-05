import { describe, it, expect, beforeEach } from "vitest";
import { hudStore, hudActions, hudSelectors } from "../src/state.js";

describe("state.ts", () => {
  beforeEach(() => { hudActions.reset(); });

  it("initial state is idle", () => {
    expect(hudStore.getState().workflowStatus).toBe("idle");
  });

  it("setWorkflowStatus updates status", () => {
    hudActions.setWorkflowStatus("thinking");
    expect(hudStore.getState().workflowStatus).toBe("thinking");
  });

  it("setCurrentGoal updates goal", () => {
    hudActions.setCurrentGoal("build feature");
    expect(hudStore.getState().currentGoal).toBe("build feature");
  });

  it("startToolCall adds tool and increments counter", () => {
    hudActions.startToolCall({ id: "t1", name: "bash", status: "running", startedAt: 1 });
    const s = hudStore.getState();
    expect(s.activeToolCalls).toHaveLength(1);
    expect(s.metrics.toolsExecuted).toBe(1);
  });

  it("completeToolCall marks tool as success", () => {
    hudActions.startToolCall({ id: "t1", name: "bash", status: "running", startedAt: 1 });
    hudActions.completeToolCall("t1", "done");
    const tool = hudStore.getState().activeToolCalls[0];
    expect(tool.status).toBe("success");
    expect(tool.result).toBe("done");
  });

  it("failToolCall marks tool as error and increments error count", () => {
    hudActions.startToolCall({ id: "t1", name: "bash", status: "running", startedAt: 1 });
    hudActions.failToolCall("t1", "oops");
    expect(hudStore.getState().activeToolCalls[0].status).toBe("error");
    expect(hudStore.getState().metrics.errorsCount).toBe(1);
  });

  it("incrementTurn bumps turn count", () => {
    hudActions.incrementTurn();
    hudActions.incrementTurn();
    expect(hudStore.getState().metrics.turnsCount).toBe(2);
  });

  it("toggleMinimized flips flag", () => {
    expect(hudStore.getState().isMinimized).toBe(false);
    hudActions.toggleMinimized();
    expect(hudStore.getState().isMinimized).toBe(true);
    hudActions.toggleMinimized();
    expect(hudStore.getState().isMinimized).toBe(false);
  });

  it("memory cap limits tool history to 50", () => {
    for (let i = 0; i < 60; i++) {
      hudActions.startToolCall({ id: `t${i}`, name: "read", status: "running", startedAt: i });
    }
    expect(hudStore.getState().activeToolCalls.length).toBeLessThanOrEqual(50);
  });

  it("subscribe notifies on change", () => {
    let called = false;
    const unsub = hudStore.subscribe(() => { called = true; });
    hudActions.setWorkflowStatus("executing");
    expect(called).toBe(true);
    unsub();
  });

  it("selectors return correct values", () => {
    expect(hudSelectors.isIdle()).toBe(true);
    hudActions.setWorkflowStatus("thinking");
    expect(hudSelectors.isWorking()).toBe(true);
    expect(hudSelectors.isIdle()).toBe(false);
  });

  it("getErrorRate returns 0.0 when no tools executed", () => {
    expect(hudSelectors.getErrorRate()).toBe("0.0");
  });

  it("reset preserves apiVersion", () => {
    hudActions.setApiVersion("1.2.3");
    hudActions.setWorkflowStatus("error");
    hudActions.reset();
    expect(hudStore.getState().workflowStatus).toBe("idle");
    expect(hudStore.getState().apiVersion).toBe("1.2.3");
  });
});
