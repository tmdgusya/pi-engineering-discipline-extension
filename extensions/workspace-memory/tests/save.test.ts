import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAndSaveMemory } from '../save.js';
import { getCachedIndex, invalidateCache } from '../storage.js';

vi.mock('@mariozechner/pi-coding-agent', () => ({
  getAgentDir: vi.fn(),
}));

import { getAgentDir } from '@mariozechner/pi-coding-agent';

const mockedGetAgentDir = vi.mocked(getAgentDir);

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'workspace-memory-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createAndSaveMemory', () => {
  it('evicts over-limit memories and keeps index at 200', () => {
    const root = createTempRoot();
    mockedGetAgentDir.mockReturnValue(root);

    const cwd = '/tmp/workspace-memory-save-evict';

    for (let i = 0; i < 201; i += 1) {
      createAndSaveMemory({ content: `note ${i}` }, cwd);
    }

    invalidateCache(cwd);
    const index = getCachedIndex(cwd);
    expect(index.memories.length).toBe(200);
  });
});
