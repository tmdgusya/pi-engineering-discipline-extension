import { describe, it, expect } from 'vitest';
import { parseCommitLine, parseGitLog, extractDomainsFromCommits } from '../git-parser.js';
import type { ParsedCommit } from '../types.js';

describe('parseCommitLine', () => {
  it('parses conventional commit with scope', () => {
    const result = parseCommitLine('abc1234|feat(session-loop): implement scheduler');
    expect(result).toEqual({
      hash: 'abc1234',
      type: 'feat',
      scope: 'session-loop',
      subject: 'feat(session-loop): implement scheduler',
      files: [],
    });
  });

  it('parses conventional commit without scope', () => {
    const result = parseCommitLine('abc1234|fix: correct typo');
    expect(result).toEqual({
      hash: 'abc1234',
      type: 'fix',
      scope: null,
      subject: 'fix: correct typo',
      files: [],
    });
  });

  it('parses non-conventional commit', () => {
    const result = parseCommitLine('abc1234|initial commit');
    expect(result).toEqual({
      hash: 'abc1234',
      type: null,
      scope: null,
      subject: 'initial commit',
      files: [],
    });
  });

  it('handles merge commits', () => {
    const result = parseCommitLine('abc1234|Merge pull request #4 from tmdgusya/feature/session-loop');
    expect(result).toEqual({
      hash: 'abc1234',
      type: null,
      scope: null,
      subject: 'Merge pull request #4 from tmdgusya/feature/session-loop',
      files: [],
    });
  });

  it('extracts scope with hyphens and dots', () => {
    const result = parseCommitLine('abc1234|feat(api-v2.1): add endpoint');
    expect(result!.scope).toBe('api-v2.1');
  });

  it('extracts scope with Korean characters', () => {
    const result = parseCommitLine('abc1234|feat(인증): 로그인 구현');
    expect(result!.scope).toBe('인증');
  });
});

describe('parseGitLog', () => {
  it('parses multi-line git log output with file lists', () => {
    const raw = `abc1234|feat(auth): add login
src/auth/login.ts
src/auth/types.ts

def5678|fix(auth): handle edge case
src/auth/login.ts

ghi9012|docs: update readme
README.md`;

    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(3);
    expect(commits[0].hash).toBe('abc1234');
    expect(commits[0].files).toEqual(['src/auth/login.ts', 'src/auth/types.ts']);
    expect(commits[1].files).toEqual(['src/auth/login.ts']);
    expect(commits[2].files).toEqual(['README.md']);
  });

  it('returns empty array for empty input', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  it('handles commits with no file changes', () => {
    const raw = `abc1234|feat(auth): initial`;
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toEqual([]);
  });
});

describe('extractDomainsFromCommits', () => {
  it('groups files by domain scope', () => {
    const commits: ParsedCommit[] = [
      { hash: 'a', type: 'feat', scope: 'auth', subject: 'feat(auth): login', files: ['src/auth/login.ts', 'src/auth/types.ts'] },
      { hash: 'b', type: 'fix', scope: 'auth', subject: 'fix(auth): edge case', files: ['src/auth/login.ts'] },
      { hash: 'c', type: 'feat', scope: 'push', subject: 'feat(push): notify', files: ['src/push/service.py'] },
    ];

    const domains = extractDomainsFromCommits(commits);
    expect(domains.size).toBe(2);

    const auth = domains.get('auth')!;
    expect(auth.commitCount).toBe(2);
    expect(auth.files).toHaveLength(2);
    expect(auth.files.find(f => f.path === 'src/auth/login.ts')!.changeCount).toBe(2);
    expect(auth.files.find(f => f.path === 'src/auth/types.ts')!.changeCount).toBe(1);

    const push = domains.get('push')!;
    expect(push.commitCount).toBe(1);
    expect(push.files).toHaveLength(1);
  });

  it('skips commits without scope', () => {
    const commits: ParsedCommit[] = [
      { hash: 'a', type: 'fix', scope: null, subject: 'fix: typo', files: ['README.md'] },
    ];
    const domains = extractDomainsFromCommits(commits);
    expect(domains.size).toBe(0);
  });

  it('normalizes domain names to lowercase', () => {
    const commits: ParsedCommit[] = [
      { hash: 'a', type: 'feat', scope: 'Auth', subject: 'feat(Auth): login', files: ['src/auth.go'] },
      { hash: 'b', type: 'fix', scope: 'auth', subject: 'fix(auth): fix', files: ['src/auth.go'] },
    ];
    const domains = extractDomainsFromCommits(commits);
    expect(domains.size).toBe(1);
    expect(domains.has('auth')).toBe(true);
    expect(domains.get('auth')!.commitCount).toBe(2);
  });

  it('sorts files by change count descending', () => {
    const commits: ParsedCommit[] = [
      { hash: 'a', type: 'feat', scope: 'api', subject: '', files: ['a.rs', 'b.rs'] },
      { hash: 'b', type: 'fix', scope: 'api', subject: '', files: ['a.rs'] },
      { hash: 'c', type: 'fix', scope: 'api', subject: '', files: ['a.rs', 'c.rs'] },
    ];
    const domains = extractDomainsFromCommits(commits);
    const api = domains.get('api')!;
    expect(api.files[0].path).toBe('a.rs');
    expect(api.files[0].changeCount).toBe(3);
  });
});
