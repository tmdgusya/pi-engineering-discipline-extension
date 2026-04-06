import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Dictionary, buildDictionary } from './dictionary.js';
import type { QueryResult } from './types.js';

function formatResults(results: QueryResult[]): string {
  if (results.length === 0) return 'No matching domains found.';

  const lines: string[] = [];

  for (const r of results) {
    lines.push(`\n📦 ${r.domain} (${r.commitCount} commits)`);
    lines.push('  Files:');
    for (const f of r.files.slice(0, 10)) {
      lines.push(`    ${f.path} (${f.changeCount} changes)`);
    }
    if (r.files.length > 10) {
      lines.push(`    ... and ${r.files.length - 10} more`);
    }
  }

  return lines.join('\n');
}

export function registerDictCommands(pi: ExtensionAPI, cwd: string): void {
  const dictPath = Dictionary.defaultPath(cwd);

  pi.registerCommand('dict', {
    description: 'Search the domain dictionary. Usage: /dict <query>',
    getArgumentCompletions: (prefix: string) => {
      const dict = new Dictionary(dictPath);
      if (!dict.exists()) return null;

      const entries = dict.load();
      const filtered = entries
        .filter(e => e.domain.startsWith(prefix.toLowerCase()))
        .map(e => ({
          value: e.domain,
          label: e.domain,
          description: `${e.commitCount} commits, ${e.files.length} files`,
        }));

      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const query = args.trim();

      if (!query) {
        const dict = new Dictionary(dictPath);
        if (!dict.exists()) {
          ctx.ui.notify('Dictionary not built yet. Run /dict-build first.', 'warning');
          return;
        }
        const entries = dict.load();
        const summary = entries
          .map(e => `  ${e.domain} — ${e.commitCount} commits, ${e.files.length} files`)
          .join('\n');
        console.log(`\nDomain Dictionary (${entries.length} domains):\n${summary}\n`);
        return;
      }

      const dict = new Dictionary(dictPath);
      if (!dict.exists()) {
        ctx.ui.notify('Dictionary not built yet. Run /dict-build first.', 'warning');
        return;
      }

      const results = dict.search(query);
      console.log(formatResults(results));
    },
  });

  pi.registerCommand('dict-build', {
    description: 'Build/rebuild the domain dictionary from git history',
    handler: async (_args, ctx) => {
      ctx.ui.notify('Building domain dictionary...', 'info');

      try {
        const entries = buildDictionary(cwd);
        const dict = new Dictionary(dictPath);
        dict.save(entries);

        ctx.ui.notify(
          `Dictionary built: ${entries.length} domains, ${entries.reduce((s, e) => s + e.files.length, 0)} files`,
          'info'
        );

        const summary = entries
          .slice(0, 5)
          .map(e => `  ${e.domain} — ${e.commitCount} commits, ${e.files.length} files`)
          .join('\n');
        console.log(`\nTop domains:\n${summary}`);
        if (entries.length > 5) {
          console.log(`  ... and ${entries.length - 5} more. Use /dict to browse.\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Build failed: ${msg}`, 'error');
      }
    },
  });
}
