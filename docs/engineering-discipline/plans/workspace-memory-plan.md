# Workspace-Specific Auto Memory — Implementation Plan

## Overview
Extension-based workspace memory system for pi. Automatically detects important moments in conversation (bug fixes, decisions, etc.), saves them as structured memory, and efficiently recalls them in future related conversations.

## Architecture

```
extensions/workspace-memory/
├── index.ts          # Main extension entry
├── types.ts          # TypeScript interfaces
├── storage.ts        # File I/O (index.json + memory files)
├── recall.ts         # Token-efficient recall pipeline
├── templates.ts      # Post-mortem / Decision Record / Compact Note
└── scoring.ts        # Score calculation & eviction
```

---

## Task 1: Storage Layer (`storage.ts`)

**Goal:** Read/write workspace-scoped memory files under `~/.pi/agent/memory/`.

### File Layout
```
~/.pi/agent/memory/
└── --Users-roach-lit-api--/
    ├── index.json          # Lightweight index of all memories
    └── mem-<timestamp>-<hash>.json   # Individual memory files
```

### `index.json` Structure (Token-Efficient)
```json
{
  "version": 1,
  "workspace": "/Users/roach/lit-api",
  "lastUpdated": "2026-04-23T10:00:00Z",
  "memories": [
    {
      "id": "mem-1713858000-a3f2",
      "file": "mem-1713858000-a3f2.json",
      "template": "post-mortem",
      "summary": "Redis connection pool exhaustion during peak traffic",
      "tags": ["bug", "redis", "connection-pool", "performance"],
      "createdAt": "2026-04-20T14:30:00Z",
      "lastRecalledAt": "2026-04-22T09:15:00Z",
      "recallCount": 3,
      "score": 0.85
    }
  ]
}
```

### Individual Memory File Structure
```json
{
  "id": "mem-1713858000-a3f2",
  "template": "post-mortem",
  "metadata": {
    "createdAt": "2026-04-20T14:30:00Z",
    "tags": ["bug", "redis", "connection-pool"],
    "triggerKeywords": ["bug", "redis", "connection pool"]
  },
  "content": {
    "problem": "Redis connection pool exhausted under peak load (~5000 concurrent users)",
    "rootCause": "Connection timeout was set to 30s but max pool size was only 50. Connections were not released promptly due to long-running queries.",
    "fix": "Increased pool size to 200, reduced connection timeout to 5s, added connection leasing with max lease time of 2s.",
    "prevention": "Add monitoring for pool utilization > 80%. Implement circuit breaker for Redis calls."
  }
}
```

### Functions
- `getMemoryDir(cwd: string): string` — Encode cwd to safe path
- `loadIndex(cwd: string): MemoryIndex`
- `saveIndex(index: MemoryIndex, cwd: string)`
- `loadMemory(id: string, cwd: string): Memory`
- `saveMemory(memory: Memory, cwd: string)`
- `deleteMemory(id: string, cwd: string)`

---

## Task 2: Templates (`templates.ts`)

**Goal:** Determine template type from conversation keywords and provide structured prompts for LLM.

### Keyword → Template Mapping
```typescript
const KEYWORD_TEMPLATES: Record<string, MemoryTemplate> = {
  'bug': 'post-mortem',
  'fix': 'post-mortem',
  'solved': 'post-mortem',
  'root cause': 'post-mortem',
  '버그': 'post-mortem',
  '장애': 'post-mortem',
  '결정': 'decision-record',
  '중요': 'decision-record',
  'decision': 'decision-record',
};
```

### Template Prompts (for LLM)

**Post-mortem Prompt:**
```
This conversation appears to involve resolving an issue or bug.
Please create a post-mortem memory with these sections:
- Problem: What went wrong?
- Root Cause: Why did it happen?
- Fix: How was it resolved?
- Prevention: How to prevent recurrence?

Be concise but specific. Include file names, error messages, or commands if relevant.
```

**Decision Record Prompt:**
```
This conversation involves an important decision.
Please create a decision record with these sections:
- Context: What situation led to this decision?
- Decision: What was decided?
- Rationale: Why this choice?
- Alternatives Considered: What else was considered?
```

**Compact Note Prompt:**
```
Summarize the key information from this conversation in 2-3 sentences.
Focus on actionable takeaways or important context for future reference.
```

---

## Task 3: Auto-Save Trigger (`index.ts` — memory tool)

**Goal:** Detect keywords in conversation and prompt LLM to save memory.

