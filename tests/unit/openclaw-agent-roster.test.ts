import { describe, expect, it } from 'vitest';
import { join, resolve } from 'path';
import {
  listOpenClawAgentEntryRecords,
  listOpenClawAgentRosterEntries,
  resolveLegacyOpenClawAgentWorkspaceDir,
  resolveOpenClawAgentWorkspaceDir,
  resolveOpenClawLegacyDataOwnerAgentId,
} from '@electron/utils/openclaw-agent-roster';

describe('openclaw agent roster', () => {
  it('reads keyed agents.entries with ids from their keys', () => {
    const agents = {
      entries: {
        main: { name: 'Main' },
        coder: { name: 'Coder' },
        broken: 'not-an-entry',
      },
    };

    expect(listOpenClawAgentRosterEntries(agents)).toEqual([
      { id: 'main', entry: { name: 'Main' } },
      { id: 'coder', entry: { name: 'Coder' } },
    ]);
  });

  it('falls back to the legacy agents.list array', () => {
    const agents = { list: [{ id: 'main', default: true }, null, { id: 'coder' }] };

    expect(listOpenClawAgentRosterEntries(agents)).toEqual([
      { id: 'main', entry: { id: 'main', default: true } },
      { id: 'coder', entry: { id: 'coder' } },
    ]);
  });

  it('returns the live entry objects so callers can edit them in place', () => {
    const config = { agents: { entries: { main: { model: { primary: 'stale/model' } } } } };

    for (const entry of listOpenClawAgentEntryRecords(config.agents)) delete entry.model;

    expect(config.agents.entries.main).toEqual({});
  });

  it('treats missing or malformed rosters as empty', () => {
    expect(listOpenClawAgentEntryRecords(undefined)).toEqual([]);
    expect(listOpenClawAgentEntryRecords({ entries: [] })).toEqual([]);
    expect(listOpenClawAgentEntryRecords({ entries: null, list: [{ id: 'stale' }] })).toEqual([]);
  });
});

