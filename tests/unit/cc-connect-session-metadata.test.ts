// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCcConnectSessionMetadataStore } from '@electron/runtime/cc-connect-session-metadata';

describe('cc-connect session metadata store', () => {
  let tempDir: string;
  let metadataPath: string;
  let legacyPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-connect-session-metadata-'));
    metadataPath = join(tempDir, 'app', 'cc-connect-session-metadata.json');
    legacyPath = join(tempDir, 'runtimes', 'cc-connect', 'data', 'sessions', '.clawx-supplemental-history.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists concurrent labels atomically and deletes only the requested session', async () => {
    const store = new FileCcConnectSessionMetadataStore(metadataPath, legacyPath);
    await Promise.all([
      store.setLabel('agent:main:one', 'One'),
      store.setLabel('agent:main:two', 'Two'),
    ]);

    await expect(store.getLabel('agent:main:one')).resolves.toBe('One');
    await expect(store.getLabel('agent:main:two')).resolves.toBe('Two');
    await store.deleteLabel('agent:main:one');
    await expect(store.getLabel('agent:main:one')).resolves.toBeUndefined();
    await expect(store.getLabel('agent:main:two')).resolves.toBe('Two');

    const document = JSON.parse(await readFile(metadataPath, 'utf8')) as { labels: Record<string, string> };
    expect(document.labels).toEqual({ 'agent:main:two': 'Two' });
    if (process.platform !== 'win32') {
      expect((await stat(metadataPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('migrates legacy ClawX labels without copying private runtime history', async () => {
    await mkdir(join(legacyPath, '..'), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      labels: { 'agent:research:main': 'Research title' },
      sessions: {
        'agent:research:main': [{ role: 'user', content: 'private history must not migrate' }],
      },
    }), 'utf8');

    const store = new FileCcConnectSessionMetadataStore(metadataPath, legacyPath);
    await expect(store.getLabel('agent:research:main')).resolves.toBe('Research title');

    const canonical = await readFile(metadataPath, 'utf8');
    expect(canonical).toContain('Research title');
    expect(canonical).not.toContain('private history must not migrate');
    expect(canonical).not.toContain('"sessions"');
  });
});
