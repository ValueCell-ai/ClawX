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
 *
 * openclaw 2026.4.5 removed the per-channel plugin-sdk subpath exports
 * (discord, telegram-surface, slack, whatsapp-shared).  The functions now live
 * in the extension bundles (dist/extensions/<channel>/api.js) which pull in
 * heavy optional dependencies (grammy, @buape/carbon, @slack/web-api …).
 *
 * Since ClawX only uses the lightweight normalize / directory helpers, we load
 * these from the extension API files directly.  If the optional dependency is
 * missing (common in dev without full install), we fall back to no-op stubs so
 * the app can still start — the target picker will simply be empty for that
 * channel.
 */
import { createRequire } from 'module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

const _openclawResolvedPath = getOpenClawResolvedDir();
const _openclawPath = getOpenClawDir();
const _openclawSdkRequire = createRequire(join(_openclawResolvedPath, 'package.json'));
const _projectSdkRequire = createRequire(join(_openclawPath, 'package.json'));
// App-root require covers dev installs where channel plugins are top-level
// dependencies. Packaged builds read the afterPack mirror instead.
const _appSdkRequire = createRequire(join(app.getAppPath(), 'package.json'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireOpenClawSdk(subpath: string): Record<string, unknown> {
  try {
    return _openclawSdkRequire(subpath);
  } catch {
    return _projectSdkRequire(subpath);
  }
}

/**
 * Load an openclaw extension API module by relative path under the openclaw
 * dist directory.  Falls back to no-op stubs when the optional dependency
 * tree is incomplete.
 */
function requireExtensionApi(relativePath: string): Record<string, unknown> | null {
  try {
    // Require relative to the openclaw dist directory.
    return _openclawSdkRequire(relativePath);
  } catch {
    try {
      return _projectSdkRequire(relativePath);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Generic no-op stubs used when channel SDK is unavailable.
// ---------------------------------------------------------------------------

const noopAsyncList = async (..._args: unknown[]): Promise<unknown[]> => [];
const noopNormalize = (_target: string): string | undefined => undefined;

// ---------------------------------------------------------------------------
// Legacy plugin-sdk subpath imports (openclaw <2026.4.5)
// ---------------------------------------------------------------------------

function tryLegacySdkImport(subpath: string): Record<string, unknown> | null {
  try {
    return requireOpenClawSdk(subpath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channel SDK loaders — try legacy plugin-sdk first, then extension api, then stubs
// ---------------------------------------------------------------------------

type ChannelSdk<T> = T;

interface DiscordSdk {
  listDiscordDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listDiscordDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeDiscordMessagingTarget: (target: string) => string | undefined;
}

interface TelegramSdk {
  listTelegramDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listTelegramDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeTelegramMessagingTarget: (target: string) => string | undefined;
}

interface SlackSdk {
  listSlackDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listSlackDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeSlackMessagingTarget: (target: string) => string | undefined;
}

interface WhatsappSdk {
  normalizeWhatsAppMessagingTarget: (target: string) => string | undefined;
}

type ChannelSdkLocations = {
  /** Bundled extension API path inside the OpenClaw package. */
  extensionRelPath: string;
  /** afterPack plugin-mirror directory name (resources/openclaw-plugins/<dir>). */
  pluginDirName?: string;
  /** npm package that ships the same API surface (dev/top-level dependency). */
  packageName?: string;
};

function tryRequireModule(loader: () => Record<string, unknown>): Record<string, unknown> | null {
  try {
    return loader();
  } catch {
    return null;
  }
}

function listChannelApiCandidates(locations: ChannelSdkLocations): Array<() => Record<string, unknown>> {
  const candidates: Array<() => Record<string, unknown>> = [
    () => requireExtensionApi(locations.extensionRelPath) as Record<string, unknown>,
  ];
  const pluginDirName = locations.pluginDirName;
  if (pluginDirName) {
    // Packaged mirror written by scripts/after-pack.cjs.
    const packagedRoots: string[] = [];
    if (typeof process.resourcesPath === 'string') {
      const packagedApi = join(process.resourcesPath, 'openclaw-plugins', pluginDirName, 'dist', 'api.js');
      if (existsSync(packagedApi)) packagedRoots.push(packagedApi);
    }
    const userExtensionApi = join(homedir(), '.openclaw', 'extensions', pluginDirName, 'dist', 'api.js');
    if (existsSync(userExtensionApi)) packagedRoots.push(userExtensionApi);
    for (const candidate of packagedRoots) {
      candidates.push(() => _openclawSdkRequire(candidate) as Record<string, unknown>);
    }
  }
  const packageName = locations.packageName;
  if (packageName) {
    // Dev installs and asar node_modules both expose <pkg>/dist/api.js.
    candidates.push(() => _appSdkRequire(`${packageName}/dist/api.js`) as Record<string, unknown>);
    candidates.push(() => _openclawSdkRequire(`${packageName}/dist/api.js`) as Record<string, unknown>);
  }
  return candidates;
}

function loadChannelSdk<T>(
  legacySubpath: string,
  locations: ChannelSdkLocations,
  fallback: T,
  keys: (keyof T)[],
): ChannelSdk<T> {
  // 1. Try legacy plugin-sdk subpath (openclaw <4.5 / removed in 2026.10)
  const legacy = tryLegacySdkImport(legacySubpath);
  if (legacy && keys.every((k) => typeof legacy[k as string] === 'function')) {
    return legacy as unknown as T;
  }

  // 2. Bundled extension API, packaged plugin mirror, or channel npm package.
  for (const candidate of listChannelApiCandidates(locations)) {
    const ext = tryRequireModule(candidate);
    if (ext && keys.every((k) => typeof ext[k as string] === 'function')) {
      return ext as unknown as T;
    }
  }

  // 3. Fallback to no-op stubs
  return fallback;
}

const _discordSdk = loadChannelSdk<DiscordSdk>(
  'openclaw/plugin-sdk/discord',
  {
    extensionRelPath: './dist/extensions/discord/api.js',
    pluginDirName: 'discord',
    packageName: '@openclaw/discord',
  },
  {
    listDiscordDirectoryGroupsFromConfig: noopAsyncList,
    listDiscordDirectoryPeersFromConfig: noopAsyncList,
    normalizeDiscordMessagingTarget: noopNormalize,
  },
  ['listDiscordDirectoryGroupsFromConfig', 'listDiscordDirectoryPeersFromConfig', 'normalizeDiscordMessagingTarget'],
);

const _telegramSdk = loadChannelSdk<TelegramSdk>(
  'openclaw/plugin-sdk/telegram-surface',
  {
    extensionRelPath: './dist/extensions/telegram/api.js',
    pluginDirName: 'telegram',
  },
  {
    listTelegramDirectoryGroupsFromConfig: noopAsyncList,
    listTelegramDirectoryPeersFromConfig: noopAsyncList,
    normalizeTelegramMessagingTarget: noopNormalize,
  },
  ['listTelegramDirectoryGroupsFromConfig', 'listTelegramDirectoryPeersFromConfig', 'normalizeTelegramMessagingTarget'],
);

const _slackSdk = loadChannelSdk<SlackSdk>(
  'openclaw/plugin-sdk/slack',
  {
    extensionRelPath: './dist/extensions/slack/api.js',
    pluginDirName: 'slack',
  },
  {
    listSlackDirectoryGroupsFromConfig: noopAsyncList,
    listSlackDirectoryPeersFromConfig: noopAsyncList,
    normalizeSlackMessagingTarget: noopNormalize,
  },
  ['listSlackDirectoryGroupsFromConfig', 'listSlackDirectoryPeersFromConfig', 'normalizeSlackMessagingTarget'],
);

const _whatsappSdk = loadChannelSdk<WhatsappSdk>(
  'openclaw/plugin-sdk/whatsapp-shared',
  {
    extensionRelPath: './dist/extensions/whatsapp/api.js',
    pluginDirName: 'whatsapp',
    packageName: '@openclaw/whatsapp',
  },
  {
    normalizeWhatsAppMessagingTarget: noopNormalize,
  },
  ['normalizeWhatsAppMessagingTarget'],
);

// ---------------------------------------------------------------------------
// Public re-exports — identical API surface as before.
// ---------------------------------------------------------------------------

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
