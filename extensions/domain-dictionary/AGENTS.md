# Pi Extension UI Guide for Agents

## Rendering Output

**Don't use `console.log`** — it causes the input prompt to overlap with output.

### Use These APIs Instead

```typescript
// 1. Simple notifications
ctx.ui.notify('Message here', 'info');  // or 'warning', 'error'

// 2. Multi-line output (use widget)
const lines = ['Line 1', 'Line 2', 'Line 3'];
ctx.ui.setWidget('my-results', lines, { placement: 'belowEditor' });

// 3. Clear widget
ctx.ui.setWidget('my-results', undefined);
```

### Placement Options

- `belowEditor` — show below the chat/editor (good for results)
- `aboveEditor` — show above the chat/editor (good for headers)

### Context

- `ctx.ui` is available in command handlers via `ExtensionCommandContext`
- Widgets are identified by key — reuse the same key to update content
