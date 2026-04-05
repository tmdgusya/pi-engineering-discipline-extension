# HUD Dashboard Extension for pi-coding-agent

An interactive HUD (Heads-Up Display) extension for the [pi coding agent](https://github.com/badlogic/pi-mono) that provides real-time monitoring of agentic workflow status.

## Features

### 🎯 Real-time Workflow Tracking
- **Status indicators**: Idle, Thinking, Planning, Executing, Error, Completed
- **Animated spinners**: Visual feedback during active states
- **Connection monitoring**: Heartbeat-based provider connectivity check

### 🔧 Tool Execution Monitoring
- **Live tool call tracking**: See which tools are running, pending, or completed
- **Execution timing**: Track when tools start and finish
- **Error highlighting**: Visual indicators for failed tool executions

### 📊 Metrics Dashboard
- **Turn count**: Number of agent turns in the session
- **Tools executed**: Total tools run since session start
- **Error rate**: Percentage of failed tool executions
- **Session duration**: Time since the HUD was initialized

### 🔒 Security Hardening (Phase 2B)
- **Secret redaction**: Automatically masks API keys, tokens, and credentials
- **Content sanitization**: XSS prevention for displayed content
- **IPC message signing**: Integrity verification for inter-process messages
- **Permission model**: Granular access control for extension features

### ⚡ State Synchronization (Phase 3)
- **Optimistic updates**: Immediate UI feedback with automatic rollback on failure
- **Debounced reconciliation**: Batch state changes to prevent thrashing
- **Atomic mutations**: Thread-safe state updates
- **Heartbeat monitoring**: Automatic detection of provider disconnections

### 🎨 UX Polish (Phase 4)
- **Context-aware display**: Widgets adapt based on current workflow state
- **Collapsible panels**: Minimize widgets to reduce cognitive load
- **Preference persistence**: Your settings are saved across sessions
- **State indicators**: Loading, success, error, and info toasts

## Installation

### Prerequisites
- [pi-coding-agent](https://github.com/badlogic/pi-mono) installed
- [engineering-discipline skills](https://github.com/tmdgusya/engineering-discipline) installed

### Install HUD Dashboard

```bash
pi install git:github.com/tmdgusya/pi-engineering-discipline-extension
```

This extension will be auto-discovered from `~/.pi/agent/extensions/`.

## Commands

| Command | Description |
|---------|-------------|
| `/hud-help` | Show HUD Dashboard help |
| `/hud-status` | Show current HUD status (workflow, tools, errors, heartbeat) |
| `/hud-metrics` | Toggle metrics widget visibility |
| `/hud-tools` | Toggle tool list widget visibility |
| `/hud-minimize` | Minimize or restore the HUD dashboard |
| `/hud-reset` | Reset HUD state to defaults |

## Architecture

The extension follows a phased implementation based on the ultraplan milestone DAG:

```
Phase 0: Foundation (Extension scaffold, version checks)
    │
    ▼
Phase 1: Core State Management (Immutable store, memory cap)
    │
    ├──────┬──────┬──────┐
    ▼      ▼      ▼
Phase 2A  Phase 2B  Phase 2C
EventBus  Security  UI Core
    │      │      │
    └──────┴──────┘
              │
              ▼
         Phase 3: Real-time Sync (Optimistic updates, heartbeat)
              │
              ▼
         Phase 4: UX Polish (Context-aware, persistence)
              │
              ▼
         Phase 5: Integration & Hardening
```

## Security Notes

The HUD Dashboard implements several security measures:

1. **Secret Redaction**: Patterns matching `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, etc. are automatically redacted before display.

2. **Content Sanitization**: All displayed text is escaped to prevent XSS attacks.

3. **Permission Model**: The extension uses time-limited permission grants that auto-expire.

4. **Security Audit Log**: All security-relevant events are logged for review.

## Development

To modify or extend this extension:

1. Clone the extension:
   ```bash
   git clone https://github.com/tmdgusya/pi-engineering-discipline-extension.git
   cd pi-engineering-discipline-extension/extensions/hud-dashboard
   ```

2. The extension is structured as follows:
   ```
   src/
   ├── index.ts        # Main entry point
   ├── state.ts        # Phase 1: Immutable state store
   ├── eventBus.ts     # Phase 2A: Pub/sub event system
   ├── security.ts     # Phase 2B: Secret redaction, sanitization
   ├── ui.ts           # Phase 2C: Widget registry, renderers
   ├── sync.ts         # Phase 3: Optimistic updates, reconciliation
   └── preferences.ts  # Phase 4: Context-aware display, persistence
   ```

3. TypeScript compilation check:
   ```bash
   npm run build
   ```

## License

MIT - See [engineering-discipline](https://github.com/tmdgusya/engineering-discipline)
