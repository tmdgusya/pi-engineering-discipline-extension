import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { registerDictCommands } from './commands.js';

/**
 * Domain Dictionary Extension - Experimental Feature
 * 
 * To enable: Set environment variable PI_ENABLE_DOMAIN_DICT=1
 * 
 * Example:
 *   PI_ENABLE_DOMAIN_DICT=1 pi
 * 
 * Or add to ~/.bashrc, ~/.zshrc:
 *   export PI_ENABLE_DOMAIN_DICT=1
 */
export default function domainDictionaryExtension(pi: ExtensionAPI) {
  // Experimental feature flag check
  const isEnabled = process.env.PI_ENABLE_DOMAIN_DICT === '1' || 
                    process.env.PI_ENABLE_DOMAIN_DICT === 'true';
  
  if (!isEnabled) {
    // Silently skip if not enabled (experimental feature)
    return;
  }

  const cwd = process.cwd();
  registerDictCommands(pi, cwd);
}
