import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getOpenClawCliCommand } from '../utils/openclaw-cli';
import { ensureDir, getOpenClawSkillsDir, getOpenClawStatus } from '../utils/paths';
import { readOpenClawConfigSnapshot } from '../gateway/config-delivery';
import { existsSync } from 'node:fs';

export function createOpenClawApi(): CompleteHostServiceRegistry['openclaw'] {
  return {
    status: () => getOpenClawStatus(),
    getSkillsDir: () => {
      const dir = getOpenClawSkillsDir();
      ensureDir(dir);
      return dir;
    },
    getCliCommand: () => {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    },
    getCompactionReserve: async () => {
      const { config } = await readOpenClawConfigSnapshot();
      const agents = config.agents as Record<string, unknown> | undefined;
      const defaults = agents?.defaults as Record<string, unknown> | undefined;
      const compaction = defaults?.compaction as Record<string, unknown> | undefined;
      const reserveTokensFloor = compaction?.reserveTokensFloor;
      return {
        reserveTokensFloor: typeof reserveTokensFloor === 'number' ? reserveTokensFloor : undefined,
      };
    },
  };
}
