import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { ProviderSecret } from '../../shared/providers/types';
import { getClawXDataLayout, resolveClawXDataRoot } from '../../utils/clawx-data-layout';

const VAULT_SCHEMA = 'clawx-credential-vault';
const VAULT_VERSION = 1;

type CredentialVaultDocument = {
  schema: typeof VAULT_SCHEMA;
  version: typeof VAULT_VERSION;
  secrets: Record<string, ProviderSecret>;
  channelSecrets: Record<string, Record<string, string>>;
};

export interface CredentialCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function credentialPaths() {
  const layout = getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData')));
  return {
    vaultPath: join(layout.credentialsDir, 'secrets.enc'),
    indexPath: join(layout.credentialsDir, 'index.json'),
  };
}

function e2eCredentialCipher(secret: string): CredentialCipher {
  const key = createHash('sha256').update(secret).digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString: (value) => {
      const iv = value.subarray(0, 12);
      const authTag = value.subarray(12, 28);
      const encrypted = value.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    },
  };
}

function defaultCredentialCipher(): CredentialCipher {
  const e2eKey = process.env.CLAWX_E2E_CREDENTIAL_KEY?.trim();
  if (process.env.CLAWX_E2E === '1' && e2eKey) return e2eCredentialCipher(e2eKey);
  return safeStorage;
}

function emptyVault(): CredentialVaultDocument {
  return { schema: VAULT_SCHEMA, version: VAULT_VERSION, secrets: {}, channelSecrets: {} };
}

async function writeAtomic(path: string, content: string | Buffer, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, { mode });
  await chmod(temporaryPath, mode).catch(() => {});
  await rename(temporaryPath, path);
  await chmod(path, mode).catch(() => {});
}

export async function readCredentialVault(
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<CredentialVaultDocument> {
  const { vaultPath } = credentialPaths();
  let encrypted: Buffer;
  try {
    encrypted = await readFile(vaultPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyVault();
    throw error;
  }
  if (!cipher.isEncryptionAvailable()) {
    throw new Error('OS credential encryption is unavailable; refusing to read ClawX provider secrets');
  }
  const parsed = JSON.parse(cipher.decryptString(encrypted)) as Partial<CredentialVaultDocument>;
  if (parsed.schema !== VAULT_SCHEMA || parsed.version !== VAULT_VERSION || !parsed.secrets) {
    throw new Error('Unsupported or invalid ClawX credential vault');
  }
  return {
    ...(parsed as CredentialVaultDocument),
    channelSecrets: parsed.channelSecrets ?? {},
  };
}

export async function writeCredentialVault(
  document: CredentialVaultDocument,
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<void> {
  if (!cipher.isEncryptionAvailable()) {
    throw new Error('OS credential encryption is unavailable; refusing to persist provider secrets');
  }
  const { vaultPath, indexPath } = credentialPaths();
  const encrypted = cipher.encryptString(JSON.stringify(document));
  await writeAtomic(vaultPath, encrypted);
  await writeAtomic(indexPath, `${JSON.stringify({
    schema: 'clawx-credential-index',
    version: 1,
    accountIds: Object.keys(document.secrets).sort(),
    channelCredentialIds: Object.keys(document.channelSecrets).sort(),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

export async function getVaultSecret(
  accountId: string,
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<ProviderSecret | null> {
  return (await readCredentialVault(cipher)).secrets[accountId] ?? null;
}

export async function setVaultSecret(
  secret: ProviderSecret,
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<void> {
  const document = await readCredentialVault(cipher);
  document.secrets[secret.accountId] = secret;
  await writeCredentialVault(document, cipher);
}

export async function deleteVaultSecret(
  accountId: string,
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<void> {
  const document = await readCredentialVault(cipher);
  if (!(accountId in document.secrets)) return;
  delete document.secrets[accountId];
  if (Object.keys(document.secrets).length === 0 && Object.keys(document.channelSecrets).length === 0) {
    const { vaultPath, indexPath } = credentialPaths();
    await Promise.all([rm(vaultPath, { force: true }), rm(indexPath, { force: true })]);
    return;
  }
  await writeCredentialVault(document, cipher);
}

export async function getChannelVaultSecrets(
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<Record<string, Record<string, string>>> {
  return (await readCredentialVault(cipher)).channelSecrets;
}

export async function replaceChannelVaultSecrets(
  channelSecrets: Record<string, Record<string, string>>,
  cipher: CredentialCipher = defaultCredentialCipher(),
): Promise<void> {
  const document = await readCredentialVault(cipher);
  document.channelSecrets = channelSecrets;
  if (Object.keys(document.secrets).length === 0 && Object.keys(channelSecrets).length === 0) {
    const { vaultPath, indexPath } = credentialPaths();
    await Promise.all([rm(vaultPath, { force: true }), rm(indexPath, { force: true })]);
    return;
  }
  await writeCredentialVault(document, cipher);
}
