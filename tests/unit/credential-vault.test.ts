import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteVaultSecret,
  getChannelVaultSecrets,
  getVaultSecret,
  replaceChannelVaultSecrets,
  setVaultSecret,
  type CredentialCipher,
} from '@electron/services/secrets/credential-vault';

const cipher: CredentialCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0x5a),
  decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString('utf8'),
};

let root: string;
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.CLAWX_DATA_HOME;
  root = await mkdtemp(join(tmpdir(), 'clawx-credential-vault-'));
  process.env.CLAWX_DATA_HOME = root;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.CLAWX_DATA_HOME;
  else process.env.CLAWX_DATA_HOME = previousDataHome;
  await rm(root, { recursive: true, force: true });
});

describe('credential vault', () => {
  it('persists provider secrets encrypted and exposes only account IDs in the index', async () => {
    await setVaultSecret({
      type: 'api_key',
      accountId: 'openai-primary',
      apiKey: 'synthetic-api-key-must-not-be-plaintext',
    }, cipher);

    await expect(getVaultSecret('openai-primary', cipher)).resolves.toEqual({
      type: 'api_key',
      accountId: 'openai-primary',
      apiKey: 'synthetic-api-key-must-not-be-plaintext',
    });
    const encrypted = await readFile(join(root, 'credentials', 'secrets.enc'));
    expect(encrypted.toString('utf8')).not.toContain('synthetic-api-key-must-not-be-plaintext');
    const index = await readFile(join(root, 'credentials', 'index.json'), 'utf8');
    expect(index).toContain('openai-primary');
    expect(index).not.toContain('synthetic-api-key');
  });

  it('removes vault files after the final account is deleted', async () => {
    await setVaultSecret({
      type: 'oauth',
      accountId: 'oauth-account',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
    }, cipher);
    await deleteVaultSecret('oauth-account', cipher);

    await expect(readFile(join(root, 'credentials', 'secrets.enc'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(getVaultSecret('oauth-account', cipher)).resolves.toBeNull();
  });

  it('persists account-scoped channel credentials without exposing values in the index', async () => {
    await replaceChannelVaultSecrets({
      'feishu:ops': {
        appSecret: 'feishu-secret-must-not-be-plaintext',
      },
    }, cipher);

    await expect(getChannelVaultSecrets(cipher)).resolves.toEqual({
      'feishu:ops': {
        appSecret: 'feishu-secret-must-not-be-plaintext',
      },
    });
    const encrypted = await readFile(join(root, 'credentials', 'secrets.enc'));
    expect(encrypted.toString('utf8')).not.toContain('feishu-secret-must-not-be-plaintext');
    const index = await readFile(join(root, 'credentials', 'index.json'), 'utf8');
    expect(index).toContain('feishu:ops');
    expect(index).not.toContain('feishu-secret');
  });

  it('refuses plaintext fallback when OS encryption is unavailable', async () => {
    const unavailable = { ...cipher, isEncryptionAvailable: () => false };
    await expect(setVaultSecret({
      type: 'api_key',
      accountId: 'blocked',
      apiKey: 'secret',
    }, unavailable)).rejects.toThrow('refusing to persist');
  });
});
