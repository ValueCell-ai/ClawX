import { describe, expect, it } from 'vitest';
import { buildElectronProxyConfig, buildProxyEnv, normalizeProxyServer } from '@electron/utils/proxy';

describe('proxy helpers', () => {
  it('normalizes bare host:port values to http URLs', () => {
    expect(normalizeProxyServer('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });

  it('preserves explicit proxy schemes', () => {
    expect(normalizeProxyServer('socks5://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891');
  });

  it('builds a direct Electron config when proxy is disabled', () => {
    expect(buildElectronProxyConfig({
      proxyEnabled: false,
      proxyServer: '127.0.0.1:7890',
      proxyBypassRules: '<local>',
    })).toEqual({ mode: 'direct' });
  });

  it('builds a fixed_servers Electron config when proxy is enabled', () => {
    expect(buildElectronProxyConfig({
      proxyEnabled: true,
      proxyServer: '127.0.0.1:7890',
      proxyBypassRules: '<local>;localhost',
    })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<local>;localhost',
    });
  });

  it('builds upper and lower-case proxy env vars for the Gateway', () => {
    expect(buildProxyEnv({
      proxyEnabled: true,
      proxyServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost\n127.0.0.1',
    })).toEqual({
      HTTP_PROXY: 'socks5://127.0.0.1:7891',
      HTTPS_PROXY: 'socks5://127.0.0.1:7891',
      ALL_PROXY: 'socks5://127.0.0.1:7891',
      http_proxy: 'socks5://127.0.0.1:7891',
      https_proxy: 'socks5://127.0.0.1:7891',
      all_proxy: 'socks5://127.0.0.1:7891',
      NO_PROXY: '<local>,localhost,127.0.0.1',
      no_proxy: '<local>,localhost,127.0.0.1',
    });
  });
});
