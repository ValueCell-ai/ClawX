/**
 * Dynamic imports for openclaw plugin-sdk subpath exports.
 *
 * openclaw is NOT in the asar's node_modules — it lives at resources/openclaw/
 * (extraResources).  Static `import ... from 'openclaw/plugin-sdk/...'` would
 * produce a runtime require() that fails inside the asar.
 *
 * Instead, we create a require context from the openclaw directory itself.
 * Node.js package self-referencing allows a package to require its own exports
 * by name, so `openclawRequire('openclaw/plugin-sdk/discord')` resolves via the
 * exports map in openclaw's package.json.
 *
 * In dev mode (pnpm), the resolved path is in the pnpm virtual store where
 * self-referencing also works.  The projectRequire fallback covers edge cases.
 */
import { createRequire } from 'module';
import { join } from 'node:path';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

const _openclawPath = getOpenClawDir();
const _openclawResolvedPath = getOpenClawResolvedDir();
const _openclawSdkRequire = createRequire(join(_openclawResolvedPath, 'package.json'));
const _projectSdkRequire = createRequire(join(_openclawPath, 'package.json'));

function requireOpenClawSdk(subpath: string): Record<string, unknown> {
  try {
    return _openclawSdkRequire(subpath);
  } catch {
    return _projectSdkRequire(subpath);
  }
}

// --- Channel SDK dynamic imports ---
const _discordSdk = requireOpenClawSdk('openclaw/plugin-sdk/discord') as {
  listDiscordDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listDiscordDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeDiscordMessagingTarget: (target: string) => string | undefined;
};

const _telegramSdk = requireOpenClawSdk('openclaw/plugin-sdk/telegram') as {
  listTelegramDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listTelegramDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeTelegramMessagingTarget: (target: string) => string | undefined;
};

const _slackSdk = requireOpenClawSdk('openclaw/plugin-sdk/slack') as {
  listSlackDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listSlackDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeSlackMessagingTarget: (target: string) => string | undefined;
};

const _whatsappSdk = requireOpenClawSdk('openclaw/plugin-sdk/whatsapp-shared') as {
  normalizeWhatsAppMessagingTarget: (target: string) => string | undefined;
};

export const {
  listDiscordDirectoryGroupsFromConfig,
  listDiscordDirectoryPeersFromConfig,
  normalizeDiscordMessagingTarget,
} = _discordSdk;

export const {
  listTelegramDirectoryGroupsFromConfig,
  listTelegramDirectoryPeersFromConfig,
  normalizeTelegramMessagingTarget,
} = _telegramSdk;

export const {
  listSlackDirectoryGroupsFromConfig,
  listSlackDirectoryPeersFromConfig,
  normalizeSlackMessagingTarget,
} = _slackSdk;

export const { normalizeWhatsAppMessagingTarget } = _whatsappSdk;
