import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeKind } from '@shared/types/gateway';
import { getCcConnectManagedDir } from '../runtime/cc-connect-paths';

type RuntimeStatusReader = {
  getStatus?: () => { runtimeKind?: RuntimeKind };
};

function getActiveRuntimeKind(runtimeManager?: RuntimeStatusReader | null): RuntimeKind {
  try {
    return runtimeManager?.getStatus?.().runtimeKind === 'cc-connect' ? 'cc-connect' : 'openclaw';
  } catch {
    return 'openclaw';
  }
}

export function getOpenClawMediaDir(): string {
  return join(homedir(), '.openclaw', 'media');
}

export function getCcConnectMediaDir(): string {
  return join(getCcConnectManagedDir(), 'media');
}

export function getRuntimeMediaDir(runtimeManager?: RuntimeStatusReader | null): string {
  return getActiveRuntimeKind(runtimeManager) === 'cc-connect'
    ? getCcConnectMediaDir()
    : getOpenClawMediaDir();
}

export function getRuntimeOutboundMediaDir(runtimeManager?: RuntimeStatusReader | null): string {
  return join(getRuntimeMediaDir(runtimeManager), 'outbound');
}

export function getRuntimeOutgoingMediaRecordDirs(runtimeManager?: RuntimeStatusReader | null): string[] {
  const active = getRuntimeMediaDir(runtimeManager);
  const ccConnect = getCcConnectMediaDir();
  const fallback = active === ccConnect ? getOpenClawMediaDir() : ccConnect;
  return [
    join(active, 'outgoing', 'records'),
    join(fallback, 'outgoing', 'records'),
  ];
}
