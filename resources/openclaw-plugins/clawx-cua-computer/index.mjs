import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createComputerTool } from './computer-tool.mjs';
import { createProxyManager } from './mcp-client.mjs';

const PLUGIN_ID = 'clawx-cua-computer';

export function createPluginEntry({ proxyManager = createProxyManager() } = {}) {
  return definePluginEntry({
    id: PLUGIN_ID,
    name: 'ClawX Computer',
    description: 'Local primary-desktop computer use managed by ClawX.',
    register(api) {
      api.registerTool(() => createComputerTool({ proxyManager }), { name: 'computer' });
      api.registerService({
        id: PLUGIN_ID,
        async start() {},
        async stop() {
          await proxyManager.dispose();
        },
      });
    },
  });
}

export const pluginEntry = createPluginEntry();
export default pluginEntry;
