import { shell } from 'electron';
import { logger } from './logger';
import { isExternalUrlOpeningEnabledByRuntime, isLahSafeMode } from './runtime-flags';

export async function openExternalUrl(url: string): Promise<void> {
  if (!isExternalUrlOpeningEnabledByRuntime()) {
    logger.info(
      `[external-links] Blocked external URL open${isLahSafeMode() ? ' in LAH safe mode' : ''}: ${url}`,
    );
    return;
  }

  await shell.openExternal(url);
}
