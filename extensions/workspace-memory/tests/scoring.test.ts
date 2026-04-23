import { describe, expect, it } from 'vitest';
import type { MemoryIndex, MemoryIndexEntry } from '../types.js';
import { evictIfNeeded } from '../scoring.js';

function makeEntry(i: number): MemoryIndexEntry {
  return {
    id: `mem-${i}-abcd`,
    file: `mem-${i}-abcd.json`,
    template: 'compact-note',
    summary: `summary ${i}`,
    tags: [],
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
    lastRecalledAt: null,
    recallCount: 0,
    score: 0,
  };
}

describe('evictIfNeeded', () => {
  it('returns an array of evicted memories when index exceeds max', () => {
    const index: MemoryIndex = {
      version: 1,
      workspace: '/tmp/ws',
      lastUpdated: new Date().toISOString(),
      memories: Array.from({ length: 201 }, (_, i) => makeEntry(i + 1)),
    };

    const evicted = evictIfNeeded(index, '/tmp/ws');

    expect(Array.isArray(evicted)).toBe(true);
    expect(evicted.length).toBe(1);
    expect(index.memories.length).toBe(200);
  });
});
