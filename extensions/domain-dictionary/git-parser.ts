import { execSync } from 'child_process';
import { DictionaryError } from './types.js';
import type { ParsedCommit, DomainFile } from './types.js';

const CONVENTIONAL_COMMIT_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s/;

export function parseCommitLine(line: string): ParsedCommit {
  const pipeIdx = line.indexOf('|');
  const hash = line.slice(0, pipeIdx);
  const subject = line.slice(pipeIdx + 1);

  const match = subject.match(CONVENTIONAL_COMMIT_RE);

  return {
    hash,
    type: match ? match[1] : null,
    scope: match && match[2] ? match[2] : null,
    subject,
    files: [],
  };
}

export function parseGitLog(raw: string): ParsedCommit[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const commits: ParsedCommit[] = [];
  const blocks = trimmed.split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.length > 0);
    if (lines.length === 0) continue;

    const commit = parseCommitLine(lines[0]);
    commit.files = lines.slice(1);
    commits.push(commit);
  }

  return commits;
}

export function extractDomainsFromCommits(
  commits: ParsedCommit[]
): Map<string, { domain: string; files: DomainFile[]; commitCount: number }> {
  const domains = new Map<string, { domain: string; fileMap: Map<string, number>; commitCount: number }>();

  for (const commit of commits) {
    if (!commit.scope) continue;

    const domain = commit.scope.toLowerCase();

    let entry = domains.get(domain);
    if (!entry) {
      entry = { domain, fileMap: new Map(), commitCount: 0 };
      domains.set(domain, entry);
    }

    entry.commitCount++;

    for (const file of commit.files) {
      entry.fileMap.set(file, (entry.fileMap.get(file) ?? 0) + 1);
    }
  }

  const result = new Map<string, { domain: string; files: DomainFile[]; commitCount: number }>();

  for (const [domain, entry] of domains) {
    const files: DomainFile[] = Array.from(entry.fileMap.entries())
      .map(([path, changeCount]) => ({ path, changeCount }))
      .sort((a, b) => b.changeCount - a.changeCount);

    result.set(domain, { domain, files, commitCount: entry.commitCount });
  }

  return result;
}

export function getGitCommits(cwd: string): ParsedCommit[] {
  try {
    const raw = execSync(
      'git log --pretty=format:"%h|%s" --name-only',
      { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return parseGitLog(raw);
  } catch (err) {
    throw new DictionaryError(
      `Failed to read git log: ${err instanceof Error ? err.message : String(err)}`,
      'GIT_ERROR'
    );
  }
}