### System Prompt Injection
On `session_start`, inject system prompt section:
```
## Workspace Memory System
This workspace has a memory system. When you encounter important information
such as bug fixes, root causes, architectural decisions, or critical findings,
please use the `memory_save` tool to record it for future reference.

The system will automatically suggest saving when relevant keywords are detected.
```

### Keyword Detection (Local, Zero Token)
On each user message, scan for trigger keywords (case-insensitive, Korean/English).
If any keyword found, append a `custom_message` (non-display) to the conversation:
```
[System Note: This conversation contains keywords related to "bug" / "장애".
If a significant issue was discussed and resolved, please use memory_save to record it
as a post-mortem for future reference.]
```

This message is:
- Stored in session history
- Visible to LLM as context
- NOT displayed to user (display: false)

### `memory_save` Tool Registration
```typescript
pi.registerTool({
  name: 'memory_save',
  description: 'Save important workspace memory (bug fix, decision, key insight)',
  parameters: z.object({
    content: z.string().describe('Structured memory content (use template format)'),
    template: z.enum(['post-mortem', 'decision-record', 'compact-note']),
    tags: z.array(z.string()).optional(),
  }),
  execute: async ({ content, template, tags }, ctx) => {
    // Save to storage
    // Return success confirmation
  }
});
```

---

## Task 4: Token-Efficient Recall (`recall.ts`)

**Goal:** Load relevant memories into context with minimal token usage.

### Recall Pipeline
```
1. LOAD INDEX (lightweight: only summaries + tags)
   → ~2KB for 100 memories

2. LOCAL KEYWORD FILTER (zero token cost)
   Extract keywords from current conversation
   Match against memory tags/summaries
   → Filter to candidate set (typically 5-15 memories)

3. LLM RELEVANCE SELECTION (1 API call)
   Send candidate summaries to LLM
   Ask: "Which memories are relevant to the current conversation?"
   → Returns top 3-5 memory IDs

4. FULL CONTENT LOAD (only for selected memories)
   Load full memory files for selected IDs
   → Inject into system prompt or custom message
```

### `before_agent_start` Implementation
```typescript
pi.on('before_agent_start', async (event, ctx) => {
  const index = await loadIndex(ctx.cwd);
  
  // Step 1: Extract keywords from recent messages
  const keywords = extractKeywords(event.messages);
  
  // Step 2: Local filter
  const candidates = index.memories.filter(m => 
    keywords.some(k => m.tags.includes(k) || m.summary.includes(k))
  );
  
  if (candidates.length === 0) return {};
  
  // Step 3: LLM selection (if many candidates)
  let selected = candidates;
  if (candidates.length > 5) {
    selected = await selectRelevantMemories(candidates, event.messages, ctx);
  }
  
  // Step 4: Load full content
  const memories = await Promise.all(
    selected.map(c => loadMemory(c.id, ctx.cwd))
  );
  
  // Update recall stats
  for (const c of selected) {
    c.recallCount++;
    c.lastRecalledAt = new Date().toISOString();
    await recalculateScore(c);
  }
  await saveIndex(index, ctx.cwd);
  
  // Inject into context
  const memoryContext = formatMemoriesForContext(memories);
  return {
    systemPrompt: event.systemPrompt + '\n\n## Relevant Workspace Memories\n' + memoryContext
  };
});
```

### Keyword Extraction
```typescript
function extractKeywords(messages: Message[]): string[] {
  const text = messages.slice(-5).map(m => m.content).join(' ');
  // Extract: nouns, technical terms, file paths, error names
  // Remove stop words, deduplicate
  // Return top 10 most relevant terms
}
```

---

## Task 5: Scoring & Eviction (`scoring.ts`)

**Goal:** Maintain max 200 memories, evict lowest score first.

### Score Formula
```typescript
function calculateScore(memory: MemoryIndexEntry): number {
  const daysSinceRecall = daysSince(memory.lastRecalledAt);
  const recencyDecay = Math.exp(-daysSinceRecall / 30); // 30-day half-life
  return memory.recallCount * recencyDecay;
}
```

### Eviction Logic
```typescript
async function evictIfNeeded(index: MemoryIndex, cwd: string): Promise<void> {
  if (index.memories.length <= 200) return;
  
  // Sort by score ascending (lowest first)
  index.memories.sort((a, b) => a.score - b.score);
  
  const toRemove = index.memories.length - 200;
  const evicted = index.memories.splice(0, toRemove);
  
  for (const mem of evicted) {
    await deleteMemoryFile(mem.id, cwd);
  }
  
  await saveIndex(index, cwd);
}
```

