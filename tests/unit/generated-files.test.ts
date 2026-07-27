import { describe, expect, it } from 'vitest';
import {
  basenameOf,
  classifyFileExt,
  extnameOf,
  getMimeTypeForExt,
  isDocxPreviewExt,
  isPptxPreviewExt,
  supportsInlineDocumentPreview,
  supportsRichDocumentPreview,
} from '@/lib/generated-files';
import {
  attachmentOpenMode,
  filePreviewKind,
  filePreviewMaxBytes,
  isFilePreviewWithinSizeLimit,
  richFilePreviewKind,
} from '@/lib/file-preview-capabilities';

describe('generated-files utilities', () => {
  it('routes text documents to rendered inline preview', () => {
    expect(supportsInlineDocumentPreview('.html')).toBe(true);
    expect(supportsInlineDocumentPreview('.htm')).toBe(true);
    expect(supportsInlineDocumentPreview('.md')).toBe(true);
  });

  it('routes supported binary documents to rich preview', () => {
    expect(supportsInlineDocumentPreview('.pdf')).toBe(true);
    expect(supportsInlineDocumentPreview('.xlsx')).toBe(true);
    expect(supportsInlineDocumentPreview('.docx')).toBe(true);
    expect(supportsInlineDocumentPreview('.pptx')).toBe(true);
    expect(supportsRichDocumentPreview('.PDF')).toBe(true);
    expect(supportsRichDocumentPreview('.xlsx')).toBe(true);
    expect(supportsRichDocumentPreview('.docx')).toBe(true);
    expect(supportsRichDocumentPreview('.pptx')).toBe(true);
    expect(supportsRichDocumentPreview('.doc')).toBe(false);
    expect(supportsRichDocumentPreview('.ppt')).toBe(false);
  });

  it('preserves extension, path, and content-type classification', () => {
    expect(basenameOf(String.raw`C:\workspace\src\index.ts`)).toBe('index.ts');
    expect(extnameOf('/workspace/archive.tar.gz')).toBe('.gz');
    expect(extnameOf('/workspace/.env')).toBe('');
    expect(classifyFileExt('.png')).toBe('snapshot');
    expect(classifyFileExt('.tsx')).toBe('code');
    expect(classifyFileExt('.pdf')).toBe('document');
    expect(classifyFileExt('.mp4')).toBe('video');
    expect(classifyFileExt('.wav')).toBe('audio');
    expect(classifyFileExt('.zip')).toBe('other');
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
    const local = { kind: 'local' as const, scope: 'workspace' as const, entryKind: 'file' as const, ref };
    const directory = { ...local, entryKind: 'directory' as const };
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
    expect(attachmentOpenMode({ ext: '.txt', mimeType: 'text/plain', size: 100, target: directory })).toBe('system');
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
});
