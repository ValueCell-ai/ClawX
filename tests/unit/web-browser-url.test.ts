import { describe, expect, it } from 'vitest';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
  normalizeWebBrowserHtmlFileUrl,
} from '@shared/web-browser';

describe('local HTML preview URL policy', () => {
  it('exports the fixed isolated guest identity', () => {
    expect(WEB_BROWSER_PARTITION).toBe('persist:clawx-web-browser');
    expect(WEB_BROWSER_INITIAL_URL).toBe('about:blank');
    expect(WEB_BROWSER_USER_AGENT).toContain('Electron/40.8.4');
  });

  it.each([
    ['file:///tmp/example.html', 'file:///tmp/example.html'],
    [' file:///tmp/site%20one.HTM ', 'file:///tmp/site%20one.HTM'],
    ['file:///C:/Users/Test/example.html', 'file:///C:/Users/Test/example.html'],
  ])('accepts local HTML URL %s', (input, expected) => {
    expect(normalizeWebBrowserHtmlFileUrl(input)).toBe(expected);
  });

  it.each([
    '',
    'https://example.com/',
    'file:///tmp/example.txt',
    'file://server/share/example.html',
    'file:///tmp/example.html?query=1',
    'file:///tmp/example.html#section',
    '/tmp/example.html',
    'about:blank',
    'javascript:alert(1)',
  ])('rejects non-local-HTML URL %s', (input) => {
    expect(normalizeWebBrowserHtmlFileUrl(input)).toBeNull();
  });
});
