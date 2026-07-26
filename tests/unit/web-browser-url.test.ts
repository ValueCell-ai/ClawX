import { describe, expect, it } from 'vitest';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
  canOpenWebBrowserExternally,
  normalizeWebBrowserTopLevelUrl,
  parseWebBrowserAddress,
  type WebBrowserAddressErrorCode,
} from '@shared/web-browser';

describe('web browser URL policy', () => {
  it('exports the fixed browser identity constants', () => {
    expect(WEB_BROWSER_PARTITION).toBe('persist:clawx-web-browser');
    expect(WEB_BROWSER_INITIAL_URL).toBe('about:blank');
    expect(WEB_BROWSER_USER_AGENT).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
      + 'AppleWebKit/537.36 (KHTML, like Gecko) '
      + 'Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36',
    );
  });

  it.each([
    ['example.com', 'https://example.com/'],
    ['  example.com  ', 'https://example.com/'],
    ['localhost:3000', 'https://localhost:3000/'],
    ['127.0.0.1:8080/status', 'https://127.0.0.1:8080/status'],
    ['192.168.1.20/dashboard', 'https://192.168.1.20/dashboard'],
    ['docs.example.com/path/to/page?mode=full', 'https://docs.example.com/path/to/page?mode=full'],
    ['HTTP://EXAMPLE.COM', 'http://example.com/'],
    ['https://example.com/a%20path?q=hello%20world', 'https://example.com/a%20path?q=hello%20world'],
    ['file:///tmp/example.html', 'file:///tmp/example.html'],
    ['file:///tmp/an%20example.html', 'file:///tmp/an%20example.html'],
    ['file:///C:/Users/Test/example.html', 'file:///C:/Users/Test/example.html'],
  ])('parses %s as %s', (input, url) => {
    expect(parseWebBrowserAddress(input)).toEqual({ ok: true, url });
  });

  it.each<[string, WebBrowserAddressErrorCode]>([
    ['', 'empty'],
    ['   ', 'empty'],
    ['/tmp/example.html', 'absolute-path'],
    ['C:\\tmp\\example.html', 'absolute-path'],
    ['C:/tmp/example.html', 'absolute-path'],
    ['\\\\server\\share\\example.html', 'absolute-path'],
    ['~/example.html', 'absolute-path'],
    ['~other/example.html', 'absolute-path'],
    ['file://server/share/example.html', 'invalid-url'],
    ['http://', 'invalid-url'],
    ['https://[::1', 'invalid-url'],
    ['about:blank', 'reserved-url'],
    ['chrome://settings', 'unsupported-protocol'],
    ['javascript:alert(1)', 'unsupported-protocol'],
    ['data:text/plain,hello', 'unsupported-protocol'],
    ['ftp://example.com/file', 'unsupported-protocol'],
    ['custom:value', 'unsupported-protocol'],
  ])('rejects %s with %s', (input, reason) => {
    expect(parseWebBrowserAddress(input)).toEqual({ ok: false, reason });
  });

  it.each([
    [' https://EXAMPLE.COM/path ', 'https://example.com/path'],
    ['http://localhost:3000/status', 'http://localhost:3000/status'],
    ['file:///tmp/an%20example.html', 'file:///tmp/an%20example.html'],
    ['file:///C:/Users/Test/example.html', 'file:///C:/Users/Test/example.html'],
    ['example.com', null],
    ['localhost:3000', null],
    ['/tmp/example.html', null],
    ['file://server/share/example.html', null],
    ['about:blank', null],
    ['javascript:alert(1)', null],
  ])('normalizes Main-facing URL %s without scheme completion', (input, expected) => {
    expect(normalizeWebBrowserTopLevelUrl(input)).toBe(expected);
  });

  it.each([
    ['https://example.com', true],
    ['http://localhost:3000', true],
    ['file:///tmp/example.html', true],
    ['file:///C:/Users/Test/example.html', true],
    ['example.com', false],
    ['file://server/share/example.html', false],
    ['about:blank', false],
    ['data:text/plain,hello', false],
  ])('reports external-open eligibility for %s as %s', (input, expected) => {
    expect(canOpenWebBrowserExternally(input)).toBe(expected);
  });
});
