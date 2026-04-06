import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { DomainEntry, DictQueryResult } from './types.js';
import { DictError } from './types.js';
import { getGitCommits, extractDomainsFromCommits } from './git-parser.js';

const DICT_FILENAME = 'domain-dictionary.jsonl';

export class Dictionary {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  static defaultPath(cwd: string): string {
    return join(cwd, '.pi', DICT_FILENAME);
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }

  save(entries: DomainEntry[]): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    const jsonl = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(this.filePath, jsonl, 'utf-8');
  }

  load(): DomainEntry[] {
    if (!this.exists()) return [];

    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];

    return content.split('\n').map(line => JSON.parse(line) as DomainEntry);
  }

  search(query: string): DictQueryResult[] {
    const entries = this.load();
    const q = query.toLowerCase();

    return entries
      .filter(entry => {
        if (entry.domain.toLowerCase().includes(q)) return true;
        if (entry.files.some(f => f.path.toLowerCase().includes(q))) return true;
        return false;
      })
      .map(entry => ({
        domain: entry.domain,
        files: entry.files,
        commitCount: entry.commitCount,
      }));
  }
}

/**
 * Build the dictionary from git history.
 * Language-agnostic — any file tracked by git is included.
 */
export function buildDictionary(cwd: string): DomainEntry[] {
  const commits = getGitCommits(cwd);
  const domainMap = extractDomainsFromCommits(commits);

  const entries: DomainEntry[] = [];
  const now = new Date().toISOString();

  for (const [, domainData] of domainMap) {
    entries.push({
      domain: domainData.domain,
      files: domainData.files,
      commitCount: domainData.commitCount,
      updatedAt: now,
    });
  }

  return entries.sort((a, b) => b.commitCount - a.commitCount);
}
