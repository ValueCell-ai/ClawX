import { describe, expect, it } from 'vitest';

import { groupSessionsByWorkspace } from '@/components/layout/session-buckets';

describe('workspace session grouping', () => {
  it('groups by workspace and sorts sessions by activity inside each workspace', () => {
    const nowMs = new Date('2026-07-07T12:00:00Z').getTime();
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-a', workspacePath: '/repo/a', updatedAt: nowMs - 60_000 },
        { key: 'agent:main:session-b', workspacePath: '/repo/b', updatedAt: nowMs - 2 * 24 * 60 * 60 * 1000 },
        { key: 'agent:main:session-c', workspacePath: '/repo/a', updatedAt: nowMs - 10 * 24 * 60 * 60 * 1000 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo/a', '/repo/b']);
    expect(groups[0].sessions.map((entry) => entry.session.key)).toEqual(['agent:main:session-a', 'agent:main:session-c']);
    expect(groups[0].sessions.map((entry) => entry.activityMs)).toEqual([nowMs - 60_000, nowMs - 10 * 24 * 60 * 60 * 1000]);
  });

  it('puts the default workspace first even when another workspace has newer activity', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-project', workspacePath: '/repo/z', updatedAt: 20 },
        { key: 'agent:main:session-default', updatedAt: 10 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual(['~/.openclaw/workspace', '/repo/z']);
    expect(groups[0].label).toBe('默认工作空间');
  });

  it('sorts non-default workspaces by natural label order', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-b', workspacePath: '/repo/project-10', updatedAt: 30 },
        { key: 'agent:main:session-a', workspacePath: '/repo/project-2', updatedAt: 20 },
        { key: 'agent:main:session-c', workspacePath: '/repo/project-1', updatedAt: 10 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual([
      '/repo/project-1',
      '/repo/project-2',
      '/repo/project-10',
    ]);
  });

  it('groups locally-created sessions without cwd under the selected global workspace', () => {
    const groups = groupSessionsByWorkspace(
      [{ key: 'agent:main:session-pending', createdLocally: true, updatedAt: 1 }],
      {},
      '默认工作空间',
      '/repo/global',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('/repo/global');
  });

  it('uses custom workspace labels without changing path-based grouping', () => {
    const groups = groupSessionsByWorkspace(
      [{ key: 'agent:main:session-project', workspacePath: '/repo/project', updatedAt: 1 }],
      {},
      '默认工作空间',
      undefined,
      { '/repo/project': '产品项目' },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('/repo/project');
    expect(groups[0].label).toBe('产品项目');
  });

  it('groups default-equivalent workspace paths with sessions missing cwd', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-no-cwd', updatedAt: 2 },
        { key: 'agent:main:session-default-path', workspacePath: '/Users/alex/.openclaw/workspace', updatedAt: 1 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('~/.openclaw/workspace');
    expect(groups[0].label).toBe('默认工作空间');
  });
});
