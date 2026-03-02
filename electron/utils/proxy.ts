/**
 * Proxy helpers shared by the Electron main process and Gateway launcher.
 */

export interface ProxySettings {
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
}

export interface ResolvedProxySettings {
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  bypassRules: string;
}

export interface ElectronProxyConfig {
  mode: 'direct' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

function trimValue(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Accept bare host:port values from users and normalize them to a valid URL.
 * Electron accepts scheme-less proxy rules in some cases, but child-process
 * env vars are more reliable when they are full URLs.
 */
export function normalizeProxyServer(proxyServer: string): string {
  const value = trimValue(proxyServer);
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function resolveProxySettings(settings: ProxySettings): ResolvedProxySettings {
  const legacyProxy = normalizeProxyServer(settings.proxyServer);
  const allProxy = normalizeProxyServer(settings.proxyAllServer);
  const httpProxy = normalizeProxyServer(settings.proxyHttpServer) || legacyProxy || allProxy;
  const httpsProxy = normalizeProxyServer(settings.proxyHttpsServer) || legacyProxy || allProxy;

  return {
    httpProxy,
    httpsProxy,
    allProxy: allProxy || legacyProxy,
    bypassRules: trimValue(settings.proxyBypassRules),
  };
}

export function buildElectronProxyConfig(settings: ProxySettings): ElectronProxyConfig {
  if (!settings.proxyEnabled) {
    return { mode: 'direct' };
  }

  const resolved = resolveProxySettings(settings);
  const rules: string[] = [];

  if (resolved.httpProxy) {
    rules.push(`http=${resolved.httpProxy}`);
  }
  if (resolved.httpsProxy) {
    rules.push(`https=${resolved.httpsProxy}`);
  }

  // Fallback rule for protocols like ws/wss or when users only configured ALL_PROXY.
  const fallbackProxy = resolved.allProxy || resolved.httpsProxy || resolved.httpProxy;
  if (fallbackProxy) {
    rules.push(fallbackProxy);
  }

  if (rules.length === 0) {
    return { mode: 'direct' };
  }

  return {
    mode: 'fixed_servers',
    proxyRules: rules.join(';'),
    ...(resolved.bypassRules ? { proxyBypassRules: resolved.bypassRules } : {}),
  };
}

export function buildProxyEnv(settings: ProxySettings): Record<string, string> {
  const blank = {
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_PROXY: '',
    no_proxy: '',
  };

  if (!settings.proxyEnabled) {
    return blank;
  }

  const resolved = resolveProxySettings(settings);
  const noProxy = resolved.bypassRules
    .split(/[,\n;]/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join(',');

  return {
    HTTP_PROXY: resolved.httpProxy,
    HTTPS_PROXY: resolved.httpsProxy,
    ALL_PROXY: resolved.allProxy,
    http_proxy: resolved.httpProxy,
    https_proxy: resolved.httpsProxy,
    all_proxy: resolved.allProxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}
