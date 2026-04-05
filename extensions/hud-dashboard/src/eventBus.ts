import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hudStore, hudActions, type WorkflowStatus, type ToolStatus } from "./state.js";

export type HUDEventType =
  | "workflow:start"
  | "workflow:end"
  | "workflow:status"
  | "tool:start"
  | "tool:update"
  | "tool:end"
  | "tool:error"
  | "turn:start"
  | "turn:end"
  | "error:occur"
  | "heartbeat"
  | "metrics:update";

export interface HUDEvent<T = unknown> {
  type: HUDEventType;
  timestamp: number;
  payload: T;
  source: string;
}

type HUDEventHandler<T = unknown> = (event: HUDEvent<T>) => void;

interface ToolExecution {
  id: string;
  name: string;
  status: ToolStatus;
  startedAt: number;
  args?: Record<string, unknown>;
}

class HUDEventBus {
  private handlers: Map<HUDEventType, Set<HUDEventHandler>> = new Map();
  private buffer: HUDEvent[] = [];
  private bufferSize = 100;
  private throttleMs = 50;
  private lastEventTime: Map<HUDEventType, number> = new Map();
  private pi: ExtensionAPI | null = null;
  private cleanupFns: Array<() => void> = [];

  init(pi: ExtensionAPI): void {
    this.pi = pi;
    this.registerPiEventHandlers();
  }

  subscribe<T>(eventType: HUDEventType, handler: HUDEventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as HUDEventHandler);
    return () => {
      this.handlers.get(eventType)?.delete(handler as HUDEventHandler);
    };
  }

  emit<T>(type: HUDEventType, payload: T, source = "hud"): void {
    const now = Date.now();
    const lastTime = this.lastEventTime.get(type) || 0;

    if (now - lastTime < this.throttleMs) return;
    this.lastEventTime.set(type, now);

    const event: HUDEvent<T> = { type, timestamp: now, payload, source };
    this.bufferEvent(event);

    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event); } catch (e) { console.error(`[HUD EventBus] Handler error for ${type}:`, e); }
      }
    }
  }

  private bufferEvent(event: HUDEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
  }

  getBuffer(): readonly HUDEvent[] { return this.buffer; }
  clearBuffer(): void { this.buffer = []; }
  setThrottle(ms: number): void { this.throttleMs = ms; }

  private registerPiEventHandlers(): void {
    if (!this.pi) return;

    this.pi.on("tool_execution_start", async (event) => {
      const tool: ToolExecution = {
        id: event.toolCallId,
        name: event.toolName,
        status: "running",
        startedAt: Date.now(),
        args: (event as any).input || (event as any).args || {},
      };
      hudActions.startToolCall(tool);
      this.emit("tool:start", tool);
    });

    this.pi.on("tool_execution_update", async (event) => {
      this.emit("tool:update", { id: event.toolCallId, partialResult: event.partialResult });
    });

    this.pi.on("tool_execution_end", async (event) => {
      const result = event.result?.content?.[0]?.type === "text"
        ? event.result.content[0].text
        : "";
      hudActions.completeToolCall(event.toolCallId, result);
      this.emit("tool:end", { id: event.toolCallId, result });
    });

    this.pi.on("turn_start", async () => {
      hudActions.incrementTurn();
      this.emit("turn:start", { timestamp: Date.now() });
    });

    this.pi.on("turn_end", async () => {
      this.emit("turn:end", { timestamp: Date.now() });
    });

    this.pi.on("agent_start", async () => {
      hudActions.setWorkflowStatus("thinking");
      this.emit("workflow:start", { status: "thinking" });
    });

    this.pi.on("agent_end", async () => {
      hudActions.setWorkflowStatus("completed");
      this.emit("workflow:end", { status: "completed" });
    });

    this.pi.on("message_update", async (event) => {
      const msg = event.message;
      if (msg.role === "assistant" && msg.content) {
        const hasToolCalls = (msg as any).toolCalls?.length > 0;
        if (hasToolCalls && hudStore.getState().workflowStatus === "thinking") {
          hudActions.setWorkflowStatus("executing");
          this.emit("workflow:status", { status: "executing" });
        }
      }
    });

    this.pi.on("tool_result", async (event) => {
      if (event.isError) {
        hudActions.failToolCall(event.toolCallId, "Tool execution failed");
        this.emit("tool:error", { id: event.toolCallId, isError: true });
      }
    });

    this.cleanupFns.push(() => {
      this.handlers.clear();
      this.buffer = [];
      this.lastEventTime.clear();
    });
  }

  destroy(): void {
    for (const cleanup of this.cleanupFns) {
      try { cleanup(); } catch (e) { console.error("[HUD EventBus] Cleanup error:", e); }
    }
    this.cleanupFns = [];
    this.handlers.clear();
    this.buffer = [];
  }

  getSubscriberCount(type: HUDEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

export const hudEventBus = new HUDEventBus();

export function emitWorkflowStart(status: WorkflowStatus): void {
  hudEventBus.emit("workflow:start", { status });
}

export function emitWorkflowEnd(status: WorkflowStatus): void {
  hudEventBus.emit("workflow:end", { status });
}

export function emitToolStart(tool: { id: string; name: string }): void {
  hudEventBus.emit("tool:start", tool);
}

export function emitToolEnd(toolId: string, result: unknown): void {
  hudEventBus.emit("tool:end", { id: toolId, result });
}

export function emitHeartbeat(): void {
  hudActions.heartbeat();
  hudEventBus.emit("heartbeat", { timestamp: Date.now() });
}
