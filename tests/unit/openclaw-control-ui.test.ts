import { describe, expect, it } from 'vitest';

import { buildOpenClawControlUiUrl } from '@electron/utils/openclaw-control-ui';

describe('buildOpenClawControlUiUrl', () => {
  it('uses the URL fragment for one-time token bootstrap', () => {
    expect(buildOpenClawControlUiUrl(18789, 'clawx-test-token')).toBe(
      'http://127.0.0.1:18789/#token=clawx-test-token',
    );
  });

  it('omits the fragment when the token is blank', () => {
    expect(buildOpenClawControlUiUrl(18789, '   ')).toBe('http://127.0.0.1:18789/');
  });

  it('opens the Dreams view without moving the token out of the fragment', () => {
    expect(buildOpenClawControlUiUrl(18789, 'clawx-test-token', { view: 'dreams' })).toBe(
      'http://127.0.0.1:18789/dreaming#token=clawx-test-token',
    );
  });

  it('opens the Dreams view without a fragment when the token is blank', () => {
    expect(buildOpenClawControlUiUrl(18789, '   ', { view: 'dreams' })).toBe(
      'http://127.0.0.1:18789/dreaming',
    );
  });
});
