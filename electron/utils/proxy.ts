/**
 * Proxy helpers shared by the Electron main process and Gateway launcher.
 */

export interface ProxySettings {
  proxyEnabled: boolean;
  proxyServer: string;
  proxyBypassRules: string;
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
 * Electron accepts scheme-less proxy rules in some cases, but the Gateway's
 * env vars are more reliable when they are full URLs.
 */
export function normalizeProxyServer(proxyServer: string): string {
  const value = trimValue(proxyServer);
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function buildElectronProxyConfig(settings: ProxySettings): ElectronProxyConfig {
  if (!settings.proxyEnabled) {
    return { mode: 'direct' };
  }

  const proxyRules = normalizeProxyServer(settings.proxyServer);
  if (!proxyRules) {
    return { mode: 'direct' };
  }

  const proxyBypassRules = trimValue(settings.proxyBypassRules);
  return {
    mode: 'fixed_servers',
    proxyRules,
    ...(proxyBypassRules ? { proxyBypassRules } : {}),
  };
}

export function buildProxyEnv(settings: ProxySettings): Record<string, string> {
  if (!settings.proxyEnabled) {
    return {
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      all_proxy: '',
      NO_PROXY: '',
      no_proxy: '',
    };
  }

  const proxyServer = normalizeProxyServer(settings.proxyServer);
  if (!proxyServer) {
    return {
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      all_proxy: '',
      NO_PROXY: '',
      no_proxy: '',
    };
  }

  const noProxy = trimValue(settings.proxyBypassRules)
    .split(/[,\n;]/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join(',');

  return {
    HTTP_PROXY: proxyServer,
    HTTPS_PROXY: proxyServer,
    ALL_PROXY: proxyServer,
    http_proxy: proxyServer,
    https_proxy: proxyServer,
    all_proxy: proxyServer,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}
