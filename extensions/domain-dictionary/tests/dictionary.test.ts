import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Dictionary } from '../dictionary.js';
import type { DomainEntry } from '../types.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__');
const DICT_PATH = join(TEST_DIR, '.pi', 'domain-dictionary.jsonl');

function makeDomainEntry(overrides: Partial<DomainEntry> = {}): DomainEntry {
  return {
    domain: 'auth',
    files: [{ path: 'src/auth/login.ts', changeCount: 3 }],
    commitCount: 5,
    updatedAt: '2025-04-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('Dictionary', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, '.pi'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('save', () => {
    it('writes entries as JSONL', () => {
      const dict = new Dictionary(DICT_PATH);
      const entries = [
        makeDomainEntry({ domain: 'auth' }),
        makeDomainEntry({ domain: 'push', commitCount: 2 }),
      ];

      dict.save(entries);

      const content = readFileSync(DICT_PATH, 'utf-8').trim();
      const lines = content.split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).domain).toBe('auth');
      expect(JSON.parse(lines[1]).domain).toBe('push');
    });

    it('overwrites existing file', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([makeDomainEntry({ domain: 'old' })]);
      dict.save([makeDomainEntry({ domain: 'new' })]);

      const content = readFileSync(DICT_PATH, 'utf-8').trim();
      const lines = content.split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).domain).toBe('new');
    });
  });

  describe('load', () => {
    it('reads entries from JSONL', () => {
      const dict = new Dictionary(DICT_PATH);
      const entries = [makeDomainEntry({ domain: 'auth' }), makeDomainEntry({ domain: 'push' })];
      dict.save(entries);

      const loaded = dict.load();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].domain).toBe('auth');
      expect(loaded[1].domain).toBe('push');
    });

    it('returns empty array if file does not exist', () => {
      const dict = new Dictionary(join(TEST_DIR, '.pi', 'nonexistent.jsonl'));
      expect(dict.load()).toEqual([]);
    });
  });

  describe('search', () => {
    it('finds exact domain match', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([
        makeDomainEntry({ domain: 'auth' }),
        makeDomainEntry({ domain: 'push', files: [{ path: 'src/push/notify.ts', changeCount: 1 }] }),
      ]);

      const results = dict.search('auth');
      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe('auth');
    });

    it('finds partial domain match', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([
        makeDomainEntry({ domain: 'session-loop' }),
        makeDomainEntry({ domain: 'session-hook' }),
        makeDomainEntry({ domain: 'auth' }),
      ]);

      const results = dict.search('session');
      expect(results).toHaveLength(2);
    });

    it('searches in file paths', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([
        makeDomainEntry({
          domain: 'auth',
          files: [{ path: 'src/auth/login.py', changeCount: 1 }],
        }),
      ]);

      const results = dict.search('login.py');
      expect(results).toHaveLength(1);
    });

    it('is case-insensitive', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([makeDomainEntry({ domain: 'Auth' })]);

      const results = dict.search('auth');
      expect(results).toHaveLength(1);
    });

    it('returns empty for no match', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([makeDomainEntry({ domain: 'auth' })]);

      const results = dict.search('zzz');
      expect(results).toEqual([]);
    });
  });

  describe('exists', () => {
    it('returns false when dictionary file does not exist', () => {
      const dict = new Dictionary(join(TEST_DIR, '.pi', 'nonexistent.jsonl'));
      expect(dict.exists()).toBe(false);
    });

    it('returns true when dictionary file exists', () => {
      const dict = new Dictionary(DICT_PATH);
      dict.save([makeDomainEntry()]);
      expect(dict.exists()).toBe(true);
    });
  });
});
