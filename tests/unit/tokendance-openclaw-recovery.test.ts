import { readFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('TokenDance OpenClaw recovery bridge', () => {
  it('keeps the response-header bridge in the pinned OpenClaw patch', async () => {
    const patch = await readFile(path.join(root, 'patches/openclaw@2026.7.1-2.patch'), 'utf8');
    expect(patch).toContain('TokenDance-Recovery-Action');
    expect(patch).toContain('top_up_balance');
    expect(patch).toContain('reauthorize_api_key');
    expect(patch).toContain('api_key_quota');
  });

  it('adds only documented recovery actions to formatted runtime errors', async () => {
    const errorModule = await import(pathToFileURL(
      path.join(root, 'node_modules/openclaw/dist/errors-sMD712F3.js'),
    ).href) as {
      i: (error: unknown) => string;
    };

    const recoverable = Object.assign(new Error('402 Balance insufficient'), {
      headers: new Headers({ 'TokenDance-Recovery-Action': 'top_up_balance' }),
    });
    expect(errorModule.i(recoverable)).toContain('[TokenDance-Recovery-Action:top_up_balance]');

    const unknown = Object.assign(new Error('402 Provider error'), {
      headers: new Headers({ 'TokenDance-Recovery-Action': 'unknown_action' }),
    });
    expect(errorModule.i(unknown)).toBe('402 Provider error');
  });
});
