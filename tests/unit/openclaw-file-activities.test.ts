import { describe, expect, it } from 'vitest';
import { buildAcpTurnFileChanges, projectOpenClawFileActivities } from '@/lib/acp/openclaw-file-activities';
import projectionSource from '@/lib/acp/openclaw-file-activities.ts?raw';
import { createEmptyAcpTimeline } from '@/lib/acp/reducer';
import type { AcpTimelineSnapshot, TimelineItem, ToolCallItem } from '@/lib/acp/timeline-types';

const POSIX_CONTEXT = {
  workspaceRoot: '/workspace',
  executionCwd: '/workspace/project',
};

function tool(overrides: Partial<ToolCallItem> & Pick<ToolCallItem, 'toolCallId' | 'title'>): ToolCallItem {
  return {
    kind: 'tool-call',
    id: `tool:${overrides.toolCallId}`,
    status: 'completed',
    outputParts: [],
    locations: [],
    ...overrides,
  };
}

function user(id: string): TimelineItem {
  return {
    kind: 'message-segment',
    id,
    role: 'user',
    messageId: id,
    segmentIndex: 0,
    parts: [{ kind: 'markdown', text: id }],
  };
}

function timeline(items: TimelineItem[]): AcpTimelineSnapshot {
  const snapshot = createEmptyAcpTimeline('agent:main:test', 1);
  return {
    ...snapshot,
    itemOrder: items.map((item) => item.id),
    itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
  };
}

function project(items: TimelineItem[], context = POSIX_CONTEXT) {
  return projectOpenClawFileActivities({ timeline: timeline(items), ...context });
}

