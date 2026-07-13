import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getClawXDataLayout, resolveClawXDataRoot } from '../utils/clawx-data-layout';

function binaryName(): string {
  return process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect';
}

export function getCcConnectManagedDir(): string {
  return getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData'))).ccConnectRuntimeDir;
}

export function getCcConnectConfigPath(): string {
  return join(getCcConnectManagedDir(), 'config.toml');
}

export function getCcConnectCodexHomeDir(): string {
  return join(getCcConnectManagedDir(), 'codex-home');
}

export function getCcConnectAccountCodexHomeDir(accountId: string): string {
  const normalized = accountId.trim() || 'default';
  const safeAccountId = encodeURIComponent(normalized).replace(/%/g, '_');
  const layout = getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData')));
  return join(layout.credentialsDir, 'oauth', safeAccountId, 'codex-home');
}

export function getCcConnectWorkspacesDir(): string {
  return getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData'))).agentWorkspacesDir;
}

export function getCcConnectAgentWorkspaceDir(agentId = 'main'): string {
  const safeAgentId = agentId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'main';
  return join(getCcConnectWorkspacesDir(), safeAgentId);
}

export function getCcConnectProviderProfilePath(): string {
  return join(getCcConnectManagedDir(), 'provider-profile.json');
}

export function getCcConnectBinaryPath(): string {
  if (!app.isPackaged && process.env.CLAWX_CC_CONNECT_PATH) {
    return process.env.CLAWX_CC_CONNECT_PATH;
  }
  if (app.isPackaged) {
    return join(process.resourcesPath, 'cc-connect', binaryName());
  }
  const bundledDevBinary = join(process.cwd(), 'build', 'cc-connect', `${process.platform}-${process.arch}`, binaryName());
  if (existsSync(bundledDevBinary)) {
    return bundledDevBinary;
  }
  return bundledDevBinary;
}

export function assertCcConnectBinaryPath(candidate = getCcConnectBinaryPath()): string {
  if (!existsSync(candidate)) {
    throw new Error(
      `cc-connect binary not found at ${candidate}. Run pnpm run bundle:cc-connect:current before selecting cc-connect runtime.`,
    );
  }
  return candidate;
}
