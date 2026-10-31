import { expandPath } from '../utils/paths';
import { shell } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

function expandShellPath(input: string): string { return expandPath(input); }

function requirePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('path is required');
  }
  return path;
}

function requireUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('url is required');
  }
  return url;
}

export function createShellApi(): CompleteHostServiceRegistry['shell'] {
  return {
    openExternal: async (payload) => {
      await shell.openExternal(requireUrl(payload.url));
    },
    showItemInFolder: (payload) => {
      shell.showItemInFolder(expandShellPath(requirePath(payload.path)));
    },
    openPath: (payload) => shell.openPath(expandShellPath(requirePath(payload.path))),
  };
}
