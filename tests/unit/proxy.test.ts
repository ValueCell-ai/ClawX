import { describe, expect, it } from 'vitest';
import {
  buildElectronProxyConfig,
  buildProxyEnv,
  normalizeProxyServer,
  resolveProxySettings,
} from '@electron/utils/proxy';

describe('proxy helpers', () => {
  it('normalizes bare host:port values to http URLs', () => {
    expect(normalizeProxyServer('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });

  it('preserves explicit proxy schemes', () => {
    expect(normalizeProxyServer('socks5://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891');
  });

  it('falls back to the base proxy server when advanced fields are empty', () => {
    expect(resolveProxySettings({
      proxyEnabled: true,
      proxyServer: '127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      allProxy: 'http://127.0.0.1:7890',
      bypassRules: '<local>',
    });
  });

  it('uses advanced overrides when provided', () => {
    expect(resolveProxySettings({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: 'http://127.0.0.1:7892',
      proxyAllServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7892',
      allProxy: 'socks5://127.0.0.1:7891',
      bypassRules: '',
    });
  });

  it('keeps blank advanced fields aligned with the base proxy server', () => {
    expect(resolveProxySettings({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: 'http://127.0.0.1:7892',
      proxyAllServer: '',
      proxyBypassRules: '',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7892',
      allProxy: 'http://127.0.0.1:7890',
      bypassRules: '',
    });
  });

  it('builds a direct Electron config when proxy is disabled', () => {
    expect(buildElectronProxyConfig({
      proxyEnabled: false,
      proxyServer: '127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    })).toEqual({ mode: 'direct' });
  });

  it('builds protocol-specific Electron rules when proxy is enabled', () => {
    expect(buildElectronProxyConfig({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: 'http://127.0.0.1:7892',
      proxyAllServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost',
    })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=http://127.0.0.1:7890;https=http://127.0.0.1:7892;socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost',
    });
  });

  it('builds upper and lower-case proxy env vars for the Gateway', () => {
    expect(buildProxyEnv({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost\n127.0.0.1',
    })).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      ALL_PROXY: 'socks5://127.0.0.1:7891',
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      all_proxy: 'socks5://127.0.0.1:7891',
      NO_PROXY: '<local>,localhost,127.0.0.1',
      no_proxy: '<local>,localhost,127.0.0.1',
    });
  });
});