### Score Recalculation
- On every recall: update `recallCount`, `lastRecalledAt`, recalculate score
- Periodically (on save): recalculate all scores to apply time decay

---

## Task 6: User Commands (`index.ts`)

### `/memory` Command Family

```typescript
pi.registerCommand('memory', {
  description: 'Manage workspace memories',
  subcommands: {
    'list': 'List all memories in this workspace',
    'show': 'Show full content of a memory',
    'save': 'Manually save a memory',
    'delete': 'Delete a memory',
    'search': 'Search memories by keyword',
    'stats': 'Show memory statistics',
  }
});
```

### Subcommands
- `/memory list` — Show table: ID | Template | Summary | Recalls | Score
- `/memory show <id>` — Display full memory content
- `/memory save <content>` — Manual save (template auto-detected from keywords)
- `/memory delete <id>` — Remove specific memory
- `/memory search <query>` — Keyword search across summaries and tags
- `/memory stats` — Show count, storage size, top recalled memories

---

## Task 7: Extension Entry (`index.ts`)

### Event Handlers
```typescript
export default function memoryExtension(pi: ExtensionAPI) {
  // On session start: load index into memory (cache)
  pi.on('session_start', async (event, ctx) => {
    const index = await loadIndex(ctx.cwd);
    ctx.memoryCache = index; // Cache for the session
  });
  
  // On each message: keyword detection
  pi.on('message', async (event, ctx) => {
    if (event.message.role === 'user') {
      const keywords = detectTriggerKeywords(event.message.content);
      if (keywords.length > 0) {
        await pi.sendCustomMessage(
          `memory-trigger`,
          `[System Note: Keywords detected: ${keywords.join(', ')}. ` +
          `If significant findings were discussed, please use memory_save.]`,
          false // display: false
        );
      }
    }
  });
  
  // Before agent start: recall relevant memories
  pi.on('before_agent_start', async (event, ctx) => {
    return await recallMemories(event, ctx);
  });
  
  // Register tools and commands
  registerMemoryTools(pi);
  registerMemoryCommands(pi);
}
```

---

## Task 8: Testing Strategy

### Unit Tests
1. **Storage**: Test encode/decode paths, JSON serialization
2. **Keyword Detection**: Test Korean/English keyword matching
3. **Template Selection**: Test keyword → template mapping
4. **Scoring**: Test score calculation with different recall counts and ages
5. **Eviction**: Test eviction respects 200-item limit and removes lowest score

### Integration Tests
1. **End-to-end save**: Simulate conversation with bug keyword → verify memory saved
2. **Recall flow**: Save memory → start new conversation with related topic → verify memory injected
3. **Template correctness**: Verify post-mortem structure is preserved

### Manual Tests
1. `/memory save` manual save
2. `/memory list` after multiple saves
3. `/memory search` with various queries
4. `/memory stats` verification

---

## Implementation Order

1. **Phase 1 — Foundation**: `types.ts` + `storage.ts` (file I/O)
2. **Phase 2 — Templates**: `templates.ts` (prompts + keyword mapping)
3. **Phase 3 — Save Flow**: `memory_save` tool + keyword detection in `index.ts`
4. **Phase 4 — Recall**: `recall.ts` + `before_agent_start` integration
5. **Phase 5 — Scoring**: `scoring.ts` + eviction logic
6. **Phase 6 — Commands**: `/memory` command family
7. **Phase 7 — Polish**: System prompt injection, caching optimization, edge cases

---

## Token Budget Analysis

| Phase | Token Cost | Notes |
|-------|-----------|-------|
| Index load (100 memories) | ~2KB | Summaries + tags only |
| Keyword filter | 0 | Local computation |
| LLM selection (5 candidates) | ~500 tokens | One-shot selection prompt |
| Full content (3 memories) | ~1.5KB | Only selected memories |
| **Total per turn** | **~4KB worst case** | Typically 0-1KB (no match) |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| LLM doesn't use memory_save tool | Stronger system prompt + custom_message trigger |
| Too many false positives | Tune keyword list; require LLM judgment |
| Index corruption | JSON schema validation; backup on write |
| Token bloat from memories | Strict 5-memory limit per recall; compact formatting |
| Score manipulation | Decay formula prevents old high-count memories from dominating |

---

## Success Verification

- [ ] Bug conversation triggers memory save suggestion
- [ ] Memory is saved with correct post-mortem structure
- [ ] New conversation about same topic recalls the memory
- [ ] 200+ memories trigger eviction of lowest score
- [ ] `/memory list` shows all workspace memories
- [ ] Index.json stays under 5KB even with 200 memories
