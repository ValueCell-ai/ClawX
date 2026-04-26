import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { request } from 'https';
import path from 'path';
import { logger } from './logger';
import { getOpenClawConfigDir } from './paths';

const UV_PYTHON_INSTALL_MIRROR_URL = 'https://registry.npmmirror.com/-/binary/python-build-standalone/';
const UV_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/';

const UV_MIRROR_ENV: Record<string, string> = {
  UV_PYTHON_INSTALL_MIRROR: UV_PYTHON_INSTALL_MIRROR_URL,
  UV_INDEX_URL,
};

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

function buildClawXUvConfigToml(): string {
  return [
    '# This file is managed by ClawX.',
    '# It lets uv use ClawX-selected mirrors even when host exec filters UV_INDEX_URL.',
    `index-url = ${quoteTomlString(UV_INDEX_URL)}`,
    `python-install-mirror = ${quoteTomlString(UV_PYTHON_INSTALL_MIRROR_URL)}`,
    '',
  ].join('\n');
}

export function getClawXUvConfigFilePath(): string {
  return path.join(getOpenClawConfigDir(), 'clawx', 'uv.toml');
}

function ensureClawXUvConfigFile(): string | null {
  const filePath = getClawXUvConfigFilePath();
  const content = buildClawXUvConfigToml();

  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath) || readFileSync(filePath, 'utf-8') !== content) {
      writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o644 });
    }
    return filePath;
  } catch (err) {
    logger.warn('Failed to write ClawX uv config file:', err);
    return null;
  }
}

const GOOGLE_204_HOST = 'www.google.com';
const GOOGLE_204_PATH = '/generate_204';
const GOOGLE_204_TIMEOUT_MS = 2000;

let cachedOptimized: boolean | null = null;
let cachedPromise: Promise<boolean> | null = null;
let loggedOnce = false;

function getLocaleAndTimezone(): { locale: string; timezone: string } {
  const locale = app.getLocale?.() || '';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  return { locale, timezone };
}

function isRegionOptimized(locale: string, timezone: string): boolean {
  // Prefer timezone when available to reduce false positives from locale alone.
  if (timezone) return timezone === 'Asia/Shanghai';
  return locale === 'zh-CN';
}

function probeGoogle204(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    const req = request(
      {
        method: 'GET',
        hostname: GOOGLE_204_HOST,
        path: GOOGLE_204_PATH,
      },
      (res) => {
        const status = res.statusCode || 0;
        res.resume();
        finish(status >= 200 && status < 300);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('google_204_timeout'));
    });

    req.on('error', () => finish(false));
    req.end();
  });
}

async function computeOptimization(): Promise<boolean> {
  const { locale, timezone } = getLocaleAndTimezone();

  if (isRegionOptimized(locale, timezone)) {
    if (!loggedOnce) {
      logger.info(`Region optimization enabled via locale/timezone (locale=${locale || 'unknown'}, tz=${timezone || 'unknown'})`);
      loggedOnce = true;
    }
    return true;
  }

  const reachable = await probeGoogle204(GOOGLE_204_TIMEOUT_MS);
  const isOptimized = !reachable;

  if (!loggedOnce) {
    const reason = reachable ? 'google_204_reachable' : 'google_204_unreachable';
    logger.info(`Network optimization probe: ${reason} (locale=${locale || 'unknown'}, tz=${timezone || 'unknown'})`);
    loggedOnce = true;
  }

  return isOptimized;
}

export async function shouldOptimizeNetwork(): Promise<boolean> {
  if (cachedOptimized !== null) return cachedOptimized;
  if (cachedPromise) return cachedPromise;

  if (!app.isReady()) {
    await app.whenReady();
  }

  cachedPromise = computeOptimization()
    .then((result) => {
      cachedOptimized = result;
      return result;
    })
    .catch((err) => {
      logger.warn('Network optimization check failed, defaulting to enabled:', err);
      cachedOptimized = true;
      return true;
    })
    .finally(() => {
      cachedPromise = null;
    });

  return cachedPromise;
}

export async function getUvMirrorEnv(): Promise<Record<string, string>> {
  const isOptimized = await shouldOptimizeNetwork();
  if (!isOptimized) return {};

  const uvConfigFile = ensureClawXUvConfigFile();
  return uvConfigFile
    ? { ...UV_MIRROR_ENV, UV_CONFIG_FILE: uvConfigFile }
    : { ...UV_MIRROR_ENV };
}

export async function warmupNetworkOptimization(): Promise<void> {
  try {
    await shouldOptimizeNetwork();
  } catch {
    // Ignore warmup failures
  }
}
