import { app } from 'electron';
import { logger } from './logger';
import { proxyAwareFetch } from './proxy-fetch';

const UV_MIRROR_ENV: Record<string, string> = {
  UV_PYTHON_INSTALL_MIRROR: 'https://registry.npmmirror.com/-/binary/python-build-standalone/',
  UV_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
};

const GOOGLE_204_URL = 'https://www.google.com/generate_204';
const MANAGED_PYTHON_MIRROR_URL = 'https://registry.npmmirror.com/-/binary/python-build-standalone/';
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

async function probeUrlReachable(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('reachability_timeout'));
  }, timeoutMs);

  try {
    const response = await proxyAwareFetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function probeGoogle204(timeoutMs: number): Promise<boolean> {
  return probeUrlReachable(GOOGLE_204_URL, timeoutMs);
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
  return isOptimized ? { ...UV_MIRROR_ENV } : {};
}

export async function canReachManagedPythonDownloadSource(): Promise<boolean> {
  const isOptimized = await shouldOptimizeNetwork();
  const probeUrl = isOptimized ? MANAGED_PYTHON_MIRROR_URL : GOOGLE_204_URL;
  return await probeUrlReachable(probeUrl, GOOGLE_204_TIMEOUT_MS);
}

export async function warmupNetworkOptimization(): Promise<void> {
  try {
    await shouldOptimizeNetwork();
  } catch {
    // Ignore warmup failures
  }
}
