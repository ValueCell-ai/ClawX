import { describe, expect, it } from 'vitest';
import {
  computeLineStats,
  extractGeneratedFiles,
  supportsInlineDiff,
  supportsInlineDocumentPreview,
  type GeneratedFile,
  type GeneratedFileBaseline,
} from '@/lib/generated-files';
import type { RawMessage } from '@/stores/chat';

function makeWriteFile(overrides: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    filePath: '/tmp/example.ts',
    fileName: 'example.ts',
    ext: '.ts',
    mimeType: 'text/typescript',
    contentType: 'code',
    action: 'modified',
    fullContent: 'const value = 2\nconsole.log(value)\n',
    lastSeenIndex: 1,
    ...overrides,
  };
}

describe('generated-files utilities', () => {
  it('computes write line stats from an existing-file baseline', () => {
    const stats = computeLineStats(
      makeWriteFile({
        baseline: { status: 'ok', content: 'const value = 1\nconsole.log(value)\n' },
      }),
    );

    expect(stats).toEqual({ added: 1, removed: 1 });
  });

  it('treats missing baseline as a new file for line stats', () => {
    const stats = computeLineStats(
      makeWriteFile({
        action: 'created',
        baseline: { status: 'missing' },
        fullContent: 'line 1\nline 2\n',
      }),
    );

    expect(stats).toEqual({ added: 2, removed: 0 });
  });

  it('refuses to fake precise line stats when baseline is unavailable', () => {
    const stats = computeLineStats(
      makeWriteFile({
        baseline: { status: 'unavailable', reason: 'outsideSandbox' },
      }),
    );

    expect(stats).toBeNull();
  });

  it('routes html documents to rendered inline preview and text diff support', () => {
    expect(supportsInlineDocumentPreview('.html')).toBe(true);
    expect(supportsInlineDocumentPreview('.htm')).toBe(true);
    expect(supportsInlineDiff({ ext: '.html', contentType: 'document' })).toBe(true);
  });

  it('routes pdf/spreadsheet to rich-doc preview but never to text diff', () => {
    expect(supportsInlineDocumentPreview('.md')).toBe(true);
    // PDFs and spreadsheets now render through dedicated viewers, so they
    // qualify for inline preview...
    expect(supportsInlineDocumentPreview('.pdf')).toBe(true);
    expect(supportsInlineDocumentPreview('.xlsx')).toBe(true);
    // ...but diffing binary content is still meaningless, so the diff
    // tab stays hidden for these formats.
    expect(supportsInlineDiff({ ext: '.pdf', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.xlsx', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.docx', contentType: 'document' })).toBe(false);

    const stats = computeLineStats({
      filePath: '/tmp/report.pdf',
      fileName: 'report.pdf',
      ext: '.pdf',
      mimeType: 'application/pdf',
      contentType: 'document',
      action: 'modified',
      fullContent: 'pretend text payload',
      baseline: { status: 'ok', content: 'older pretend text payload' },
      lastSeenIndex: 1,
    });

    expect(stats).toBeNull();
  });

  it('extracts write files with per-run baseline state and action', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'update file', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'write-1',
          name: 'Write',
          input: {
            file_path: '/tmp/example.ts',
            content: 'const value = 2\n',
          },
        }],
      },
    ];

    const baselineByPath = new Map<string, GeneratedFileBaseline>([
      ['/tmp/example.ts', { status: 'ok', content: 'const value = 1\n' }],
    ]);

    const files = extractGeneratedFiles(messages, 0, 1, (filePath) => baselineByPath.get(filePath));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filePath: '/tmp/example.ts',
      action: 'modified',
      baseline: { status: 'ok', content: 'const value = 1\n' },
    });
  });

  it('keeps new-file writes marked as created when the baseline says missing', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'create file', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'write-1',
          name: 'Write',
          input: {
            file_path: '/tmp/new-file.ts',
            content: 'export const created = true\n',
          },
        }],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1, () => ({ status: 'missing' }));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filePath: '/tmp/new-file.ts',
      action: 'created',
      baseline: { status: 'missing' },
    });
  });

  it('extracts files created by Codex apply_patch tool calls', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'create file with apply_patch', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-apply-patch',
          name: 'apply_patch',
          arguments: [
            '*** Begin Patch',
            '*** Add File: reports/summary.md',
            '+# Summary',
            '+',
            '+CLAWX_REAL_TOOL_FILE_OK',
            '*** End Patch',
            '',
          ].join('\n'),
        }],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filePath: 'reports/summary.md',
      fileName: 'summary.md',
      action: 'created',
      fullContent: '# Summary\n\nCLAWX_REAL_TOOL_FILE_OK\n',
      baseline: { status: 'missing' },
    });
    expect(computeLineStats(files[0])).toEqual({ added: 3, removed: 0 });
  });

  it('extracts files from Codex apply_patch line-array inputs', () => {
    const messages = [
      { role: 'user', content: 'create file with apply_patch', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-apply-patch',
          name: 'apply_patch',
          arguments: [
            '*** Begin Patch',
            '*** Add File: clawx-real-tool-smoke.txt',
            '+CLAWX_REAL_TOOL_FILE_OK',
            '*** End Patch',
            '',
          ],
        }],
        timestamp: 2,
      },
      { role: 'assistant', content: 'done', timestamp: 3 },
    ] as RawMessage[];

    const files = extractGeneratedFiles(messages, 0, messages.length - 1);

    expect(files).toEqual([
      expect.objectContaining({
        filePath: 'clawx-real-tool-smoke.txt',
        fileName: 'clawx-real-tool-smoke.txt',
        action: 'created',
        fullContent: 'CLAWX_REAL_TOOL_FILE_OK\n',
      }),
    ]);
    expect(computeLineStats(files[0])).toEqual({ added: 1, removed: 0 });
  });

  it('extracts edited files from Codex apply_patch update hunks', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'update file with apply_patch', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-apply-patch',
          name: 'apply_patch',
          arguments: [
            '*** Begin Patch',
            '*** Update File: src/example.ts',
            '@@',
            '-const value = 1',
            '+const value = 2',
            ' console.log(value)',
            '*** End Patch',
            '',
          ].join('\n'),
        }],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filePath: 'src/example.ts',
      fileName: 'example.ts',
      action: 'modified',
      edits: [{ old: 'const value = 1\n', new: 'const value = 2\n' }],
    });
    expect(computeLineStats(files[0])).toEqual({ added: 1, removed: 1 });
  });

  it('extracts files from cc-connect structured Patch tool calls', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'create file through cc-connect', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-bridge-patch',
          name: 'Patch',
          arguments: [{
            diff: '# ClawX UI Artifact\nCLAWX_REAL_UI_ARTIFACT_OK\n',
            kind: { type: 'add' },
            path: '/tmp/clawx-real-ui-artifact.md',
          }],
        }],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1);

    expect(files).toEqual([
      expect.objectContaining({
        filePath: '/tmp/clawx-real-ui-artifact.md',
        fileName: 'clawx-real-ui-artifact.md',
        action: 'created',
        fullContent: '# ClawX UI Artifact\nCLAWX_REAL_UI_ARTIFACT_OK\n',
        baseline: { status: 'missing' },
      }),
    ]);
    expect(computeLineStats(files[0])).toEqual({ added: 2, removed: 0 });
  });

  it('computes edit snippet stats from joined edit hunks', () => {
    const stats = computeLineStats({
      filePath: '/tmp/example.ts',
      fileName: 'example.ts',
      ext: '.ts',
      mimeType: 'text/typescript',
      contentType: 'code',
      action: 'modified',
      edits: [
        { old: 'alpha\n', new: 'beta\n' },
        { old: 'gamma\n', new: 'delta\n' },
      ],
      lastSeenIndex: 1,
    });

    expect(stats).toEqual({ added: 2, removed: 2 });
  });
});
