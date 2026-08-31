import type { SessionInfo } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';

import {
  isNativeAcpSubagentSessionId,
  parseAcpSessionParentId,
  projectAcpSessionFamily,
} from '@/lib/acp/subagent-lineage';
import type {
  AcpSessionFamilyMember,
  AcpSessionFamilyPayload,
  AcpSessionFamilyResult,
} from '@shared/acp-chat/types';

function session(
  sessionId: string,
  options: Partial<Omit<SessionInfo, 'sessionId' | 'cwd'>> = {},
): SessionInfo {
  return {
    sessionId,
    cwd: '/workspace',
    title: sessionId,
    ...options,
  };
}

describe('ACP subagent lineage', () => {
  it('prefers a valid parentSessionId and falls back to spawnedBy when it is absent or invalid', () => {
    expect(parseAcpSessionParentId(session('agent:main:subagent:child', {
      _meta: {
        parentSessionId: 'agent:main:parent',
        spawnedBy: 'agent:main:stale-parent',
      },
    }))).toBe('agent:main:parent');

    expect(parseAcpSessionParentId(session('agent:main:subagent:legacy-child', {
      _meta: { spawnedBy: 'agent:main:legacy-parent' },
    }))).toBe('agent:main:legacy-parent');

    for (const parentSessionId of [42, '   ', 'agent:main:subagent:child']) {
      expect(parseAcpSessionParentId(session('agent:main:subagent:child', {
        _meta: {
          parentSessionId,
          spawnedBy: 'agent:main:fallback-parent',
        },
      }))).toBe('agent:main:fallback-parent');
    }
  });

  it('preserves opaque IDs exactly while rejecting blank and self-referential candidates', () => {
    expect(parseAcpSessionParentId(session('agent:main:subagent:child', {
      _meta: { parentSessionId: '  agent:main:parent  ' },
    }))).toBe('  agent:main:parent  ');
    expect(parseAcpSessionParentId(session('  agent:main:subagent:child  ', {
      _meta: { parentSessionId: '  agent:main:subagent:child  ' },
    }))).toBeNull();
    expect(parseAcpSessionParentId(session('agent:main:subagent:child', {
      _meta: { parentSessionId: '   ', spawnedBy: '\t' },
    }))).toBeNull();
    expect(parseAcpSessionParentId(session('agent:main:subagent:child', {
      _meta: { parentSessionId: 42, spawnedBy: false },
    }))).toBeNull();
    expect(parseAcpSessionParentId(session('agent:main:subagent:child', {
      _meta: ['agent:main:parent'] as unknown as Record<string, unknown>,
    }))).toBeNull();
    expect(parseAcpSessionParentId(session('agent:main:subagent:child'))).toBeNull();
  });

  it('classifies only exact native subagent session IDs', () => {
    expect(isNativeAcpSubagentSessionId('agent:main:subagent:child-1')).toBe(true);
    expect(isNativeAcpSubagentSessionId('agent:research:subagent:child-2')).toBe(true);
    expect(isNativeAcpSubagentSessionId('agent:main:acp:child-1')).toBe(false);
    expect(isNativeAcpSubagentSessionId('agent:main:subagent:child:extra')).toBe(false);
    expect(isNativeAcpSubagentSessionId('agent::subagent:child-1')).toBe(false);
    expect(isNativeAcpSubagentSessionId('agent:main:subagent:')).toBe(false);
  });

  it('projects only the requested session and its direct native children in stable order', () => {
    const current = session('agent:main:parent', {
      title: 'Parent conversation',
      updatedAt: '2026-09-01T09:00:00.000Z',
    });
    const result = projectAcpSessionFamily('agent:main:parent', [
      session('agent:main:subagent:z-child', {
        title: 'Z child',
        updatedAt: '2026-09-01T11:00:00.000Z',
        _meta: { spawnedBy: 'agent:main:parent' },
      }),
      session('agent:main:subagent:nested', {
        _meta: { parentSessionId: 'agent:main:subagent:a-child' },
      }),
      session('agent:main:acp:not-native', {
        _meta: { parentSessionId: 'agent:main:parent' },
      }),
      session('agent:main:subagent:b-child', {
        title: null,
        updatedAt: '2026-09-01T12:00:00.000Z',
        _meta: { parentSessionId: 'agent:main:parent' },
      }),
      session('agent:main:subagent:a-child', {
        title: 'A child',
        updatedAt: '2026-09-01T12:00:00.000Z',
        _meta: { parentSessionId: 'agent:main:parent' },
      }),
      session('agent:main:subagent:other-family', {
        _meta: { parentSessionId: 'agent:main:other-parent' },
      }),
      current,
    ]);

    expect(result).toEqual({
      success: true,
      current: {
        sessionKey: 'agent:main:parent',
        title: 'Parent conversation',
        updatedAt: '2026-09-01T09:00:00.000Z',
        parentSessionKey: null,
      },
      children: [
        {
          sessionKey: 'agent:main:subagent:a-child',
          title: 'A child',
          updatedAt: '2026-09-01T12:00:00.000Z',
          parentSessionKey: 'agent:main:parent',
        },
        {
          sessionKey: 'agent:main:subagent:b-child',
          title: 'agent:main:subagent:b-child',
          updatedAt: '2026-09-01T12:00:00.000Z',
          parentSessionKey: 'agent:main:parent',
        },
        {
          sessionKey: 'agent:main:subagent:z-child',
          title: 'Z child',
          updatedAt: '2026-09-01T11:00:00.000Z',
          parentSessionKey: 'agent:main:parent',
        },
      ],
    });
  });

  it('returns the immediate native parent for a nested selected child', () => {
    const directParentKey = 'agent:main:subagent:direct-parent';
    const nestedChildKey = 'agent:main:subagent:nested-child';
    const result = projectAcpSessionFamily(nestedChildKey, [
      session('agent:main:root'),
      session(directParentKey, { _meta: { parentSessionId: 'agent:main:root' } }),
      session(nestedChildKey, { _meta: { parentSessionId: directParentKey } }),
    ]);

    expect(result.current?.parentSessionKey).toBe(directParentKey);
    expect(result.children).toEqual([]);
  });

  it('deduplicates current and direct-child IDs from overlapping cursor pages', () => {
    const current = session('agent:main:parent', { title: 'First parent row' });
    const child = session('agent:main:subagent:child', {
      title: 'First child row',
      _meta: { parentSessionId: current.sessionId },
    });

    const result = projectAcpSessionFamily(current.sessionId, [
      current,
      child,
      session(current.sessionId, { title: 'Overlapping parent row' }),
      session(child.sessionId, {
        title: 'Overlapping child row',
        _meta: { parentSessionId: current.sessionId },
      }),
    ]);

    expect(result.current?.title).toBe('First parent row');
    expect(result.children.map((member) => member.sessionKey)).toEqual([child.sessionId]);
    expect(result.children[0]?.title).toBe('First child row');
  });

  it('sorts timestamps chronologically and breaks ties by session-key code point', () => {
    const parentSessionId = 'agent:main:parent';
    const result = projectAcpSessionFamily(parentSessionId, [
      session(parentSessionId),
      session('agent:main:subagent:a-child', {
        updatedAt: '2026-09-01T11:00:00.000Z',
        _meta: { parentSessionId },
      }),
      session('agent:main:subagent:offset-child', {
        updatedAt: '2026-09-01T12:00:00.000+02:00',
        _meta: { parentSessionId },
      }),
      session('agent:main:subagent:Z-child', {
        updatedAt: '2026-09-01T13:00:00.000+02:00',
        _meta: { parentSessionId },
      }),
    ]);

    expect(result.children.map((member) => member.sessionKey)).toEqual([
      'agent:main:subagent:Z-child',
      'agent:main:subagent:a-child',
      'agent:main:subagent:offset-child',
    ]);
  });

  it('exposes one shared payload, member, and discriminated result contract', () => {
    type HasFailureBranch = Extract<AcpSessionFamilyResult, { success: false }> extends never
      ? false
      : true;
    const payload = { sessionKey: 'agent:main:parent' } satisfies AcpSessionFamilyPayload;
    const member = {
      sessionKey: payload.sessionKey,
      title: 'Parent',
      updatedAt: null,
      parentSessionKey: null,
    } satisfies AcpSessionFamilyMember;
    const result = {
      success: true,
      current: member,
      children: [],
    } satisfies AcpSessionFamilyResult;
    const failure = {
      success: false,
      current: null,
      children: [],
      error: 'ACP session listing failed',
    } satisfies AcpSessionFamilyResult;
    const hasFailureBranch: HasFailureBranch = true;

    expect(result.current).toBe(member);
    expect(failure.error).toBe('ACP session listing failed');
    expect(hasFailureBranch).toBe(true);
  });
});
