/**
 * Shared OpenClaw Plugin Install Utilities
 *
 * Provides version-aware install/upgrade logic for bundled OpenClaw plugins
 * (DingTalk, WeCom, QQBot, Feishu).  Used both at app startup (to auto-upgrade
 * stale plugins) and when a user configures a channel.
 */
import { app } from 'electron';
import { existsSync, cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger';

// ── Version helper ───────────────────────────────────────────────────────────

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(pkgJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

// ── Core install / upgrade logic ─────────────────────────────────────────────

export function ensurePluginInstalled(
  pluginDirName: string,
  candidateSources: string[],
  pluginLabel: string,
): { installed: boolean; warning?: string } {
  const targetDir = join(homedir(), '.openclaw', 'extensions', pluginDirName);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const targetPkgJson = join(targetDir, 'package.json');

  const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));

  // If already installed, check whether an upgrade is available
  if (existsSync(targetManifest)) {
    if (!sourceDir) return { installed: true }; // no bundled source to compare, keep existing
    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) {
      return { installed: true }; // same version or unable to compare
    }
    // Version differs — fall through to overwrite install
    logger.info(
      `[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion}`,
    );
  }

  // Fresh install or upgrade
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled ${pluginLabel} plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!existsSync(join(targetDir, 'openclaw.plugin.json'))) {
      return { installed: false, warning: `Failed to install ${pluginLabel} plugin mirror (manifest missing).` };
    }
    logger.info(`Installed ${pluginLabel} plugin from bundled mirror: ${sourceDir}`);
    return { installed: true };
  } catch {
    return { installed: false, warning: `Failed to install bundled ${pluginLabel} plugin mirror` };
  }
}

// ── Candidate source path builder ────────────────────────────────────────────

export function buildCandidateSources(pluginDirName: string): string[] {
  return app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginDirName),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName),
      join(__dirname, '../../build/openclaw-plugins', pluginDirName),
    ];
}

// ── Per-channel plugin helpers ───────────────────────────────────────────────

export function ensureDingTalkPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('dingtalk', buildCandidateSources('dingtalk'), 'DingTalk');
}

export function ensureWeComPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('wecom', buildCandidateSources('wecom'), 'WeCom');
}

export function ensureFeishuPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'feishu-openclaw-plugin',
    buildCandidateSources('feishu-openclaw-plugin'),
    'Feishu',
  );
}

export function ensureQQBotPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('qqbot', buildCandidateSources('qqbot'), 'QQ Bot');
}

// ── Bulk startup installer ───────────────────────────────────────────────────

/**
 * All bundled plugins, in the same order as after-pack.cjs BUNDLED_PLUGINS.
 */
const ALL_BUNDLED_PLUGINS = [
  { fn: ensureDingTalkPluginInstalled, label: 'DingTalk' },
  { fn: ensureWeComPluginInstalled, label: 'WeCom' },
  { fn: ensureQQBotPluginInstalled, label: 'QQ Bot' },
  { fn: ensureFeishuPluginInstalled, label: 'Feishu' },
] as const;

/**
 * Ensure all bundled OpenClaw plugins are installed/upgraded in
 * `~/.openclaw/extensions/`.  Designed to be called once at app startup
 * as a fire-and-forget task — errors are logged but never thrown.
 */
export async function ensureAllBundledPluginsInstalled(): Promise<void> {
  for (const { fn, label } of ALL_BUNDLED_PLUGINS) {
    try {
      const result = fn();
      if (result.warning) {
        logger.warn(`[plugin] ${label}: ${result.warning}`);
      }
    } catch (error) {
      logger.warn(`[plugin] Failed to install/upgrade ${label} plugin:`, error);
    }
  }
}
