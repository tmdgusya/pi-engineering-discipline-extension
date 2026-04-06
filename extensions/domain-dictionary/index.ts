import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { registerDictCommands } from './commands.js';

export default function domainDictionaryExtension(pi: ExtensionAPI) {
  const cwd = process.cwd();
  registerDictCommands(pi, cwd);
  console.log('Domain Dictionary loaded: /dict, /dict-build');
}
