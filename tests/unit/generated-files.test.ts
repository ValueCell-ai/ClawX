import { describe, expect, it } from 'vitest';
import {
  computeLineStats,
  extractGeneratedFiles,
  getMimeTypeForExt,
  isDocxPreviewExt,
  isPptxPreviewExt,
  supportsInlineDiff,
  supportsInlineDocumentPreview,
  type GeneratedFile,
  type GeneratedFileBaseline,
} from '@/lib/generated-files';
import type { RawMessage } from '@/stores/chat';
import {
  attachmentOpenMode,
  filePreviewKind,
  filePreviewMaxBytes,
  isFilePreviewWithinSizeLimit,
  richFilePreviewKind,
} from '@/lib/file-preview-capabilities';

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
    expect(supportsInlineDiff({ ext: '.doc', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.docx', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.ppt', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.pptx', contentType: 'document' })).toBe(false);

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

  it('uses format-aware preview limits', () => {
    const text = { kind: 'text' as const };
    const docx = { kind: 'rich' as const, richKind: 'docx' as const };
    const pptx = { kind: 'rich' as const, richKind: 'pptx' as const };
    const pdf = { kind: 'rich' as const, richKind: 'pdf' as const };
    const sheet = { kind: 'rich' as const, richKind: 'sheet' as const };

    expect(filePreviewMaxBytes(text)).toBe(2 * 1024 * 1024);
    expect(filePreviewMaxBytes(docx)).toBe(20 * 1024 * 1024);
    expect(filePreviewMaxBytes(pptx)).toBe(20 * 1024 * 1024);
    expect(filePreviewMaxBytes(pdf)).toBe(50 * 1024 * 1024);
    expect(filePreviewMaxBytes(sheet)).toBe(50 * 1024 * 1024);

    for (const target of [text, docx, pptx, pdf, sheet]) {
      const limit = filePreviewMaxBytes(target);
      expect(isFilePreviewWithinSizeLimit(target, limit)).toBe(true);
      expect(isFilePreviewWithinSizeLimit(target, limit + 1)).toBe(false);
    }
  });

  it('uses shared preview limits and routes remote or unsupported attachments to system open', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///workspace/file.txt' };
    const local = { kind: 'local' as const, scope: 'workspace' as const, ref };
    const remote = { kind: 'remote' as const, ref, url: 'https://example.com/file.txt' };

    expect(attachmentOpenMode({ ext: '.txt', mimeType: 'text/plain', size: 2 * 1024 * 1024, target: local })).toBe('preview');
    expect(attachmentOpenMode({ ext: '.txt', mimeType: 'text/plain', size: 2 * 1024 * 1024 + 1, target: local })).toBe('system');
    expect(attachmentOpenMode({ ext: '.pdf', mimeType: 'application/pdf', size: 50 * 1024 * 1024, target: local })).toBe('preview');
    expect(attachmentOpenMode({ ext: '', mimeType: 'application/pdf', size: 1024, target: local })).toBe('preview');
    expect(attachmentOpenMode({ ext: '.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 50 * 1024 * 1024 + 1, target: local })).toBe('system');
    expect(attachmentOpenMode({ ext: '.docx', mimeType: 'application/octet-stream', size: 20 * 1024 * 1024, target: local })).toBe('preview');
    expect(attachmentOpenMode({ ext: '.docx', mimeType: 'application/octet-stream', size: 20 * 1024 * 1024 + 1, target: local })).toBe('system');
    expect(attachmentOpenMode({ ext: '.pptx', mimeType: 'application/octet-stream', size: 20 * 1024 * 1024, target: local })).toBe('preview');
    expect(attachmentOpenMode({ ext: '.pptx', mimeType: 'application/octet-stream', size: 20 * 1024 * 1024 + 1, target: local })).toBe('system');
    expect(attachmentOpenMode({ ext: '.zip', mimeType: 'application/zip', size: 100, target: local })).toBe('system');
    expect(attachmentOpenMode({ ext: '.txt', mimeType: 'text/plain', size: 100, target: remote })).toBe('system');
    expect(attachmentOpenMode({ ext: '.docx', mimeType: 'application/octet-stream', size: 100, target: remote })).toBe('system');
    expect(attachmentOpenMode({ ext: '.pptx', mimeType: 'application/octet-stream', size: 100, target: remote })).toBe('system');
  });

  it.each([
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.doc', '.ppt',
    '.mp3', '.wav', '.mp4', '.webm',
  ])('forces known unsupported extension %s to system open despite previewable MIME', (ext) => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: `/workspace/file${ext}` };
    expect(attachmentOpenMode({
      ext,
      mimeType: 'text/plain',
      size: 100,
      target: { kind: 'local', scope: 'workspace', ref },
    })).toBe('system');
  });

  it.each([
    ['.txt', 'application/octet-stream'],
    ['.ts', 'application/octet-stream'],
    ['.csv', 'application/zip'],
    ['.pdf', 'text/plain'],
    ['.xlsx', 'text/plain'],
    ['.docx', 'image/png'],
    ['.pptx', 'application/pdf'],
  ])('preserves supported extension %s despite conflicting MIME', (ext, mimeType) => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: `/workspace/file${ext}` };
    expect(attachmentOpenMode({
      ext,
      mimeType,
      size: 100,
      target: { kind: 'local', scope: 'workspace', ref },
    })).toBe('preview');
  });

  it('uses supported extensions before conflicting rich MIME viewer hints', () => {
    expect(filePreviewKind({ ext: '.docx', mimeType: 'image/png' })).toBe('rich');
    expect(filePreviewKind({ ext: '.pptx', mimeType: 'application/pdf' })).toBe('rich');
    expect(richFilePreviewKind({ ext: '.pdf', mimeType: 'image/png' })).toBe('pdf');
    expect(richFilePreviewKind({ ext: '.xlsx', mimeType: 'image/png' })).toBe('sheet');
    expect(richFilePreviewKind({ ext: '.docx', mimeType: 'image/png' })).toBe('docx');
    expect(richFilePreviewKind({ ext: '.pptx', mimeType: 'application/pdf' })).toBe('pptx');
    expect(richFilePreviewKind({ ext: '.txt', mimeType: 'image/png' })).toBeNull();
    expect(richFilePreviewKind({ ext: '', mimeType: 'image/png' })).toBe('image');
  });

  it('does not infer Office previews from OOXML MIME without a supported extension', () => {
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const pptxMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    expect(filePreviewKind({ ext: '', mimeType: docxMime })).toBeNull();
    expect(filePreviewKind({ ext: '.unknown', mimeType: pptxMime })).toBeNull();
    expect(richFilePreviewKind({ ext: '', mimeType: docxMime })).toBeNull();
    expect(richFilePreviewKind({ ext: '.unknown', mimeType: docxMime })).toBeNull();
    expect(richFilePreviewKind({ ext: '', mimeType: pptxMime })).toBeNull();
    expect(richFilePreviewKind({ ext: '.unknown', mimeType: pptxMime })).toBeNull();
  });

  it('classifies DOCX and PPTX extensions and MIME mappings exactly', () => {
    expect(isDocxPreviewExt('.docx')).toBe(true);
    expect(isDocxPreviewExt('.DOCX')).toBe(true);
    expect(isDocxPreviewExt('.doc')).toBe(false);
    expect(isPptxPreviewExt('.pptx')).toBe(true);
    expect(isPptxPreviewExt('.PPTX')).toBe(true);
    expect(isPptxPreviewExt('.ppt')).toBe(false);
    expect(getMimeTypeForExt('.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(getMimeTypeForExt('.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
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
