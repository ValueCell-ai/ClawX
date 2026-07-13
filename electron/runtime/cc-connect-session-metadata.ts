import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { getClawXDataLayout, resolveClawXDataRoot } from '../utils/clawx-data-layout';
import { getCcConnectManagedDir } from './cc-connect-paths';

type SessionMetadataDocument = {
  schema: 'clawx-cc-connect-session-metadata';
  version: 1;
  labels: Record<string, string>;
  updatedAt: string;
  migratedFromLegacyAt?: string;
};

export interface CcConnectSessionMetadataStore {
  getLabel(sessionKey: string): Promise<string | undefined>;
  setLabel(sessionKey: string, label: string): Promise<void>;
  deleteLabel(sessionKey: string): Promise<void>;
}

function defaultMetadataPath(): string {
  const layout = getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData')));
  return join(layout.appDir, 'cc-connect-session-metadata.json');
}

function defaultLegacyPath(): string {
  return join(getCcConnectManagedDir(), 'data', 'sessions', '.clawx-supplemental-history.json');
}

async function writeAtomic(path: string, document: SessionMetadataDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => {});
  await rename(temporaryPath, path);
  await chmod(path, 0o600).catch(() => {});
}

function emptyDocument(): SessionMetadataDocument {
  return {
    schema: 'clawx-cc-connect-session-metadata',
    version: 1,
    labels: {},
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizedLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, label]) => (
    typeof label === 'string' && label.trim() ? [[key, label.trim().slice(0, 80)]] : []
  )));
}

export class FileCcConnectSessionMetadataStore implements CcConnectSessionMetadataStore {
  private queue = Promise.resolve();

  constructor(
    private readonly metadataPath = defaultMetadataPath(),
    private readonly legacyPath = defaultLegacyPath(),
  ) {}

  async getLabel(sessionKey: string): Promise<string | undefined> {
    const document = await this.readDocument();
    return document.labels[sessionKey];
  }

  async setLabel(sessionKey: string, label: string): Promise<void> {
    const normalized = label.trim().slice(0, 80);
    if (!normalized) throw new Error('Label cannot be empty');
    await this.exclusive(async () => {
      const document = await this.readDocument();
      document.labels[sessionKey] = normalized;
      document.updatedAt = new Date().toISOString();
      await writeAtomic(this.metadataPath, document);
    });
  }

  async deleteLabel(sessionKey: string): Promise<void> {
    await this.exclusive(async () => {
      const document = await this.readDocument();
      if (!(sessionKey in document.labels)) return;
      delete document.labels[sessionKey];
      document.updatedAt = new Date().toISOString();
      await writeAtomic(this.metadataPath, document);
    });
  }

  private async readDocument(): Promise<SessionMetadataDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.metadataPath, 'utf8')) as Partial<SessionMetadataDocument>;
      if (parsed.schema !== 'clawx-cc-connect-session-metadata' || parsed.version !== 1) {
        throw new Error(`Unsupported cc-connect session metadata: ${this.metadataPath}`);
      }
      return { ...parsed, labels: normalizedLabels(parsed.labels) } as SessionMetadataDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const document = emptyDocument();
    try {
      const legacy = JSON.parse(await readFile(this.legacyPath, 'utf8')) as { labels?: unknown };
      document.labels = normalizedLabels(legacy.labels);
      document.migratedFromLegacyAt = new Date().toISOString();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    document.updatedAt = new Date().toISOString();
    await writeAtomic(this.metadataPath, document);
    return document;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
