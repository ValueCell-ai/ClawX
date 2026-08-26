import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_CWD,
  formatWorkspacePath,
  getSessionWorkspaceForGrouping,
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
  normalizeWorkspacePath,
  resolveEffectiveWorkspace,
} from '@/lib/workspace-context';

describe('workspace context helpers', () => {
  it('recognizes default workspace spellings', () => {
    expect(DEFAULT_WORKSPACE_CWD).toBe('~/.openclaw/workspace');
    expect(isDefaultWorkspacePath('~/.openclaw/workspace')).toBe(true);
    expect(isDefaultWorkspacePath('/Users/alex/.openclaw/workspace')).toBe(true);
    expect(isDefaultWorkspacePath('/home/alex/.openclaw/workspace')).toBe(true);
    expect(isDefaultWorkspacePath('C:/Users/alex/.openclaw/workspace')).toBe(true);
    expect(isDefaultWorkspacePath('/Users/alex/workspace/ClawX')).toBe(false);
  });

  it('preserves root-like paths while trimming ordinary trailing separators', () => {
    expect(normalizeWorkspacePath('C:/')).toBe('C:/');
    expect(normalizeWorkspacePath('C:\\')).toBe('C:\\');
    expect(normalizeWorkspacePath('//')).toBe('/');
    expect(normalizeWorkspacePath('\\\\')).toBe('/');
    expect(normalizeWorkspacePath('/repo/project/')).toBe('/repo/project');
  });

  it('pins the canonical default session when stale ACP metadata reports another workspace', () => {
    expect(resolveEffectiveWorkspace({
      session: {
        key: 'agent:main:main',
        workspacePath: '/repo/code2',
        createdLocally: true,
      },
      globalWorkspace: '/repo/code2',
      defaultWorkspace: DEFAULT_WORKSPACE_CWD,
    })).toEqual({ cwd: DEFAULT_WORKSPACE_CWD, source: 'default', readOnly: true });

    expect(getSessionWorkspaceForGrouping({
      key: 'agent:main:main',
      workspacePath: '/repo/code2',
      createdLocally: true,
    }, '/repo/code2')).toBe(DEFAULT_WORKSPACE_CWD);
  });

  it('uses OpenClaw session cwd before global workspace', () => {
    expect(resolveEffectiveWorkspace({
      session: { workspacePath: '/repo/from-openclaw' },
      globalWorkspace: '/repo/global',
    })).toEqual({ cwd: '/repo/from-openclaw', source: 'session', readOnly: true });
  });

  it('uses global workspace for unbound local sessions', () => {
    expect(resolveEffectiveWorkspace({
      session: { createdLocally: true },
      globalWorkspace: '/repo/global',
    })).toEqual({ cwd: '/repo/global', source: 'global', readOnly: false });
  });

  it('falls back to default for sessions without recoverable cwd', () => {
    expect(resolveEffectiveWorkspace({
      session: { key: 'agent:main:session-old' },
      globalWorkspace: '/repo/global',
    })).toEqual({ cwd: DEFAULT_WORKSPACE_CWD, source: 'default', readOnly: true });
  });

  it('formats labels for default and non-default workspaces', () => {
    expect(getWorkspaceDisplayLabel('~/.openclaw/workspace', '默认工作空间')).toBe('默认工作空间');
    expect(getWorkspaceDisplayLabel('/Users/alex/workspace/ClawX', '默认工作空间')).toBe('ClawX');
    expect(getWorkspaceDisplayLabel(
      '/Users/alex/workspace/ClawX',
      '默认工作空间',
      { '/Users/alex/workspace/ClawX': '我的项目' },
    )).toBe('我的项目');
    expect(formatWorkspacePath('/home/alex/project')).toBe('~/project');
  });

  it('derives short default workspace labels from the final folder name', () => {
    expect(getWorkspaceDisplayLabel('/Users/alex/Documents/FDE/端界智能', '默认工作空间')).toBe('端界智能');
    expect(getWorkspaceDisplayLabel('/Users/alex/Documents/FDE/天成/财务部/苏州/发票', '默认工作空间')).toBe('发票');
  });

  it('disambiguates duplicate workspace folder names with numeric suffixes', () => {
    const paths = [
      '/Users/alex/Documents/FDE/z/发票',
      '/Users/alex/Documents/FDE/a/发票',
    ];

    expect(getWorkspaceDisplayLabel(paths[0], '默认工作空间', {}, paths)).toBe('发票');
    expect(getWorkspaceDisplayLabel(paths[1], '默认工作空间', {}, paths)).toBe('发票1');
  });

  it('uses a numeric suffix when a custom label occupies the original name', () => {
    const paths = [
      '/Users/alex/Documents/FDE/天成/财务部/苏州/发票',
      '/Users/alex/Documents/FDE/其他/发票',
    ];

    expect(getWorkspaceDisplayLabel(
      paths[0],
      '默认工作空间',
      { [paths[1]]: '发票' },
      paths,
    )).toBe('发票1');
  });

  it('groups sessions without cwd under default workspace', () => {
    expect(getSessionWorkspaceForGrouping({ key: 'agent:main:session-a' })).toBe(DEFAULT_WORKSPACE_CWD);
    expect(getSessionWorkspaceForGrouping({ key: 'agent:main:session-b', workspacePath: '/real/cwd' })).toBe('/real/cwd');
  });
});