describe('projectOpenClawFileActivities', () => {
  it('does not import Node builtins into the sandboxed Renderer', () => {
    expect(projectionSource).not.toMatch(/from\s+['"]node:/);
  });

  it('normalizes exact title prefixes and rejects unsupported or malformed near-matches', () => {
    const accepted = [
      tool({ toolCallId: 'write', title: 'write: a', input: { path: 'write.txt', content: 'x' } }),
      tool({ toolCallId: 'edit', title: '  EdIt  : b', input: { path: 'edit.txt', oldText: 'a', newText: 'b' } }),
      tool({ toolCallId: 'patch', title: 'APPLY_PATCH: c', input: { input: '*** Begin Patch\n*** Add File: patch.txt\n+x\n*** End Patch' } }),
    ];
    const rejected = ['WriteFile: x', 'rewrite: x', 'read: x', 'exec: x', 'write file: x', 'write x'];
    const result = project([
      ...accepted,
      ...rejected.map((title, index) => tool({
        toolCallId: `rejected-${index}`,
        title,
        input: { path: `rejected-${index}.txt`, content: 'x' },
      })),
    ]);

    expect(result.activities.map((activity) => activity.toolName)).toEqual(['write', 'edit', 'apply_patch']);
    expect(result.fileGroups.map((group) => group.relativePath)).toEqual([
      'project/write.txt',
      'project/edit.txt',
      'project/patch.txt',
    ]);
  });

  it('projects only completed calls and ignores output, output parts, and locations', () => {
    const calls: ToolCallItem[] = (['pending', 'running', 'failed'] as const).map((status) => tool({
      toolCallId: status,
      title: 'write: ignored',
      status,
      input: { path: `${status}.txt`, content: 'x' },
    }));
    calls.push(tool({
      toolCallId: 'no-input',
      title: 'write: ignored evidence',
      output: { path: 'output.txt', content: 'x' },
      outputParts: [{ kind: 'file', path: '/workspace/output-part.txt' }],
      locations: [{ path: '/workspace/location.txt' }],
    }));

    expect(project(calls).activities).toEqual([]);
  });

  it('uses canonical path alias precedence and retains path-only Writes', () => {
    const result = project([
      tool({
        toolCallId: 'aliases',
        title: 'write: aliases',
        input: { path: 'path.txt', file_path: 'file-path.txt', filePath: 'filePath.txt', file: 'file.txt' },
      }),
    ]);

    expect(result.activities).toMatchObject([{
      relativePath: 'project/path.txt',
      action: 'created',
      fragments: [],
    }]);
    expect(Object.values(result.turnSummariesByTurnId)[0]).toMatchObject([{
      relativePath: 'project/path.txt',
      added: null,
      removed: null,
    }]);
  });

  it('turns Write content into an empty-to-new created fragment with diffLines counts', () => {
    const result = project([
      tool({ toolCallId: 'write', title: 'WRITE: file', input: { file_path: 'file.txt', content: 'one\r\ntwo\r\n' } }),
    ]);

    expect(result.activities[0]).toMatchObject({
      action: 'created',
      fragments: [{ oldText: '', newText: 'one\r\ntwo\r\n' }],
    });
    expect(Object.values(result.turnSummariesByTurnId)[0]).toMatchObject([{ added: 2, removed: 0 }]);
  });

  it('accepts only canonical array and top-level Edit pairs and skips invalid entries', () => {
    const result = project([
      tool({
        toolCallId: 'array',
        title: 'edit: array',
        input: {
          path: 'array.txt',
          edits: [
            { oldText: 'one', newText: 'two' },
            { oldText: 'missing new' },
            { oldText: '', newText: '' },
          ],
          oldText: 'top old',
          newText: 'top new',
        },
      }),
      tool({
        toolCallId: 'top',
        title: 'edit: top',
        input: { filePath: 'top.txt', oldText: 'old', newText: 'new' },
      }),
      tool({
        toolCallId: 'aliases',
        title: 'edit: unsupported aliases',
        input: { file: 'aliases.txt', old_string: 'old', new_string: 'new' },
      }),
    ]);

    expect(result.activities.map((activity) => activity.fragments)).toEqual([
      [
        expect.objectContaining({ oldText: 'one', newText: 'two' }),
        expect.objectContaining({ oldText: '', newText: '' }),
        expect.objectContaining({ oldText: 'top old', newText: 'top new' }),
      ],
      [expect.objectContaining({ oldText: 'old', newText: 'new' })],
      [],
    ]);
    expect(Object.values(result.turnSummariesByTurnId)[0]?.[2]).toMatchObject({ added: null, removed: null });
  });

  it('parses Add, Update, Delete, Move, CRLF, wrappers, chunks, empty context, and End of File', () => {
    const patch = [
      '<<\'EOF\'',
      '*** Begin Patch',
      '*** Add File: add.txt',
      '+first',
      '+second',
      '*** Update File: update.txt',
      '-old',
      '+new',
      '',
      '@@ later',
      ' context',
      '-gone',
      '+added',
      '*** End of File',
      '*** Delete File: delete.txt',
      '*** Update File: old-name.txt',
      '*** Move to: new-name.txt',
      '@@',
      '-before',
      '+after',
      '*** End Patch',
      'EOF',
    ].join('\r\n');
    const result = project([
      tool({ toolCallId: 'patch', title: 'apply_patch: files', input: { input: patch } }),
    ]);

    expect(result.activities.map(({ relativePath, action, fragments }) => ({ relativePath, action, fragments }))).toEqual([
      {
        relativePath: 'project/add.txt',
        action: 'created',
        fragments: [expect.objectContaining({ oldText: '', newText: 'first\nsecond\n' })],
      },
      {
        relativePath: 'project/update.txt',
        action: 'modified',
        fragments: [
          expect.objectContaining({ oldText: 'old\n', newText: 'new\n' }),
          expect.objectContaining({ oldText: 'context\ngone', newText: 'context\nadded' }),
        ],
      },
      { relativePath: 'project/delete.txt', action: 'deleted', fragments: [] },
      { relativePath: 'project/old-name.txt', action: 'deleted', fragments: [] },
      {
        relativePath: 'project/new-name.txt',
        action: 'created',
        fragments: [expect.objectContaining({ oldText: 'before', newText: 'after' })],
      },
    ]);
  });

  it.each(['<<EOF', '<<"EOF"'])('accepts the %s apply-patch wrapper', (wrapper) => {
    const patch = `${wrapper}\n*** Begin Patch\n*** Add File: wrapped.txt\n+x\n*** End Patch\nEOF`;
    expect(project([tool({ toolCallId: wrapper, title: 'apply_patch: wrapped', input: { input: patch } })]).uniqueFileCount).toBe(1);
  });

  it('atomically discards malformed apply-patch payloads', () => {
    const malformed = [
      '*** Begin Patch',
      '*** Add File: would-otherwise-pass.txt',
      '+content',
      '*** Update File: malformed.txt',
      '@@',
      'not-prefixed',
      '*** End Patch',
    ].join('\n');

    expect(project([tool({ toolCallId: 'bad', title: 'apply_patch: bad', input: { input: malformed } })])).toEqual({
      activities: [],
      turnSummariesByTurnId: {},
      fileGroups: [],
      uniqueFileCount: 0,
    });
  });

  it('collapses a same-normalized-path Move and splits a real Move', () => {
    const result = project([
      tool({
        toolCallId: 'same',
        title: 'apply_patch: same',
        input: { input: '*** Begin Patch\n*** Update File: ./same.txt\n*** Move to: nested/../same.txt\n-old\n+new\n*** End Patch' },
      }),
      tool({
        toolCallId: 'real',
        title: 'apply_patch: real',
        input: { input: '*** Begin Patch\n*** Update File: source.txt\n*** Move to: destination.txt\n-old\n+new\n*** End Patch' },
      }),
    ]);

    expect(result.activities.map(({ relativePath, action, fragments }) => ({ relativePath, action, fragments }))).toEqual([
      { relativePath: 'project/same.txt', action: 'modified', fragments: [expect.any(Object)] },
      { relativePath: 'project/source.txt', action: 'deleted', fragments: [] },
      { relativePath: 'project/destination.txt', action: 'created', fragments: [expect.any(Object)] },
    ]);
  });

  it('resolves POSIX and backslash relative paths and excludes lexical escapes and mixed absolute paths', () => {
    const result = project([
      tool({ toolCallId: 'posix', title: 'write: posix', input: { path: 'src/a.txt', content: 'a' } }),
      tool({ toolCallId: 'slashes', title: 'write: slashes', input: { path: 'src\\b.txt', content: 'b' } }),
      tool({ toolCallId: 'absolute', title: 'write: absolute', input: { path: '/workspace/c.txt', content: 'c' } }),
      tool({ toolCallId: 'traversal', title: 'write: traversal', input: { path: '../../outside.txt', content: 'x' } }),
      tool({ toolCallId: 'outside', title: 'write: outside', input: { path: '/workspace-collision/x.txt', content: 'x' } }),
      tool({ toolCallId: 'mixed', title: 'write: mixed', input: { path: 'C:\\workspace\\x.txt', content: 'x' } }),
      tool({ toolCallId: 'drive-relative', title: 'write: drive relative', input: { path: 'C:workspace\\x.txt', content: 'x' } }),
    ]);

    expect(result.fileGroups.map((group) => group.relativePath)).toEqual([
      'project/src/a.txt',
      'project/src/b.txt',
      'c.txt',
    ]);
  });

  it('uses win32 drive and UNC semantics cross-platform', () => {
    const driveResult = project([
      tool({ toolCallId: 'relative', title: 'write: relative', input: { path: 'src\\a.txt', content: 'a' } }),
      tool({ toolCallId: 'absolute', title: 'write: absolute', input: { path: 'c:/work/project/b.txt', content: 'b' } }),
      tool({ toolCallId: 'other-drive', title: 'write: other drive', input: { path: 'D:\\work\\x.txt', content: 'x' } }),
    ], { workspaceRoot: 'C:\\work', executionCwd: 'C:\\work\\project' });
    const uncResult = project([
      tool({ toolCallId: 'unc', title: 'write: unc', input: { path: '..\\shared.txt', content: 'x' } }),
    ], { workspaceRoot: '\\\\server\\share', executionCwd: '\\\\server\\share\\project' });

    expect(driveResult.fileGroups.map((group) => group.relativePath)).toEqual(['project/src/a.txt', 'project/b.txt']);
    expect(uncResult.fileGroups.map((group) => group.relativePath)).toEqual(['shared.txt']);
  });

  it.each([
    { workspaceRoot: 'workspace', executionCwd: '/workspace' },
    { workspaceRoot: '/workspace', executionCwd: 'workspace' },
    { workspaceRoot: '/workspace', executionCwd: 'C:\\workspace' },
    { workspaceRoot: 'C:\\workspace', executionCwd: '/workspace' },
    { workspaceRoot: '/workspace', executionCwd: '/outside' },
  ])('rejects non-absolute, mixed-family, or out-of-root context before projection: %o', (context) => {
    const result = project([
      tool({ toolCallId: 'write', title: 'write: file', input: { path: '/workspace/file.txt', content: 'x' } }),
    ], context);
    expect(result.activities).toEqual([]);
  });

  it('uses assistant group IDs for prose and tool-only turns and deduplicates toolCallId updates', () => {
    const first = tool({ toolCallId: 'duplicate', title: 'write: first', input: { path: 'first.txt', content: 'x' } });
    const duplicate = tool({
      ...first,
      id: 'tool:duplicate-update',
      title: 'write: duplicate update',
      input: { path: 'duplicate.txt', content: 'x' },
    });
    const second = tool({ toolCallId: 'second', title: 'write: second', input: { path: 'second.txt', content: 'x' } });
    const result = project([first, duplicate, user('user-boundary'), second]);

    expect(result.activities).toHaveLength(2);
    expect(result.activities.map((activity) => activity.turnId)).toEqual([
      'assistant-turn:tool:duplicate',
      'assistant-turn:tool:second',
    ]);
    expect(Object.keys(result.turnSummariesByTurnId)).toEqual([
      'assistant-turn:tool:duplicate',
      'assistant-turn:tool:second',
    ]);
  });

  it('folds same-turn same-path actions, sums counts, and preserves chronological file groups', () => {
    const result = project([
      tool({ toolCallId: 'create-a', title: 'write: a', input: { path: 'a.txt', content: 'one\n' } }),
      tool({ toolCallId: 'edit-b', title: 'edit: b', input: { path: 'b.txt', oldText: 'old', newText: 'new' } }),
      tool({ toolCallId: 'edit-a', title: 'edit: a', input: { path: 'a.txt', oldText: 'one', newText: 'two\nthree' } }),
      tool({ toolCallId: 'delete-a', title: 'apply_patch: delete a', input: { input: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch' } }),
      tool({ toolCallId: 'recreate-a', title: 'write: recreate a', input: { path: 'a.txt', content: 'four' } }),
      tool({ toolCallId: 'create-c', title: 'write: c', input: { path: 'c.txt', content: 'x' } }),
      tool({ toolCallId: 'delete-c', title: 'apply_patch: delete c', input: { input: '*** Begin Patch\n*** Delete File: c.txt\n*** End Patch' } }),
      tool({ toolCallId: 'create-d', title: 'write: d', input: { path: 'd.txt', content: 'one' } }),
      tool({ toolCallId: 'edit-d', title: 'edit: d', input: { path: 'd.txt', oldText: 'one', newText: 'two' } }),
    ]);
    const summaries = Object.values(result.turnSummariesByTurnId)[0];

    expect(summaries?.map(({ relativePath, action, added, removed }) => ({ relativePath, action, added, removed }))).toEqual([
      { relativePath: 'project/a.txt', action: 'created', added: 4, removed: 1 },
      { relativePath: 'project/b.txt', action: 'modified', added: 1, removed: 1 },
      { relativePath: 'project/c.txt', action: 'deleted', added: 1, removed: 0 },
      { relativePath: 'project/d.txt', action: 'created', added: 2, removed: 1 },
    ]);
    expect(result.fileGroups.map((group) => group.relativePath)).toEqual([
      'project/a.txt', 'project/b.txt', 'project/c.txt', 'project/d.txt',
    ]);
    expect(result.fileGroups[0]?.activities.map((activity) => activity.action)).toEqual([
      'created', 'modified', 'deleted', 'created',
    ]);
  });

  it('builds one display diff per turn and file while composing sequential full edits', () => {
    const result = project([
      tool({ toolCallId: 'first', title: 'edit: first', input: { path: 'shared.txt', oldText: 'A', newText: 'B' } }),
      tool({ toolCallId: 'second', title: 'edit: second', input: { path: 'shared.txt', oldText: 'B', newText: 'C' } }),
      tool({ toolCallId: 'duplicate', title: 'edit: duplicate', input: { path: 'shared.txt', oldText: 'A', newText: 'B' } }),
      tool({
        toolCallId: 'independent',
        title: 'edit: independent',
        input: {
          path: 'other.txt',
          edits: [
            { oldText: 'one', newText: 'two' },
            { oldText: 'three', newText: 'four' },
          ],
        },
      }),
      tool({ toolCallId: 'write', title: 'write: replay', input: { path: 'replayed.txt', content: 'hello foo' } }),
      tool({ toolCallId: 'edit-write', title: 'edit: replay', input: { path: 'replayed.txt', oldText: 'foo', newText: 'bar' } }),
      tool({ toolCallId: 'write-first', title: 'write: ordered', input: { path: 'ordered.txt', content: 'first' } }),
      tool({ toolCallId: 'independent-middle', title: 'edit: ordered', input: { path: 'ordered.txt', oldText: 'absent', newText: 'middle' } }),
      tool({ toolCallId: 'write-last', title: 'write: ordered', input: { path: 'ordered.txt', content: 'last' } }),
      tool({ toolCallId: 'crlf-first', title: 'edit: eol', input: { path: 'eol.txt', oldText: 'A\r\n', newText: 'B\r\n' } }),
      tool({ toolCallId: 'lf-second', title: 'edit: eol', input: { path: 'eol.txt', oldText: 'B\n', newText: 'C\n' } }),
      tool({ toolCallId: 'priority-write', title: 'write: priority', input: { path: 'priority.txt', content: 'prefix B suffix' } }),
      tool({ toolCallId: 'priority-independent', title: 'edit: priority', input: { path: 'priority.txt', oldText: 'A', newText: 'B' } }),
      tool({ toolCallId: 'priority-replay', title: 'edit: priority', input: { path: 'priority.txt', oldText: 'B', newText: 'C' } }),
    ]);

    expect(buildAcpTurnFileChanges(result.fileGroups[0]?.activities ?? [])).toMatchObject([{
      turnId: 'assistant-turn:tool:first',
      activities: [{ toolCallId: 'first' }, { toolCallId: 'second' }, { toolCallId: 'duplicate' }],
      diff: { oldText: 'A', newText: 'C' },
    }]);
    expect(buildAcpTurnFileChanges(result.fileGroups[1]?.activities ?? [])).toMatchObject([{
      turnId: 'assistant-turn:tool:first',
      activities: [{ toolCallId: 'independent' }],
      diff: { oldText: 'one\n\nthree', newText: 'two\n\nfour' },
    }]);
    expect(buildAcpTurnFileChanges(result.fileGroups[2]?.activities ?? [])).toMatchObject([{
      activities: [{ toolCallId: 'write' }, { toolCallId: 'edit-write' }],
      diff: { oldText: '', newText: 'hello bar' },
    }]);
    expect(buildAcpTurnFileChanges(result.fileGroups[3]?.activities ?? [])).toMatchObject([{
      activities: [{ toolCallId: 'write-first' }, { toolCallId: 'independent-middle' }, { toolCallId: 'write-last' }],
      diff: { oldText: 'absent\n\n', newText: 'middle\n\nlast' },
    }]);
    expect(buildAcpTurnFileChanges(result.fileGroups[4]?.activities ?? [])).toMatchObject([{
      diff: { oldText: 'A\r\n\n\nB\n', newText: 'B\r\n\n\nC\n' },
    }]);
    expect(buildAcpTurnFileChanges(result.fileGroups[5]?.activities ?? [])).toMatchObject([{
      diff: { oldText: 'A\n\n', newText: 'B\n\nprefix C suffix' },
    }]);
  });

  it('matches diffLines semantics for empty text, CRLF, trailing newlines, and context-only hunks', () => {
    const result = project([
      tool({ toolCallId: 'empty', title: 'write: empty', input: { path: 'empty.txt', content: '' } }),
      tool({ toolCallId: 'crlf', title: 'edit: crlf', input: { path: 'crlf.txt', oldText: 'a\r\nb\r\n', newText: 'a\nb\n' } }),
      tool({ toolCallId: 'trailing', title: 'write: trailing', input: { path: 'trailing.txt', content: 'a\n' } }),
      tool({
        toolCallId: 'context',
        title: 'apply_patch: context',
        input: { input: '*** Begin Patch\n*** Update File: context.txt\n@@\n same\n\n*** End Patch' },
      }),
    ]);
    const summaries = Object.values(result.turnSummariesByTurnId)[0];

    expect(summaries?.map(({ added, removed }) => ({ added, removed }))).toEqual([
      { added: 0, removed: 0 },
      { added: 0, removed: 0 },
      { added: 1, removed: 0 },
      { added: 0, removed: 0 },
    ]);
  });

  it('projects historical items identically and returns the exact empty shape', () => {
    const live = tool({ toolCallId: 'write', title: 'write: file', input: { path: 'file.txt', content: 'x' } });
    const historical = { ...live, historical: true };

    expect(project([historical])).toEqual(project([live]));
    expect(project([])).toEqual({
      activities: [],
      turnSummariesByTurnId: {},
      fileGroups: [],
      uniqueFileCount: 0,
    });
  });
});
