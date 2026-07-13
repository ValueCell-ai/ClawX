import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;

vi.mock('electron', () => ({
  app: { getPath: () => root },
}));

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(join(tmpdir(), 'clawx-agent-bindings-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cc-connect Agent provider bindings', () => {
  it('keeps provider accounts isolated by Agent and persists no credentials', async () => {
    const {
      listCcConnectAgentProviderBindings,
      setCcConnectAgentProviderBinding,
    } = await import('@electron/runtime/cc-connect-agent-bindings');

    await setCcConnectAgentProviderBinding('main', 'openai-oauth-a');
    await setCcConnectAgentProviderBinding('reviewer', 'openai-api-key-b');
    await expect(listCcConnectAgentProviderBindings()).resolves.toEqual({
      main: 'openai-oauth-a',
      reviewer: 'openai-api-key-b',
    });

    const file = await readFile(join(root, 'app', 'agent-bindings.json'), 'utf8');
    expect(file).toContain('openai-oauth-a');
    expect(file).toContain('openai-api-key-b');
    expect(file).not.toMatch(/accessToken|refreshToken|apiKey|sk-/);

    await setCcConnectAgentProviderBinding('reviewer', null);
    await expect(listCcConnectAgentProviderBindings()).resolves.toEqual({ main: 'openai-oauth-a' });
  });

  it('persists an independent permission mode without dropping the provider binding', async () => {
    const {
      deleteCcConnectAgentBinding,
      listCcConnectAgentPermissionModes,
      listCcConnectAgentProviderBindings,
      setCcConnectAgentPermissionMode,
      setCcConnectAgentProviderBinding,
    } = await import('@electron/runtime/cc-connect-agent-bindings');

    await setCcConnectAgentProviderBinding('reviewer', 'openai-oauth-reviewer');
    await setCcConnectAgentPermissionMode('reviewer', 'suggest');
    await expect(listCcConnectAgentProviderBindings()).resolves.toEqual({
      reviewer: 'openai-oauth-reviewer',
    });
    await expect(listCcConnectAgentPermissionModes()).resolves.toEqual({
      reviewer: 'suggest',
    });

    await setCcConnectAgentProviderBinding('reviewer', null);
    await expect(listCcConnectAgentPermissionModes()).resolves.toEqual({
      reviewer: 'suggest',
    });
    await deleteCcConnectAgentBinding('reviewer');
    await expect(listCcConnectAgentPermissionModes()).resolves.toEqual({});
  });

  it('rejects unsupported permission modes', async () => {
    const { setCcConnectAgentPermissionMode } = await import('@electron/runtime/cc-connect-agent-bindings');
    await expect(setCcConnectAgentPermissionMode('main', 'yolo' as never))
      .rejects.toThrow('permissionMode must be suggest or full-auto');
  });
});