describe('effective OpenClaw Agent workspace', () => {
  const homeDir = resolve('test-fixtures', 'isolated-home');
  const stateDir = join(homeDir, '.openclaw');
  const base = join(homeDir, 'projects');
  const options = { homeDir, env: {} };

  it.each([
    ['absent roster', undefined, 'main', join(stateDir, 'workspace')],
    ['named singleton', { entries: { research: {} } }, 'research', join(stateDir, 'workspace')],
    ['explicit singleton', { ownership: 'explicit', entries: { research: {} } }, 'research', join(stateDir, 'workspace')],
    ['implicit fleet main', { entries: { main: {}, coder: {} } }, 'main', join(stateDir, 'workspace-main')],
    ['fleet inherited base', { defaults: { workspace: base }, entries: { main: {}, coder: {} } }, 'coder', join(base, 'coder')],
    ['system owner is not legacy owner', { ownership: 'explicit', defaults: { workspace: base, systemAgent: { agentId: 'main' } }, entries: { main: {}, coder: {} } }, 'main', join(base, 'main')],
    ['legacy default marker', { defaults: { workspace: base }, list: [{ id: 'coder' }, { id: 'research', default: true }] }, 'research', base],
    ['explicit ownership ignores default marker', { ownership: 'explicit', defaults: { workspace: base }, entries: { main: { default: true }, coder: {} } }, 'main', join(base, 'main')],
    ['ambiguous legacy marker', { defaults: { workspace: base }, list: [{ id: 'main', default: true }, { id: 'coder', default: true }] }, 'main', join(base, 'main')],
    ['explicit workspace wins', { defaults: { workspace: base }, entries: { main: { workspace: '~/项目 Alpha' }, coder: {} } }, 'main', join(homeDir, '项目 Alpha')],
  ])('%s follows current runtime ownership', (_name, agents, id, expected) => {
    expect(resolveOpenClawAgentWorkspaceDir(agents, id as string, options)).toBe(expected);
  });

  it('preserves the old default before converting an unmarked legacy fleet', () => {
    const agents = { defaults: { workspace: base }, list: [{ id: 'research' }, { id: 'coder' }] };
    expect(resolveLegacyOpenClawAgentWorkspaceDir(agents, 'research', options)).toBe(base);
    expect(resolveLegacyOpenClawAgentWorkspaceDir(agents, 'coder', options)).toBe(join(base, 'coder'));
    expect(resolveOpenClawAgentWorkspaceDir(agents, 'research', options)).toBe(join(base, 'research'));
    expect(resolveOpenClawAgentWorkspaceDir({ entries: { research: {}, coder: {} } }, 'research', options))
      .toBe(join(stateDir, 'workspace-research'));
  });

  it('uses the marked old default even when it is not first', () => {
    const agents = { list: [{ id: 'main' }, { id: 'research', default: true }] };
    expect(resolveLegacyOpenClawAgentWorkspaceDir(agents, 'research', options)).toBe(join(stateDir, 'workspace'));
    expect(resolveLegacyOpenClawAgentWorkspaceDir(agents, 'main', options)).toBe(join(stateDir, 'workspace-main'));
  });

  it('distinguishes absent and explicitly empty or malformed rosters', () => {
    expect(resolveOpenClawLegacyDataOwnerAgentId(undefined)).toBe('main');
    expect(resolveOpenClawLegacyDataOwnerAgentId({ entries: {} })).toBeUndefined();
    expect(resolveOpenClawLegacyDataOwnerAgentId({ list: [] })).toBeUndefined();
    expect(resolveOpenClawLegacyDataOwnerAgentId({ entries: null, list: [{ id: 'main' }] })).toBeUndefined();
  });

  it('resolves profile defaults separately for the shipped old and current runtimes', () => {
    const profiled = { homeDir, env: { OPENCLAW_PROFILE: ' Work ' } };
    expect(resolveLegacyOpenClawAgentWorkspaceDir(undefined, 'main', profiled)).toBe(join(stateDir, 'workspace-Work'));
    expect(resolveOpenClawAgentWorkspaceDir(undefined, 'main', profiled)).toBe(join(homeDir, '.openclaw-Work', 'workspace'));
    expect(resolveOpenClawAgentWorkspaceDir(undefined, 'main', { homeDir, env: { OPENCLAW_PROFILE: 'DEFAULT' } }))
      .toBe(join(stateDir, 'workspace'));
  });

  it('honors environment override precedence without changing fleet workspace rules', () => {
    const env = { OPENCLAW_STATE_DIR: '~/runtime', OPENCLAW_WORKSPACE_DIR: join(homeDir, 'override'), OPENCLAW_PROFILE: 'work' };
    expect(resolveOpenClawAgentWorkspaceDir(undefined, 'main', { homeDir, env })).toBe(env.OPENCLAW_WORKSPACE_DIR);
    delete (env as Partial<typeof env>).OPENCLAW_WORKSPACE_DIR;
    expect(resolveOpenClawAgentWorkspaceDir(undefined, 'main', { homeDir, env })).toBe(join(homeDir, 'runtime', 'workspace'));
    expect(resolveLegacyOpenClawAgentWorkspaceDir(undefined, 'main', { homeDir, env })).toBe(join(stateDir, 'workspace-work'));
    expect(resolveOpenClawAgentWorkspaceDir({ entries: { main: {}, coder: {} } }, 'coder', { homeDir, env }))
      .toBe(join(homeDir, 'runtime', 'workspace-coder'));
  });

  it('normalizes identifiers and paths like the runtime without mutating config', () => {
    const agents = { entries: { 'Coder-': { workspace: ' ~/项目 Alpha\0 ' }, main: {} } };
    expect(resolveOpenClawAgentWorkspaceDir(agents, ' CODER- ', options)).toBe(join(homeDir, '项目 Alpha'));
    expect(agents.entries['Coder-'].workspace).toBe(' ~/项目 Alpha\0 ');
    expect(resolveOpenClawAgentWorkspaceDir({ entries: { 'Coder-': {}, main: {} } }, ' CODER- ', options))
      .toBe(join(stateDir, 'workspace-coder-'));
  });
});
