/**
 * A single domain entry in the dictionary.
 * One line in the JSONL file.
 */
export interface DomainEntry {
  /** Domain name extracted from commit scopes, e.g., "session-loop" */
  domain: string;
  /** Files associated with this domain, with change frequency */
  files: DomainFile[];
  /** Total number of commits that reference this domain */
  commitCount: number;
  /** ISO timestamp of last build */
  updatedAt: string;
}

export interface DomainFile {
  /** Relative file path from project root */
  path: string;
  /** Number of commits that changed this file under this domain */
  changeCount: number;
}

/**
 * Raw parsed commit from git log.
 */
export interface ParsedCommit {
  hash: string;
  /** Conventional commit type: feat, fix, docs, etc. */
  type: string | null;
  /** Scope in parentheses: (session-loop), (ci), etc. */
  scope: string | null;
  /** Commit subject line */
  subject: string;
  /** Files changed in this commit */
  files: string[];
}

/**
 * Query result returned to the user.
 */
export interface DictQueryResult {
  domain: string;
  files: DomainFile[];
  commitCount: number;
}

export class DictError extends Error {
  constructor(
    message: string,
    public code: 'BUILD_FAILED' | 'NOT_FOUND' | 'NO_DICTIONARY' | 'GIT_ERROR'
  ) {
    super(message);
    this.name = 'DictError';
  }
}
