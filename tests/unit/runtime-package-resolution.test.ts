// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolveModulePathWithFallbacks } from '@electron/utils/runtime-package-resolution';

describe('runtime package resolution', () => {
  it('returns the first successful resolver result', () => {
    const openclawResolve = vi.fn(() => {
      throw new Error('missing from openclaw');
    });
    const appResolve = vi.fn(() => '/tmp/app/node_modules/qrcode-terminal/vendor/QRCode/index.js');

    const resolved = resolveModulePathWithFallbacks('qrcode-terminal/vendor/QRCode/index.js', [
      { label: 'openclaw', resolve: openclawResolve },
      { label: 'app', resolve: appResolve },
    ]);

    expect(resolved).toBe('/tmp/app/node_modules/qrcode-terminal/vendor/QRCode/index.js');
    expect(openclawResolve).toHaveBeenCalledOnce();
    expect(appResolve).toHaveBeenCalledOnce();
  });

  it('surfaces all resolver failures in the final error', () => {
    expect(() => resolveModulePathWithFallbacks('qrcode-terminal/vendor/QRCode/index.js', [
      { label: 'openclaw', resolve: () => { throw new Error('not bundled'); } },
      { label: 'app', resolve: () => { throw new Error('not packaged'); } },
    ])).toThrow(
      'openclaw: not bundled | app: not packaged',
    );
  });
});
