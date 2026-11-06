// @vitest-environment node

import { access, lstat, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = await vi.hoisted(async () => {
  const os = await vi.importActual<typeof import('os')>('os');
  const path = await vi.importActual<typeof import('path')>('path');
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: path.join(os.tmpdir(), `clawx-agent-config-${suffix}`),
    testUserData: path.join(os.tmpdir(), `clawx-agent-config-user-data-${suffix}`),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv('HOME', testHome);
    vi.stubEnv('USERPROFILE', testHome);
    vi.stubEnv('OPENCLAW_HOME', testHome);
    vi.stubEnv('OPENCLAW_STATE_DIR', '');
    vi.stubEnv('OPENCLAW_WORKSPACE_DIR', '');
    vi.stubEnv('OPENCLAW_PROFILE', '');
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { label: 'implicit first agent', list: [{ id: 'main' }, { id: 'coder' }], defaults: {}, owner: 'main' },
    { label: 'marked main', list: [{ id: 'coder' }, { id: 'main', default: true }], defaults: {}, owner: 'main' },
    { label: 'named default with a base', list: [{ id: 'main' }, { id: 'research', default: true }], defaults: { workspace: '~/工程 Alpha' }, owner: 'research' },
  ])('preserves all effective workspaces for $label and migrates only once', async ({ list, defaults, owner }) => {
    const { migrateLegacyAgentRosterInConfig, listAgentsSnapshotFromConfig } = await import('@electron/utils/agent-config');
    const config = { agents: { defaults, list }, tools: { allow: ['read'] } };
    const before = await listAgentsSnapshotFromConfig(config, []);
    expect(migrateLegacyAgentRosterInConfig(config)).toBe(true);
    const after = await listAgentsSnapshotFromConfig(config, []);
    expect(after.agents.map(({ id, workspace }) => [id, workspace])).toEqual(before.agents.map(({ id, workspace }) => [id, workspace]));
    expect(after.agents.find(({ id }) => id === owner)?.workspace).toBe(resolve(testHome, defaults.workspace ? '工程 Alpha' : '.openclaw/workspace'));
    expect(config.tools).toEqual({ allow: ['read'] });
    const migrated = structuredClone(config);
    expect(migrateLegacyAgentRosterInConfig(config)).toBe(false);
    expect(config).toEqual(migrated);
  });

  it('preserves explicit external paths and default owner roles', async () => {
    const { migrateLegacyAgentRosterInConfig } = await import('@electron/utils/agent-config');
    const config: Record<string, unknown> = { agents: { list: [
      { id: 'main', workspace: '~/External Project' },
      { id: 'research', default: true },
    ] }, channels: { telegram: { enabled: true } } };
    expect(migrateLegacyAgentRosterInConfig(config)).toBe(true);
    expect(config.agents).toMatchObject({
      defaults: { systemAgent: { agentId: 'research' }, authInheritance: { agentId: 'research' } },
      entries: { main: { workspace: '~/External Project' }, research: { workspace: resolve(testHome, '.openclaw/workspace') } },
    });
    expect(config.bindings).toContainEqual({ agentId: 'research', match: { channel: 'telegram', accountId: '*' } });
  });

  it.each([
    { list: [{ id: 'main' }, { id: 'MAIN' }] },
    { list: [{ id: 'main', default: true }, { id: 'coder', default: true }] },
    { list: [{ id: 'main', default: 'true' }] },
    { list: [{ id: 'main' }], entries: { coder: {} } },
    { list: [{ id: 'a b' }, { id: 'a-b' }] },
    { list: [{ id: 'main' }], ownership: 'explicit' },
  ])('leaves ambiguous roster shapes unchanged for Doctor: %j', async (agents) => {
    const { migrateLegacyAgentRosterInConfig } = await import('@electron/utils/agent-config');
    const config = { agents };
    const before = structuredClone(config);
    expect(migrateLegacyAgentRosterInConfig(config)).toBe(false);
    expect(config).toEqual(before);
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('does not migrate ambiguous legacy rosters with duplicate ids', async () => {
    const { migrateLegacyAgentRosterInConfig } = await import('@electron/utils/agent-config');
    const config = {
      agents: {
        list: [
          { id: 'main', name: 'First' },
          { id: 'main', name: 'Second' },
        ],
      },
    };

    expect(migrateLegacyAgentRosterInConfig(config)).toBe(false);
    expect(config.agents.list).toHaveLength(2);
    expect(config.agents).not.toHaveProperty('entries');
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
  });

  it('reads a keyed OpenClaw 2026.10 roster and its system agent as the default', async () => {
    await writeOpenClawJson({
      agents: {
        ownership: 'explicit',
        defaults: { systemAgent: { agentId: 'main' } },
        entries: {
          coder: { name: 'Coder' },
          main: { name: 'Main' },
        },
      },
    });

    const { listAgentsSnapshot, listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['coder', 'main']);
    const snapshot = await listAgentsSnapshot();
    expect(snapshot.defaultAgentId).toBe('main');
    expect(snapshot.agents.map((agent) => [agent.id, agent.isDefault])).toEqual([
      ['coder', false],
      ['main', true],
    ]);
  });

  it('stamps explicit ownership when a second agent joins a single-agent roster', async () => {
    await writeOpenClawJson({
      agents: { entries: { main: { name: 'Main' } } },
    });

    const { createAgent } = await import('@electron/utils/agent-config');
    await createAgent('Research');

    const config = await readOpenClawJson();
    expect(config.agents).toEqual({
      defaults: { systemAgent: { agentId: 'main' } },
      ownership: 'explicit',
      entries: {
        main: { name: 'Main', workspace: resolve(testHome, '.openclaw/workspace') },
        research: {
          name: 'Research',
          workspace: '~/.openclaw/workspace-research',
          agentDir: '~/.openclaw/agents/research/agent',
        },
      },
    });
  });

  it('clears owner references to a deleted agent and drops ownership for a sole survivor', async () => {
    await writeOpenClawJson({
      agents: {
        ownership: 'explicit',
        defaults: {
          systemAgent: { agentId: 'main' },
          heartbeat: { agentId: 'research', every: '30m' },
        },
        entries: {
          main: { name: 'Main' },
          research: { name: 'Research' },
        },
      },
      talk: { agentId: 'research' },
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('research');

    const config = await readOpenClawJson();
    expect(config.agents).toEqual({
      defaults: {
        systemAgent: { agentId: 'main' },
        heartbeat: { every: '30m' },
      },
      entries: { main: { name: 'Main', workspace: resolve(testHome, '.openclaw/workspace-main') } },
    });
    expect(config).not.toHaveProperty('talk');
  });

  it('includes canonical per-agent main session keys in the snapshot', async () => {
    await writeOpenClawJson({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          mainSessionKey: 'agent:main:desk',
        }),
        expect.objectContaining({
          id: 'research',
          mainSessionKey: 'agent:research:desk',
        }),
      ]),
    );
  });

  it('does not reinterpret a current explicit main workspace when renaming an Agent', async () => {
    await writeOpenClawJson({ agents: {
      ownership: 'explicit', defaults: { workspace: '~/Fleet', systemAgent: { agentId: 'main' } },
      entries: { main: { name: 'Main' }, coder: { name: 'Coder' } },
    } });
    const { updateAgentName } = await import('@electron/utils/agent-config');
    const snapshot = await updateAgentName('main', 'Renamed');
    expect(snapshot.agents.find(({ id }) => id === 'main')?.workspace).toBe(resolve(testHome, 'Fleet/main'));
    expect((await readOpenClawJson()).agents).toMatchObject({ entries: { main: { name: 'Renamed' } } });
    expect((await readOpenClawJson()).agents).not.toHaveProperty('entries.main.workspace');
  });

  it.each(['authInheritance', 'sessionStore'])('refuses to delete an Agent that owns shared %s data', async (role) => {
    const config = { agents: {
      ownership: 'explicit', defaults: { [role]: { agentId: 'research' }, systemAgent: { agentId: 'main' } },
      entries: { main: {}, research: {} },
    } };
    await writeOpenClawJson(config);
    const runtimeDir = resolve(testHome, '.openclaw/agents/research/agent');
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, 'keep.txt'), 'Shared data');
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await expect(deleteAgentConfig('research')).rejects.toThrow(`owns agents.defaults.${role}`);
    expect(await readOpenClawJson()).toEqual(config);
    await expect(readFile(join(runtimeDir, 'keep.txt'), 'utf8')).resolves.toBe('Shared data');
  });

  it('keeps an unlisted main auth source when a roster collapses to a named singleton', async () => {
    await writeOpenClawJson({ agents: { ownership: 'explicit', entries: { researcher: {}, coder: {} } } });
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('coder');
    expect((await readOpenClawJson()).agents).toMatchObject({ defaults: { authInheritance: { agentId: 'main' } } });
  });

  it('pins the named singleton workspace and inherited credential owner when adding an Agent', async () => {
    await writeOpenClawJson({ agents: { entries: { researcher: { name: 'Researcher' } } } });
    const { createAgent } = await import('@electron/utils/agent-config');
    const snapshot = await createAgent('Coder');
    expect(snapshot.agents.find(({ id }) => id === 'researcher')?.workspace).toBe(resolve(testHome, '.openclaw/workspace'));
    expect((await readOpenClawJson()).agents).toMatchObject({ defaults: { authInheritance: { agentId: 'researcher' } } });
  });

  it('inherits bootstrap files from the current runtime main workspace, not the defaults base', async () => {
    const base = resolve(testHome, 'Fleet');
    await mkdir(join(base, 'main'), { recursive: true });
    await writeFile(join(base, 'SOUL.md'), 'Unused base');
    await writeFile(join(base, 'main', 'SOUL.md'), 'Actual main personality');
    await writeOpenClawJson({ agents: {
      ownership: 'explicit', defaults: { workspace: base, systemAgent: { agentId: 'main' } },
      entries: { main: {}, coder: {} },
    } });
    const { createAgent } = await import('@electron/utils/agent-config');
    await createAgent('Research', { inheritWorkspace: true });
    await expect(readFile(resolve(testHome, '.openclaw/workspace-research/SOUL.md'), 'utf8')).resolves.toBe('Actual main personality');
  });

  it('does not delete an unrelated managed directory when a removed Agent used an inherited external base', async () => {
    const unrelated = resolve(testHome, '.openclaw/workspace-coder');
    await mkdir(unrelated, { recursive: true });
    await writeFile(join(unrelated, 'keep.txt'), 'Unrelated');
    await writeOpenClawJson({ agents: {
      ownership: 'explicit', defaults: { workspace: '~/External', systemAgent: { agentId: 'main' } },
      entries: { main: {}, coder: {} },
    } });
    const { deleteAgentConfig, removeAgentWorkspaceDirectory } = await import('@electron/utils/agent-config');
    const { removedEntry } = await deleteAgentConfig('coder');
    expect(removedEntry.workspace).toBe(resolve(testHome, 'External/coder'));
    await expect(removeAgentWorkspaceDirectory(removedEntry)).resolves.toBeNull();
    await expect(readFile(join(unrelated, 'keep.txt'), 'utf8')).resolves.toBe('Unrelated');
  });

  it.each(['', 'nested'])('keeps a removed Agent workspace shared by a surviving Agent (%s)', async (suffix) => {
    const workspace = resolve(testHome, '.openclaw/workspace-coder');
    await mkdir(join(workspace, suffix), { recursive: true });
    await writeFile(join(workspace, 'keep.txt'), 'Shared workspace');
    await writeOpenClawJson({ agents: {
      ownership: 'explicit', defaults: { systemAgent: { agentId: 'main' } },
      entries: { main: { workspace: join(workspace, suffix) }, coder: {} },
    } });
    const { deleteAgentConfig, removeAgentWorkspaceDirectory } = await import('@electron/utils/agent-config');
    const { removedEntry } = await deleteAgentConfig('coder');
    await expect(removeAgentWorkspaceDirectory(removedEntry)).resolves.toBeNull();
    await expect(readFile(join(workspace, 'keep.txt'), 'utf8')).resolves.toBe('Shared workspace');
  });

  it('preserves a workspace referenced by another Agent through a directory link', async () => {
    const workspace = resolve(testHome, '.openclaw/workspace-coder');
    const link = resolve(testHome, 'linked-workspace');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'keep.txt'), 'Shared via link');
    await symlink(workspace, link, process.platform === 'win32' ? 'junction' : 'dir');
    await writeOpenClawJson({ agents: { entries: { main: { workspace: join(link, 'future-child') } } } });
    const { removeAgentWorkspaceDirectory } = await import('@electron/utils/agent-config');
    await expect(removeAgentWorkspaceDirectory({ id: 'coder', workspace })).resolves.toBeNull();
    await expect(readFile(join(workspace, 'keep.txt'), 'utf8')).resolves.toBe('Shared via link');
  });

  it('exposes effective and override model refs in the snapshot', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.6',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');

    expect(snapshot.defaultModelRef).toBe('moonshot/kimi-k2.6');
    expect(main).toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      overrideModelRef: null,
      inheritedModel: true,
      modelDisplay: 'kimi-k2.6',
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
      modelDisplay: 'ark-code-latest',
    });
  });

  it('updates and clears per-agent model overrides', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.6',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { listAgentsSnapshot, updateAgentModel } = await import('@electron/utils/agent-config');

    await updateAgentModel('coder', 'ark/ark-code-latest');
    let config = await readOpenClawJson();
    expect(config.agents).toEqual({
      defaults: {
        model: { primary: 'moonshot/kimi-k2.6' },
        systemAgent: { agentId: 'main' },
        heartbeat: { agentId: 'main' },
      },
      ownership: 'explicit',
      entries: {
        main: { name: 'Main', workspace: resolve(testHome, '.openclaw/workspace') },
        coder: { name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
      },
    });

    let snapshot = await listAgentsSnapshot();
    let snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
    });

    await updateAgentModel('coder', null);
    config = await readOpenClawJson();
    const coder = (config.agents as { entries: Record<string, { model?: unknown }> }).entries.coder;
    expect(coder).toEqual({ name: 'Coder' });

    snapshot = await listAgentsSnapshot();
    snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      overrideModelRef: null,
      inheritedModel: true,
    });
  });

  it('leaves compaction tuning to OpenClaw when selecting a per-agent model', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          openai: {
            models: [{ id: 'gpt-5.6-luna', contextWindow: 272_000 }],
          },
        },
      },
      agents: {
        defaults: {
          compaction: { mode: 'safeguard' },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');
    const snapshot = await updateAgentModel('coder', 'openai/gpt-5.6-luna');

    const config = await readOpenClawJson();
    const defaults = (config.agents as { defaults: { compaction: unknown } }).defaults;
    expect(defaults.compaction).toEqual({ mode: 'safeguard' });
    expect(snapshot.agents.find((agent) => agent.id === 'coder')?.contextWindow).toBe(272_000);
  });

  it('updates the effective context limit when returning to a subscription model', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          deepseek: {
            models: [{ id: 'deepseek-chat', contextWindow: 400_000 }],
          },
          openai: {
            api: 'openai-chatgpt-responses',
            models: [{ id: 'gpt-5.6-sol', contextWindow: 1_050_000 }],
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-5.6-sol' },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');
    let snapshot = await updateAgentModel('coder', 'deepseek/deepseek-chat');
    expect(snapshot.agents.find((agent) => agent.id === 'coder')?.contextWindow).toBe(400_000);

    snapshot = await updateAgentModel('coder', null);
    expect(snapshot.agents.find((agent) => agent.id === 'coder')).toMatchObject({
      modelRef: 'openai/gpt-5.6-sol',
      contextWindow: 272_000,
    });
    const config = await readOpenClawJson();
    expect((config.agents as { defaults: Record<string, unknown> }).defaults).not.toHaveProperty('compaction');
  });

  it('mutates the running coordinator snapshot instead of replacing it from the local file', async () => {
    await writeOpenClawJson({ localOnly: true });
    let runningConfig: Record<string, unknown> = {
      gatewayOnly: true,
      agents: {
        list: [{ id: 'main', name: 'Gateway Main', default: true }],
      },
    };
    const manager = {
      getStatus: vi.fn(() => ({ state: 'running' as const })),
      rpc: vi.fn(async (method: string, params: unknown) => {
        if (method === 'config.get') return { raw: JSON.stringify(runningConfig), hash: 'hash-1' };
        if (method === 'config.set') {
          runningConfig = JSON.parse((params as { raw: string }).raw) as Record<string, unknown>;
          return { ok: true };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }),
    };
    const { registerOpenClawConfigCoordinator } = await import('@electron/gateway/config-delivery');
    registerOpenClawConfigCoordinator(manager);
    const { updateAgentName } = await import('@electron/utils/agent-config');

    const snapshot = await updateAgentName('main', 'Coordinator Main');

    expect(runningConfig).toEqual({
      gatewayOnly: true,
      agents: { entries: { main: { name: 'Coordinator Main' } } },
    });
    expect(snapshot.agents[0].name).toBe('Coordinator Main');
    expect(await readOpenClawJson()).toEqual({ localOnly: true });
  });

  it('rejects invalid model ref formats when updating agent model', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');

    await expect(updateAgentModel('main', 'invalid-model-ref')).rejects.toThrow(
      'modelRef must be in "provider/model" format',
    );
  });

  it('prunes stale custom runtime model overrides when listing agents', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'minimax-portal': {
            baseUrl: 'https://api.minimax.io/anthropic',
            api: 'anthropic-messages',
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'minimax-portal/MiniMax-M3',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true, model: { primary: 'custom-custom0a/gpt-5.5' } },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');
    const mainEntry = ((config.agents as { list: Array<{ id: string; model?: unknown }> }).list)
      .find((agent) => agent.id === 'main');
    const coderEntry = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'coder');

    expect(main).toMatchObject({
      modelRef: 'minimax-portal/MiniMax-M3',
      overrideModelRef: null,
      inheritedModel: true,
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
    });
    expect(mainEntry?.model).toBeUndefined();
    expect(coderEntry?.model?.primary).toBe('ark/ark-code-latest');
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.7',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.openclaw/workspace-test2',
            agentDir: '~/.openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8',
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const {
      deleteAgentConfig,
      removeAgentWorkspaceDirectory,
    } = await import('@electron/utils/agent-config');

    const { snapshot, removedEntry } = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBe('main');

    const config = await readOpenClawJson();
    expect(Object.keys((config.agents as { entries: Record<string, unknown> }).entries)).toEqual([
      'main',
      'test3',
    ]);
    expect(config.bindings).toEqual([{ agentId: 'main', match: { channel: 'feishu', accountId: '*' } }]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    // The service removes the workspace after `deleteAgentConfig` commits, so the
    // config mutation leaves it in place for the caller.
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    await expect(removeAgentWorkspaceDirectory(removedEntry))
      .resolves.toBe(test2WorkspaceDir);
    await expect(access(test2WorkspaceDir)).rejects.toThrow();

    infoSpy.mockRestore();
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const {
      deleteAgentConfig,
      removeAgentWorkspaceDirectory,
    } = await import('@electron/utils/agent-config');

    const { removedEntry } = await deleteAgentConfig('test2');
    await expect(removeAgentWorkspaceDirectory(removedEntry)).resolves.toBeNull();

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not delete a legacy-named account when it is owned by another agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            test2: { enabled: true, appId: 'legacy-test2-app' },
          },
        },
      },
      bindings: [
        {
          agentId: 'test3',
          match: {
            channel: 'feishu',
            accountId: 'test2',
          },
        },
      ],
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const feishu = (config.channels as Record<string, unknown>).feishu as {
      accounts?: Record<string, unknown>;
    };
    expect(feishu.accounts?.test2).toBeDefined();
  });

  it('does not delete an account reassigned by a later binding', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        telegram: {
          accounts: {
            test2: { enabled: false, botToken: 'telegram-token' },
          },
        },
      },
      bindings: [
        { agentId: 'test2', match: { channel: 'telegram', accountId: 'test2' } },
        { agentId: 'test3', match: { channel: 'telegram', accountId: 'test2' } },
      ],
    });
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const telegram = (config.channels as Record<string, unknown>).telegram as {
      accounts?: Record<string, unknown>;
    };
    expect(telegram.accounts?.test2).toBeDefined();
  });

  it('deletes an owned account for a disabled channel with its agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        telegram: {
          enabled: false,
          defaultAccount: 'test2',
          accounts: {
            test2: { enabled: false, botToken: 'telegram-token' },
          },
          botToken: 'telegram-token',
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'telegram',
            accountId: 'test2',
          },
        },
      ],
    });
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    expect((config.channels as Record<string, unknown>).telegram).toBeUndefined();
  });

  it('migrates legacy plugin-only credentials while deleting the owned account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      bindings: [
        { agentId: 'test2', match: { channel: 'discord', accountId: 'test2' } },
        { agentId: 'test3', match: { channel: 'discord', accountId: 'test3' } },
      ],
      plugins: {
        allow: ['discord'],
        entries: {
          discord: {
            enabled: true,
            defaultAccount: 'test2',
            accounts: {
              test2: { enabled: true, token: 'discord-token-2' },
              test3: { enabled: true, token: 'discord-token-3' },
            },
          },
        },
      },
    });
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const discordChannel = (config.channels as {
      discord: Record<string, unknown>;
    }).discord;
    expect(discordChannel.defaultAccount).toBe('test3');
    expect(discordChannel.accounts).toEqual({
      test3: { enabled: true, token: 'discord-token-3' },
    });
    expect(discordChannel.token).toBe('discord-token-3');

    const discordPlugin = ((config.plugins as {
      entries: Record<string, Record<string, unknown>>;
    }).entries).discord;
    expect(discordPlugin).toEqual({ enabled: true });
    expect(JSON.stringify(config)).not.toContain('discord-token-2');
  });

  it('allows the same agent to bind multiple different channels', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('keeps sibling account bindings for the same agent and channel', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'feishu', 'alt');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['feishu:alt']).toBe('main');
  });

  it('uses a legacy channel binding for the default account alongside an explicit sibling account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
      bindings: [
        { agentId: 'main', match: { channel: 'feishu' } },
        { agentId: 'research', match: { channel: 'feishu', accountId: 'alt' } },
      ],
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['feishu:alt']).toBe('research');
  });

  it('atomically migrates a legacy binding while assigning a scoped sibling account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'alt', name: 'Alt' },
        ],
      },
      bindings: [
        { agentId: 'main', match: { channel: 'feishu' } },
      ],
    });
    const { ensureScopedChannelBinding } = await import('@electron/utils/agent-config');

    await ensureScopedChannelBinding('feishu', 'alt');

    const config = await readOpenClawJson();
    expect(config.bindings).toEqual([
      { agentId: 'main', match: { channel: 'feishu', accountId: 'default' } },
      { agentId: 'alt', match: { channel: 'feishu', accountId: 'alt' } },
    ]);
  });

  it('preserves original agentId casing when persisting bindings', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'MainAgent', name: 'Main Agent', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('MainAgent', 'feishu', 'default');

    const config = await readOpenClawJson();
    expect(config.bindings).toEqual([
      {
        agentId: 'MainAgent',
        match: { channel: 'feishu', accountId: 'default' },
      },
    ]);
  });

  it('keeps a single owner for the same channel account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('test2', 'feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('test2');
  });

  it('can clear one channel account binding without affecting another channel on the same agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, clearChannelBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');
    await clearChannelBinding('feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('avoids numeric-only ids when creating agents from CJK names', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { createAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await createAgent('测试2');
    await createAgent('测试1');

    const snapshot = await listAgentsSnapshot();
    const agentIds = snapshot.agents.map((agent) => agent.id);

    expect(agentIds).toContain('agent');
    expect(agentIds).toContain('agent-2');
    expect(agentIds).not.toContain('2');
    expect(agentIds).not.toContain('1');
  });

  it('seeds a default ClawX IDENTITY.md for newly created agent workspaces', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { createAgent } = await import('@electron/utils/agent-config');

    await createAgent('Research');

    await expect(readFile(join(testHome, '.openclaw', 'workspace-research', 'IDENTITY.md'), 'utf8')).resolves.toContain('ClawX');
  });

  it('rolls back a committed agent entry when filesystem provisioning fails', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });
    const blockedWorkspace = join(testHome, '.openclaw', 'workspace-research');
    await writeFile(blockedWorkspace, 'pre-existing file', 'utf8');
    const { createAgent } = await import('@electron/utils/agent-config');

    await expect(createAgent('Research')).rejects.toThrow();

    const config = await readOpenClawJson();
    const agents = config.agents as { entries: Record<string, unknown>; ownership?: string };
    expect(Object.keys(agents.entries)).toEqual(['main']);
    expect(agents.ownership).toBeUndefined();
    await expect(readFile(blockedWorkspace, 'utf8')).resolves.toBe('pre-existing file');
    await expect(access(join(testHome, '.openclaw', 'agents', 'research'))).rejects.toThrow();
  });

  it('does not delete a pre-existing dangling workspace symlink during provisioning rollback', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });
    const workspaceLink = join(testHome, '.openclaw', 'workspace-research');
    await symlink(resolve(testHome, 'missing-workspace-target'), workspaceLink, process.platform === 'win32' ? 'junction' : 'dir');
    const { createAgent } = await import('@electron/utils/agent-config');

    await expect(createAgent('Research')).rejects.toThrow();

    await expect(lstat(workspaceLink)).resolves.toMatchObject({});
    expect((await lstat(workspaceLink)).isSymbolicLink()).toBe(true);
    const config = await readOpenClawJson();
    expect(Object.keys((config.agents as { entries: Record<string, unknown> }).entries)).toEqual(['main']);
  });
});
