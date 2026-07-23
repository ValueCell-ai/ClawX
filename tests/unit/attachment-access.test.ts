// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AcpSessionAccessRegistry } from '../../electron/services/acp-session-access-registry';
import {
  StagedAttachmentRegistry,
  createAttachmentAccess,
} from '../../electron/services/attachment-access';
import {
  clearAcpTraceForTests,
  getAcpTraceSnapshot,
} from '../../electron/services/acp-trace';
import {
  resolveOpenClawConfigDir,
  resolveOpenClawConfigPath,
  resolveOpenClawStateDir,
} from '../../electron/utils/paths';

describe('attachment access boundary', () => {
  const sessionKey = 'agent:main:session-a';
  let testDir: string;
  let workspaceRoot: string;
  let stateDir: string;
  let configDir: string;
  let externalMediaRoot: string;
  let outsideDir: string;
  let registry: AcpSessionAccessRegistry;
  let stagedAttachments: StagedAttachmentRegistry;
  let openPath: ReturnType<typeof vi.fn>;
  let openExternal: ReturnType<typeof vi.fn>;
  let showItemInFolder: ReturnType<typeof vi.fn>;
  let listOpenHandlers: ReturnType<typeof vi.fn>;
  let openWithHandler: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clearAcpTraceForTests();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-attachment-access-'));
    workspaceRoot = join(testDir, 'workspace');
    stateDir = join(testDir, 'state');
    configDir = join(testDir, 'config');
    externalMediaRoot = join(testDir, 'runtime-media');
    outsideDir = join(testDir, 'outside');
    await Promise.all([
      mkdir(join(workspaceRoot, 'nested'), { recursive: true }),
      mkdir(join(stateDir, 'media', 'outgoing', 'records'), { recursive: true }),
      mkdir(join(stateDir, 'agents', 'main', 'sessions'), { recursive: true }),
      mkdir(join(configDir, 'media'), { recursive: true }),
      mkdir(externalMediaRoot, { recursive: true }),
      mkdir(outsideDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(workspaceRoot, 'notes.txt'), 'workspace notes'),
      writeFile(join(workspaceRoot, 'binary.bin'), Buffer.from([1, 2, 3])),
      writeFile(join(stateDir, 'media', 'state.png'), 'state image'),
      writeFile(join(configDir, 'media', 'config.png'), 'config image'),
      writeFile(join(externalMediaRoot, 'runtime.png'), 'runtime image'),
      writeFile(join(stateDir, 'openclaw.json'), '{}'),
      writeFile(join(configDir, 'openclaw.json'), '{}'),
      writeFile(join(stateDir, 'media', 'outgoing', 'records', 'leak.json'), JSON.stringify({
        original: { path: '/private/account/secret.png' },
      })),
      writeFile(join(stateDir, 'agents', 'main', 'sessions', 'secret.jsonl'), 'secret'),
      writeFile(join(outsideDir, 'secret.txt'), 'outside secret'),
    ]);
    registry = new AcpSessionAccessRegistry();
    registry.commitGrant(await registry.prepareGrant({
      sessionKey,
      generation: 1,
      workspaceRoot,
      executionCwd: join(workspaceRoot, 'nested'),
    }));
    stagedAttachments = new StagedAttachmentRegistry();
    openPath = vi.fn().mockResolvedValue('');
    openExternal = vi.fn().mockResolvedValue(undefined);
    showItemInFolder = vi.fn();
    listOpenHandlers = vi.fn().mockResolvedValue([]);
    openWithHandler = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function getAccess() {
    return createAttachmentAccess({
      sessionAccessRegistry: registry,
      stagedAttachments,
      stateDir,
      configDir,
      shell: { openPath, openExternal, showItemInFolder },
      openWith: {
        platform: 'darwin',
        list: listOpenHandlers,
        open: openWithHandler,
      },
    });
  }

  function ref(uri: string, extra: Record<string, unknown> = {}) {
    return { sessionKey, generation: 1, uri, ...extra };
  }

  it('resolves workspace files only through the exact registered session and generation', async () => {
    const access = getAccess();
    const workspaceFile = join(workspaceRoot, 'notes.txt');

    await expect(access.resolveAttachment({ ref: ref(workspaceFile) })).resolves.toMatchObject({
      ok: true,
      displayName: 'notes.txt',
      target: { kind: 'local', scope: 'workspace', ref: ref(workspaceFile) },
    });
    await expect(access.resolveAttachment({ ref: { ...ref(workspaceFile), sessionKey: 'agent:main:other' } }))
      .resolves.toMatchObject({ ok: false, error: 'staleSession' });
    await expect(access.resolveAttachment({ ref: { ...ref(workspaceFile), generation: 2 } }))
      .resolves.toMatchObject({ ok: false, error: 'staleSession' });
    await expect(access.resolveAttachment({
      ref: ref(join(outsideDir, 'secret.txt')),
      workspaceRoot: outsideDir,
    } as never)).resolves.toMatchObject({ ok: true });
  });

  it('resolves OpenClaw media roots and files outside declared roots', async () => {
    const access = getAccess();

    await expect(access.resolveAttachment({ ref: ref(join(stateDir, 'media', 'state.png')) }))
      .resolves.toMatchObject({ ok: true, target: { kind: 'local', scope: 'openclaw-media' } });
    await expect(access.resolveAttachment({ ref: ref(join(configDir, 'media', 'config.png')) }))
      .resolves.toMatchObject({ ok: true, target: { kind: 'local', scope: 'openclaw-media' } });
    for (const allowed of [
      join(stateDir, 'openclaw.json'),
      join(configDir, 'openclaw.json'),
      join(stateDir, 'agents', 'main', 'sessions', 'secret.jsonl'),
      join(stateDir, 'media', 'outgoing', 'records', 'leak.json'),
      join(externalMediaRoot, 'runtime.png'),
    ]) {
      await expect(access.resolveAttachment({ ref: ref(allowed) }))
        .resolves.toMatchObject({ ok: true });
    }
  });

  it('resolves workspace root across rename and symlink replacement', async () => {
    const originalWorkspace = join(testDir, 'workspace-original');
    await rename(workspaceRoot, originalWorkspace);
    await symlink(outsideDir, workspaceRoot);

    await expect(getAccess().resolveAttachment({ ref: ref(join(workspaceRoot, 'secret.txt')) }))
      .resolves.toMatchObject({ ok: true });
  });

  it.each(['state-external', 'state-sibling', 'config-external', 'config-sibling'])(
    'resolves files through a symlinked managed media root targeting %s',
    async (scenario) => {
      const isState = scenario.startsWith('state');
      const parent = isState ? stateDir : configDir;
      const mediaPath = join(parent, 'media');
      const sibling = join(parent, 'sensitive');
      const target = scenario.endsWith('sibling') ? sibling : externalMediaRoot;
      await rm(mediaPath, { recursive: true, force: true });
      if (scenario.endsWith('sibling')) {
        await mkdir(sibling);
        await writeFile(join(sibling, 'secret.txt'), 'sibling secret');
      }
      await symlink(target, mediaPath);

      const targetFile = join(target, scenario.endsWith('sibling') ? 'secret.txt' : 'runtime.png');
      await expect(getAccess().resolveAttachment({ ref: ref(targetFile) }))
        .resolves.toMatchObject({ ok: true });
    },
  );

  it.each(['state', 'config'])('resolves through renamed and symlinked %s parent', async (kind) => {
    const parent = kind === 'state' ? stateDir : configDir;
    const originalParent = `${parent}-original`;
    const replacementParent = join(testDir, `${kind}-replacement`);
    const replacementMedia = join(replacementParent, 'media');
    const attachmentId = `${kind}-parent-swap`;
    const gatewayUrl = `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/${attachmentId}/full`;
    const initialMediaPath = join(parent, 'media', `${kind}.png`);
    const replacementMediaPath = join(replacementMedia, `${kind}.png`);
    await writeFile(initialMediaPath, `${kind} initial`);

    const recordPath = join(stateDir, 'media', 'outgoing', 'records', `${attachmentId}.json`);
    await writeFile(recordPath, JSON.stringify({
      attachmentId,
      sessionKey,
      original: { path: initialMediaPath, contentType: 'image/png' },
    }));
    const access = getAccess();

    await expect(access.resolveAttachment({ ref: ref(initialMediaPath) }))
      .resolves.toMatchObject({ ok: true });
    await expect(access.resolveAttachment({ ref: ref(gatewayUrl) }))
      .resolves.toMatchObject({ ok: true });

    await mkdir(replacementMedia, { recursive: true });
    await writeFile(replacementMediaPath, `${kind} replacement`);
    if (kind === 'state') {
      await mkdir(join(replacementMedia, 'outgoing', 'records'), { recursive: true });
      await writeFile(
        join(replacementMedia, 'outgoing', 'records', `${attachmentId}.json`),
        JSON.stringify({
          attachmentId,
          sessionKey,
          original: { path: replacementMediaPath, contentType: 'image/png' },
        }),
      );
    }
    await rename(parent, originalParent);
    await symlink(replacementParent, parent);

    await expect(access.resolveAttachment({ ref: ref(join(parent, 'media', `${kind}.png`)) }))
      .resolves.toMatchObject({ ok: true });
    await expect(access.resolveAttachment({ ref: ref(gatewayUrl) }))
      .resolves.toMatchObject({ ok: false });
  });

  it('requires a Main-owned staging id and matching staged path', async () => {
    const stagingDir = join(stateDir, 'media', 'outbound', 'clawx-staging');
    const stagedPath = join(stagingDir, 'owned.txt');
    const previousRunPath = join(stagingDir, 'previous-run.txt');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(stagedPath, 'owned');
    await writeFile(previousRunPath, 'unregistered');
    stagedAttachments.register('stage-1', await realpath(stagedPath), '/Users/test/Documents/owned.txt');
    const access = getAccess();

    await expect(access.resolveAttachment({ ref: ref(stagedPath) }))
      .resolves.toMatchObject({ ok: true });
    await expect(access.resolveAttachment({ ref: ref(previousRunPath) }))
      .resolves.toMatchObject({ ok: true });
    await expect(access.resolveAttachment({ ref: ref(stagedPath, { stagingId: 'stage-1' }) }))
      .resolves.toMatchObject({
        ok: true,
        displayPath: '/Users/test/Documents/owned.txt',
        target: { kind: 'local', scope: 'staging' },
      });
    await expect(access.resolveAttachment({
      ref: ref(join(outsideDir, 'secret.txt'), { stagingId: 'stage-1' }),
    })).resolves.toMatchObject({ ok: false, error: 'invalidReference' });
  });

  it('falls back to regular resolution when stagingId is unknown after restart', async () => {
    const stagingDir = join(stateDir, 'media', 'outbound', 'clawx-staging');
    const orphanedPath = join(stagingDir, 'orphaned-from-prev-run.txt');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(orphanedPath, 'persisted on disk');
    const access = getAccess();

    await expect(access.resolveAttachment({ ref: ref(orphanedPath, { stagingId: 'unknown-id' }) }))
      .resolves.toMatchObject({ ok: true, displayName: 'orphaned-from-prev-run.txt' });
  });

  it('binds outgoing records to attachment, URL session, record session, and message ids', async () => {
    const attachmentId = 'generated-1';
    const originalPath = join(stateDir, 'media', 'state.png');
    const recordPath = join(stateDir, 'media', 'outgoing', 'records', `${attachmentId}.json`);
    const gatewayUrl = `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/${attachmentId}/full`;
    const writeRecord = (record: Record<string, unknown>) => writeFile(recordPath, JSON.stringify(record));
    const access = getAccess();

    await writeRecord({
      attachmentId,
      sessionKey,
      messageId: 'message-1',
      original: { path: originalPath, contentType: 'image/png' },
    });
    await expect(access.resolveAttachment({
      ref: ref(gatewayUrl, { transcriptMessageId: 'message-1' }),
    })).resolves.toMatchObject({ ok: true, mimeType: 'image/png', target: { scope: 'openclaw-media' } });

    const rejected = [
      `/api/chat/media/outgoing/${encodeURIComponent('agent:main:other')}/${attachmentId}/full`,
      `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/different-id/full`,
    ];
    for (const uri of rejected) {
      await expect(access.resolveAttachment({ ref: ref(uri, { transcriptMessageId: 'message-1' }) }))
        .resolves.toMatchObject({ ok: false });
    }
    await expect(access.resolveAttachment({
      ref: ref(gatewayUrl, { transcriptMessageId: 'message-2' }),
    })).resolves.toMatchObject({ ok: false, error: 'invalidReference' });

    await writeRecord({
      attachmentId,
      sessionKey: 'agent:main:other',
      original: { path: originalPath, contentType: 'image/png' },
    });
    await expect(access.resolveAttachment({ ref: ref(gatewayUrl) }))
      .resolves.toMatchObject({ ok: false, error: 'invalidReference' });
  });

  it('treats global as a literal outgoing session rather than a wildcard', async () => {
    const attachmentId = 'global-image';
    const recordPath = join(stateDir, 'media', 'outgoing', 'records', `${attachmentId}.json`);
    await writeFile(recordPath, JSON.stringify({
      attachmentId,
      sessionKey: 'global',
      original: { path: join(stateDir, 'media', 'state.png') },
    }));
    const access = getAccess();
    const globalUrl = `/api/chat/media/outgoing/global/${attachmentId}/full`;

    await expect(access.resolveAttachment({ ref: ref(globalUrl) }))
      .resolves.toMatchObject({ ok: false, error: 'invalidReference' });

    registry.commitGrant(await registry.prepareGrant({
      sessionKey: 'global',
      generation: 2,
      workspaceRoot,
      executionCwd: workspaceRoot,
    }));
    await expect(access.resolveAttachment({
      ref: { sessionKey: 'global', generation: 2, uri: globalUrl },
    })).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['missing file', () => join(workspaceRoot, 'missing.txt'), 'unavailable'],
    ['directory', () => workspaceRoot, 'notFile'],
    ['traversal', () => `${workspaceRoot}/nested/../notes.txt`, 'invalidReference'],
    ['encoded traversal', () => `file://${workspaceRoot}/nested/%2e%2e/notes.txt`, 'invalidReference'],
    ['encoded NUL', () => `file://${workspaceRoot}/notes.txt%00`, 'invalidReference'],
    ['remote file authority', () => 'file://evil.example/etc/passwd', 'invalidReference'],
    ['UNC path', () => '\\\\server\\share\\file.txt', 'invalidReference'],
    ['URL credentials', () => 'https://user:pass@example.com/file.txt', 'unsafeUrl'],
    ['unknown scheme', () => 'ftp://example.com/file.txt', 'invalidReference'],
    ['overlong reference', () => `https://example.com/${'a'.repeat(4096)}`, 'invalidReference'],
  ])('fails closed for %s', async (_label, makeUri, error) => {
    await expect(getAccess().resolveAttachment({ ref: ref(makeUri()) }))
      .resolves.toMatchObject({ ok: false, error });
  });

  it('resolves files through symlink escapes', async () => {
    await symlink(join(outsideDir, 'secret.txt'), join(workspaceRoot, 'escape.txt'));

    await expect(getAccess().resolveAttachment({ ref: ref(join(workspaceRoot, 'escape.txt')) }))
      .resolves.toMatchObject({ ok: true });
  });

  it('normalizes safe remote URLs without granting unsafe variants', async () => {
    const access = getAccess();
    const result = await access.resolveAttachment({
      ref: ref('HTTPS://Example.COM:443/assets/report%20final.pdf?x=1'),
    });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'report final.pdf',
      target: {
        kind: 'remote',
        url: 'https://example.com/assets/report%20final.pdf?x=1',
      },
    });
    expect(result.ok && result.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(workspaceRoot);
  });

  it('re-resolves text, binary, and open operations after prior success', async () => {
    const access = getAccess();
    const textRef = ref(join(workspaceRoot, 'notes.txt'));
    const binaryRef = ref(join(workspaceRoot, 'binary.bin'));
    await expect(access.resolveAttachment({ ref: textRef })).resolves.toMatchObject({ ok: true });
    await expect(access.resolveAttachment({ ref: binaryRef })).resolves.toMatchObject({ ok: true });

    registry.commitGrant(await registry.prepareGrant({
      sessionKey,
      generation: 2,
      workspaceRoot,
      executionCwd: workspaceRoot,
    }));

    await expect(access.readAttachmentText(textRef)).resolves.toEqual({ ok: false, error: 'staleSession' });
    await expect(access.readAttachmentBinary({ ref: binaryRef })).resolves.toEqual({ ok: false, error: 'staleSession' });
    await expect(access.openAttachment(textRef)).resolves.toEqual({ ok: false, error: 'staleSession' });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('reads bounded text and binary data through attachment refs', async () => {
    const access = getAccess();

    await expect(access.readAttachmentText(ref(join(workspaceRoot, 'notes.txt')))).resolves.toMatchObject({
      ok: true,
      content: 'workspace notes',
      size: 15,
    });
    await expect(access.readAttachmentBinary({ ref: ref(join(workspaceRoot, 'binary.bin')), maxBytes: 3 }))
      .resolves.toMatchObject({ ok: true, data: new Uint8Array([1, 2, 3]), size: 3 });
    await expect(access.readAttachmentBinary({ ref: ref(join(workspaceRoot, 'binary.bin')), maxBytes: 2 }))
      .resolves.toMatchObject({ ok: false, error: 'tooLarge', size: 3 });
  });

  it('delegates validated local and remote opens to the correct shell operation', async () => {
    const access = getAccess();
    const localPath = join(workspaceRoot, 'notes.txt');
    const remoteUrl = 'https://example.com/download/report.pdf';

    await expect(access.openAttachment(ref(localPath))).resolves.toEqual({ ok: true });
    await expect(access.openAttachment(ref(remoteUrl))).resolves.toEqual({ ok: true });
    expect(openPath).toHaveBeenCalledWith(await realpath(localPath));
    expect(openExternal).toHaveBeenCalledWith(remoteUrl);
    const trace = getAcpTraceSnapshot().entries;
    expect(trace).toHaveLength(2);
    expect(trace.every((entry) => entry.event === 'attachment/open:success')).toBe(true);
    expect(trace.every((entry) => (
      Object.keys(entry.details as object).sort().join(',') === 'identity,reason,sourceKind'
    ))).toBe(true);
    expect(JSON.stringify(trace)).not.toContain(localPath);
    expect(JSON.stringify(trace)).not.toContain(remoteUrl);
  });

  it('lists only safe public handler metadata for a validated local ref', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));
    listOpenHandlers.mockResolvedValueOnce([{
      id: 'com.apple.Preview',
      name: 'Preview',
      iconDataUrl: 'data:image/png;base64,c2FmZQ==',
      isDefault: true,
      applicationPath: '/Applications/Private.app',
      commandLine: 'private --command',
    }]);

    await expect(getAccess().listAttachmentOpenHandlers(ref(localPath))).resolves.toEqual({
      ok: true,
      platform: 'darwin',
      handlers: [{
        handlerId: 'com.apple.Preview',
        name: 'Preview',
        iconDataUrl: 'data:image/png;base64,c2FmZQ==',
        isDefault: true,
      }],
    });
    expect(listOpenHandlers).toHaveBeenCalledWith(localPath);
  });

  it('returns a successful empty Linux list without invoking discovery', async () => {
    const localPath = join(workspaceRoot, 'notes.txt');
    const access = createAttachmentAccess({
      sessionAccessRegistry: registry,
      stagedAttachments,
      stateDir,
      configDir,
      shell: { openPath, openExternal, showItemInFolder },
      openWith: {
        platform: 'linux',
        list: listOpenHandlers,
        open: openWithHandler,
      },
    });

    await expect(access.listAttachmentOpenHandlers(ref(localPath))).resolves.toEqual({
      ok: true,
      platform: 'linux',
      handlers: [],
    });
    expect(listOpenHandlers).not.toHaveBeenCalled();
  });

  it('preserves normalized empty discovery and unexpected failure result semantics', async () => {
    const localRef = ref(join(workspaceRoot, 'notes.txt'));
    const access = getAccess();

    await expect(access.listAttachmentOpenHandlers(localRef)).resolves.toEqual({
      ok: true,
      platform: 'darwin',
      handlers: [],
    });
    listOpenHandlers.mockRejectedValueOnce(new Error('unexpected platform service failure'));
    await expect(access.listAttachmentOpenHandlers(localRef)).resolves.toEqual({
      ok: false,
      error: 'operationFailed',
    });
  });

  it.each([
    ['remote', () => ref('https://example.com/report.pdf'), 'invalidReference'],
    ['stale session', () => ({ ...ref(join(workspaceRoot, 'notes.txt')), generation: 2 }), 'staleSession'],
    ['missing file', () => ref(join(workspaceRoot, 'missing.txt')), 'unavailable'],
    ['non-file', () => ref(workspaceRoot), 'notFile'],
  ])('rejects %s refs for list, selected open, and reveal', async (_label, makeRef, error) => {
    const access = getAccess();
    const attachmentRef = makeRef();

    await expect(access.listAttachmentOpenHandlers(attachmentRef)).resolves.toEqual({ ok: false, error });
    await expect(access.openAttachmentWith({
      ref: attachmentRef,
      handlerId: 'com.apple.Preview',
    })).resolves.toEqual({ ok: false, error });
    await expect(access.revealAttachment(attachmentRef)).resolves.toEqual({ ok: false, error });
    expect(listOpenHandlers).not.toHaveBeenCalled();
    expect(openWithHandler).not.toHaveBeenCalled();
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('allows listed and selected-handler opens outside the workspace after exact ref validation', async () => {
    const outsidePath = await realpath(join(outsideDir, 'secret.txt'));
    listOpenHandlers.mockResolvedValueOnce([{
      id: 'com.apple.TextEdit',
      name: 'TextEdit',
      isDefault: true,
    }]);
    openWithHandler.mockImplementationOnce(async (_path, _handlerId, revalidateFile) => {
      await expect(revalidateFile()).resolves.toBe(outsidePath);
    });
    const access = getAccess();

    await expect(access.listAttachmentOpenHandlers(ref(outsidePath))).resolves.toMatchObject({ ok: true });
    await expect(access.openAttachmentWith({
      ref: ref(outsidePath),
      handlerId: 'com.apple.TextEdit',
    })).resolves.toEqual({ ok: true });
    expect(listOpenHandlers).toHaveBeenCalledWith(outsidePath);
    expect(openWithHandler).toHaveBeenCalledWith(
      outsidePath,
      'com.apple.TextEdit',
      expect.any(Function),
    );
  });

  it('delegates forged handler identity only to the platform membership check', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));
    openWithHandler.mockRejectedValueOnce(new Error('attachment-open-with:unknown-handler'));

    await expect(getAccess().openAttachmentWith({
      ref: ref(localPath),
      handlerId: 'com.attacker.Forged',
    })).resolves.toEqual({ ok: false, error: 'operationFailed' });
    expect(openWithHandler).toHaveBeenCalledWith(
      localPath,
      'com.attacker.Forged',
      expect.any(Function),
    );
  });

  it.each(['', 'x'.repeat(513)])('rejects invalid handler id %j before platform access', async (handlerId) => {
    await expect(getAccess().openAttachmentWith({
      ref: ref(join(workspaceRoot, 'notes.txt')),
      handlerId,
    })).resolves.toEqual({ ok: false, error: 'invalidReference' });
    expect(openWithHandler).not.toHaveBeenCalled();
  });

  it('re-resolves the original ref after platform handler readiness', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));
    let initialResolutionComplete = false;
    openWithHandler.mockImplementationOnce(async (initialPath, handlerId, revalidateFile) => {
      expect(initialPath).toBe(localPath);
      expect(handlerId).toBe('com.apple.Preview');
      initialResolutionComplete = true;
      await expect(revalidateFile()).resolves.toBe(localPath);
    });

    await expect(getAccess().openAttachmentWith({
      ref: ref(localPath),
      handlerId: 'com.apple.Preview',
    })).resolves.toEqual({ ok: true });
    expect(initialResolutionComplete).toBe(true);
  });

  it('rejects generation invalidation during delayed fresh handler enumeration', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));
    let releaseEnumeration!: () => void;
    let signalEnumeration!: () => void;
    const enumerationReached = new Promise<void>((resolveSignal) => {
      signalEnumeration = resolveSignal;
    });
    const enumerationRelease = new Promise<void>((resolveRelease) => {
      releaseEnumeration = resolveRelease;
    });
    const nativeInvoke = vi.fn();
    openWithHandler.mockImplementationOnce(async (_path, _handlerId, revalidateFile) => {
      signalEnumeration();
      await enumerationRelease;
      await revalidateFile();
      nativeInvoke();
    });
    const opening = getAccess().openAttachmentWith({
      ref: ref(localPath),
      handlerId: 'com.apple.Preview',
    });
    await enumerationReached;
    registry.commitGrant(await registry.prepareGrant({
      sessionKey,
      generation: 2,
      workspaceRoot,
      executionCwd: workspaceRoot,
    }));
    releaseEnumeration();

    await expect(opening).resolves.toEqual({ ok: false, error: 'staleSession' });
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it('re-resolves immediately before revealing and passes only the canonical path', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));

    await expect(getAccess().revealAttachment(ref(join(workspaceRoot, 'notes.txt'))))
      .resolves.toEqual({ ok: true });
    expect(showItemInFolder).toHaveBeenCalledWith(localPath);
  });

  it('rejects generation invalidation during final reveal validation', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));
    let targetStatCount = 0;
    let releaseFinalValidation!: () => void;
    let signalFinalValidation!: () => void;
    const finalValidationReached = new Promise<void>((resolveSignal) => {
      signalFinalValidation = resolveSignal;
    });
    const finalValidationRelease = new Promise<void>((resolveRelease) => {
      releaseFinalValidation = resolveRelease;
    });
    const access = createAttachmentAccess({
      sessionAccessRegistry: registry,
      stagedAttachments,
      stateDir,
      configDir,
      shell: { openPath, openExternal, showItemInFolder },
      openWith: {
        platform: 'darwin',
        list: listOpenHandlers,
        open: openWithHandler,
      },
      fs: {
        lstat,
        open,
        realpath,
        stat: async (path) => {
          const result = await stat(path);
          if (path === localPath && ++targetStatCount === 2) {
            signalFinalValidation();
            await finalValidationRelease;
          }
          return result;
        },
      },
    });

    const revealing = access.revealAttachment(ref(localPath));
    await finalValidationReached;
    registry.commitGrant(await registry.prepareGrant({
      sessionKey,
      generation: 2,
      workspaceRoot,
      executionCwd: workspaceRoot,
    }));
    releaseFinalValidation();

    await expect(revealing).resolves.toEqual({ ok: false, error: 'staleSession' });
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('does not place open-with or reveal sensitive values in diagnostics', async () => {
    const sentinelPath = join(outsideDir, 'sentinel-canonical-file.txt');
    const sentinels = [
      sentinelPath,
      '/Applications/Sentinel Bundle.app',
      '/private/sentinel-icon-source.icns',
      'sentinel-command --secret',
      'data:image/png;base64,SENTINEL_ICON_DATA',
    ];
    await writeFile(sentinelPath, 'sentinel');
    listOpenHandlers.mockResolvedValueOnce([{
      id: 'com.example.Sentinel',
      name: 'Sentinel',
      iconDataUrl: sentinels[4],
      isDefault: true,
      applicationPath: sentinels[1],
      bundlePath: sentinels[1],
      iconSourcePath: sentinels[2],
      commandLine: sentinels[3],
    }]);
    openWithHandler.mockImplementationOnce(async (_path, _handlerId, revalidateFile) => {
      await revalidateFile();
    });
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined)
    ));
    const access = getAccess();

    try {
      await access.listAttachmentOpenHandlers(ref(sentinelPath));
      await access.openAttachmentWith({ ref: ref(sentinelPath), handlerId: 'com.example.Sentinel' });
      await access.revealAttachment(ref(sentinelPath));

      const diagnostics = JSON.stringify({
        trace: getAcpTraceSnapshot(),
        logs: consoleSpies.flatMap((spy) => spy.mock.calls),
      });
      for (const sentinel of sentinels) expect(diagnostics).not.toContain(sentinel);
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it('rechecks generation after final local validation before shell.openPath', async () => {
    const localPath = await realpath(join(workspaceRoot, 'notes.txt'));
    let targetStatCount = 0;
    let releaseFinalValidation!: () => void;
    let signalFinalValidation!: () => void;
    const finalValidationReached = new Promise<void>((resolveSignal) => {
      signalFinalValidation = resolveSignal;
    });
    const finalValidationRelease = new Promise<void>((resolveRelease) => {
      releaseFinalValidation = resolveRelease;
    });
    const access = createAttachmentAccess({
      sessionAccessRegistry: registry,
      stagedAttachments,
      stateDir,
      configDir,
      shell: { openPath, openExternal, showItemInFolder },
      openWith: {
        platform: 'darwin',
        list: listOpenHandlers,
        open: openWithHandler,
      },
      fs: {
        lstat,
        open,
        realpath,
        stat: async (path) => {
          const result = await stat(path);
          if (path === localPath && ++targetStatCount === 2) {
            signalFinalValidation();
            await finalValidationRelease;
          }
          return result;
        },
      },
    });

    const opening = access.openAttachment(ref(localPath));
    await finalValidationReached;
    registry.commitGrant(await registry.prepareGrant({
      sessionKey,
      generation: 2,
      workspaceRoot,
      executionCwd: workspaceRoot,
    }));
    releaseFinalValidation();

    await expect(opening).resolves.toEqual({ ok: false, error: 'staleSession' });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('records only bounded, redacted attachment open trace metadata', async () => {
    openPath.mockResolvedValueOnce('application failed');
    const localPath = join(workspaceRoot, 'notes.txt');

    await expect(getAccess().openAttachment(ref(localPath))).resolves.toEqual({
      ok: false,
      error: 'operationFailed',
    });

    const entry = getAcpTraceSnapshot().entries.at(-1);
    expect(entry).toMatchObject({
      source: 'main',
      event: 'attachment/open:failure',
      sessionKey,
      generation: 1,
      details: {
        reason: 'operationFailed',
        sourceKind: 'local',
        identity: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(Object.keys(entry?.details as object).sort()).toEqual(['identity', 'reason', 'sourceKind']);
    expect(JSON.stringify(entry)).not.toContain(localPath);
    expect(JSON.stringify(entry)).not.toContain(pathToFileURL(localPath).href);
  });

  it('sanitizes hostile display labels to one bounded line', async () => {
    const hostile = `/private/account/secrets/report\n\u202Egpj.exe\u0007 ${'x'.repeat(300)}  `;
    const result = await getAccess().resolveAttachment({
      ref: ref(join(workspaceRoot, 'notes.txt')),
      name: hostile,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.displayName).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f
        || (codePoint >= 0x7f && codePoint <= 0x9f)
        || (codePoint >= 0x202a && codePoint <= 0x202e);
    })).toBe(false);
    expect(result.displayName).not.toContain('\n');
    expect(result.displayName).not.toContain('/private/account/secrets');
    expect(result.displayName.length).toBeLessThanOrEqual(160);
  });
});

describe('OpenClaw attachment path resolution', () => {
  it('keeps state and config paths distinct and absolute', () => {
    const stateDir = resolveOpenClawStateDir({ OPENCLAW_STATE_DIR: '~/custom-state' });
    const configPath = resolveOpenClawConfigPath({
      OPENCLAW_STATE_DIR: '~/custom-state',
      OPENCLAW_CONFIG_PATH: './runtime/openclaw.json',
    });

    expect(stateDir).toBe(resolve(process.env.HOME!, 'custom-state'));
    expect(configPath).toBe(resolve('runtime/openclaw.json'));
    expect(resolveOpenClawConfigDir({ OPENCLAW_CONFIG_PATH: configPath })).toBe(resolve('runtime'));
    expect(resolveOpenClawConfigPath({ OPENCLAW_STATE_DIR: stateDir })).toBe(join(stateDir, 'openclaw.json'));
  });
});
