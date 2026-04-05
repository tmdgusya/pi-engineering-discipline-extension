export type WorkflowStatus = "idle" | "thinking" | "planning" | "executing" | "error" | "completed";
export type ToolStatus = "pending" | "running" | "success" | "error";

export interface ToolExecution {
  id: string;
  name: string;
  status: ToolStatus;
  startedAt: number;
  completedAt?: number;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

export interface AgentMetrics {
  turnsCount: number;
  toolsExecuted: number;
  tokensUsed: number;
  errorsCount: number;
  startTime: number;
}

export interface HUDState {
  workflowStatus: WorkflowStatus;
  currentGoal: string;
  activeToolCalls: ToolExecution[];
  metrics: AgentMetrics;
  showStatusBar: boolean;
  showMetrics: boolean;
  showToolList: boolean;
  isMinimized: boolean;
  providerConnected: boolean;
  lastHeartbeat: number;
  apiVersion: string;
  isCompatible: boolean;
}

const MAX_TOOL_HISTORY = 50;
const COMPATIBLE_API_VERSION = "0.65.0";

type Subscriber<T> = (state: T) => void;
type Selector<T, R> = (state: T) => R;

class ImmutableStore<T extends object> {
  private state: T;
  private subscribers: Set<Subscriber<T>> = new Set();

  constructor(initialState: T) {
    this.state = { ...initialState };
  }

  getState(): Readonly<T> {
    return this.state;
  }

  setState(updater: (state: T) => T): void {
    const nextState = updater(this.state);
    if (nextState !== this.state) {
      this.state = Object.freeze({ ...nextState });
      this.notify();
    }
  }

  subscribe(subscriber: Subscriber<T>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  select<R>(selector: Selector<T, R>): R {
    return selector(this.state);
  }

  private notify(): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(this.state);
      } catch (e) {
        console.error("[HUD] Subscriber error:", e);
      }
    }
  }
}

const initialState: HUDState = {
  workflowStatus: "idle",
  currentGoal: "",
  activeToolCalls: [],
  metrics: {
    turnsCount: 0,
    toolsExecuted: 0,
    tokensUsed: 0,
    errorsCount: 0,
    startTime: Date.now(),
  },
  showStatusBar: true,
  showMetrics: false,
  showToolList: true,
  isMinimized: false,
  providerConnected: true,
  lastHeartbeat: Date.now(),
  apiVersion: COMPATIBLE_API_VERSION,
  isCompatible: true,
};

export const hudStore = new ImmutableStore<HUDState>(initialState);

export const hudActions = {
  setWorkflowStatus(status: WorkflowStatus): void {
    hudStore.setState(s => ({ ...s, workflowStatus: status }));
  },

  setCurrentGoal(goal: string): void {
    hudStore.setState(s => ({ ...s, currentGoal: goal }));
  },

  startToolCall(tool: ToolExecution): void {
    hudStore.setState(s => {
      const updatedTools = [...s.activeToolCalls, tool];
      if (updatedTools.length > MAX_TOOL_HISTORY) {
        updatedTools.splice(0, updatedTools.length - MAX_TOOL_HISTORY);
      }
      return {
        ...s,
        activeToolCalls: updatedTools,
        metrics: { ...s.metrics, toolsExecuted: s.metrics.toolsExecuted + 1 }
      };
    });
  },

  updateToolCall(id: string, updates: Partial<ToolExecution>): void {
    hudStore.setState(s => ({
      ...s,
      activeToolCalls: s.activeToolCalls.map(t =>
        t.id === id ? { ...t, ...updates } : t
      )
    }));
  },

  completeToolCall(id: string, result: string): void {
    hudStore.setState(s => ({
      ...s,
      activeToolCalls: s.activeToolCalls.map(t =>
        t.id === id ? { ...t, status: "success" as ToolStatus, completedAt: Date.now(), result } : t
      )
    }));
  },

  failToolCall(id: string, error: string): void {
    hudStore.setState(s => ({
      ...s,
      activeToolCalls: s.activeToolCalls.map(t =>
        t.id === id ? { ...t, status: "error" as ToolStatus, completedAt: Date.now(), error } : t
      ),
      metrics: { ...s.metrics, errorsCount: s.metrics.errorsCount + 1 }
    }));
  },

  incrementTurn(): void {
    hudStore.setState(s => ({
      ...s,
      metrics: { ...s.metrics, turnsCount: s.metrics.turnsCount + 1 }
    }));
  },

  updateTokensUsed(tokens: number): void {
    hudStore.setState(s => ({
      ...s,
      metrics: { ...s.metrics, tokensUsed: s.metrics.tokensUsed + tokens }
    }));
  },

  toggleMinimized(): void {
    hudStore.setState(s => ({ ...s, isMinimized: !s.isMinimized }));
  },

  toggleMetrics(): void {
    hudStore.setState(s => ({ ...s, showMetrics: !s.showMetrics }));
  },

  toggleToolList(): void {
    hudStore.setState(s => ({ ...s, showToolList: !s.showToolList }));
  },

  setProviderConnected(connected: boolean): void {
    hudStore.setState(s => ({
      ...s,
      providerConnected: connected,
      lastHeartbeat: Date.now()
    }));
  },

  heartbeat(): void {
    hudStore.setState(s => ({ ...s, lastHeartbeat: Date.now() }));
  },

  setApiVersion(version: string): void {
    const isCompatible = version.startsWith(COMPATIBLE_API_VERSION.split(".")[0] + ".");
    hudStore.setState(s => ({ ...s, apiVersion: version, isCompatible }));
  },

  reset(): void {
    hudStore.setState(s => ({
      ...initialState,
      metrics: {
        ...initialState.metrics,
        startTime: Date.now(),
      },
      apiVersion: s.apiVersion,
      isCompatible: s.isCompatible,
    }));
  },
};

export const hudSelectors = {
  isIdle: () => hudStore.select(s => s.workflowStatus === "idle"),
  isWorking: () => hudStore.select(s =>
    s.workflowStatus === "thinking" ||
    s.workflowStatus === "planning" ||
    s.workflowStatus === "executing"
  ),
  hasActiveTools: () => hudStore.select(s =>
    s.activeToolCalls.some(t => t.status === "running" || t.status === "pending")
  ),
  getRunningTools: () => hudStore.select(s =>
    s.activeToolCalls.filter(t => t.status === "running")
  ),
  getSessionDuration: () => hudStore.select(s =>
    Math.floor((Date.now() - s.metrics.startTime) / 1000)
  ),
  getErrorRate: () => hudStore.select(s => {
    const total = s.metrics.toolsExecuted;
    return total > 0 ? (s.metrics.errorsCount / total * 100).toFixed(1) : "0.0";
  }),
};
