import { describe, expect, it } from 'vitest';
import { extractRawFilePaths } from '@/stores/chat/helpers';

describe('extractRawFilePaths', () => {
  it('detects bare unix-absolute paths to documents', () => {
    const refs = extractRawFilePaths('Saved the report to /tmp/report.pdf for review.');
    expect(refs).toEqual([{ filePath: '/tmp/report.pdf', mimeType: 'application/pdf' }]);
  });

  it('still rejects URLs and path-fragments after a colon', () => {
    const refs = extractRawFilePaths('See https://example.com/manual.pdf or relative/path.pdf');
    // The legacy guard still keeps URL bodies and mid-token slashes out.
    expect(refs).toEqual([]);
  });

  it('surfaces MEDIA: tagged artifacts emitted by the runtime', () => {
    const sample =
      'Here is the spreadsheet:\nMEDIA:/Users/alice/.openclaw/media/outbound/sales-2025---abc123.xlsx';
    const refs = extractRawFilePaths(sample);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      filePath: '/Users/alice/.openclaw/media/outbound/sales-2025---abc123.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('handles multiple MEDIA: paths inline', () => {
    const sample = '(MEDIA:/a/b/one.pdf) and MEDIA:~/two.xlsx are ready.';
    const refs = extractRawFilePaths(sample);
    expect(refs.map((r) => r.filePath)).toEqual([
      '/a/b/one.pdf',
      '~/two.xlsx',
    ]);
  });

  it('also accepts the lowercase media: prefix', () => {
    const refs = extractRawFilePaths('result media:/tmp/out.pdf done.');
    expect(refs).toEqual([
      { filePath: '/tmp/out.pdf', mimeType: 'application/pdf' },
    ]);
  });

  it('captures MEDIA: paths that contain ASCII spaces (macOS screenshot default name)', () => {
    // Regression: macOS' default screenshot filename is
    //   "Screenshot YYYY-MM-DD at HH.MM.SS.png" (en locale) or
    //   "截屏 YYYY-MM-DD HH.MM.SS.png" (zh locale)
    // and the agent typically emits it verbatim via `MEDIA:` after
    // `ls ~/Desktop`. The previous regex excluded ASCII spaces from the
    // captured path, which made the extractor stop at "Screenshot" and
    // never reach the `.png`, so the screenshot silently failed to
    // surface as an attachment.
    const sample = 'Found it on the desktop, sending now:\n\nMEDIA:/Users/alice/Desktop/Screenshot 2026-05-06 at 17.46.51.png';
    const refs = extractRawFilePaths(sample);
    expect(refs).toEqual([
      {
        filePath: '/Users/alice/Desktop/Screenshot 2026-05-06 at 17.46.51.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('captures MEDIA: paths whose filename is non-ASCII (zh-locale macOS screenshot)', () => {
    // Companion to the previous case — make sure paths whose filename
    // is full-Unicode (the zh-locale macOS default) are also captured.
    const sample = 'Sending the screenshot now:\n\nMEDIA:/Users/alice/Desktop/截屏 2026-05-06 17.46.51.png';
    const refs = extractRawFilePaths(sample);
    expect(refs).toEqual([
      {
        filePath: '/Users/alice/Desktop/截屏 2026-05-06 17.46.51.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('keeps non-MEDIA prose after a space-bearing path out of the captured filename', () => {
    // The lookahead must terminate the match at the first non-path character
    // (newline, quote, paren, comma, full-stop, ...). Otherwise a long line
    // like "MEDIA:/p with spaces.png and then more prose" would gobble the
    // trailing narration into the "filename".
    const sample = 'MEDIA:/tmp/my shot.png and then more prose';
    const refs = extractRawFilePaths(sample);
    expect(refs.map((r) => r.filePath)).toEqual(['/tmp/my shot.png']);
  });

  it('detects OpenClaw skill directories without file extensions', () => {
    const refs = extractRawFilePaths('位置： ~/.openclaw/skills/open-eastmoney');
    expect(refs).toEqual([
      { filePath: '~/.openclaw/skills/open-eastmoney', mimeType: 'application/x-directory' },
    ]);
  });

  it('preserves unicode Windows skill directory paths', () => {
    const refs = extractRawFilePaths(String.raw`位置： C:\Users\张三\.openclaw\skills\打开东方财富。`);
    expect(refs).toEqual([
      { filePath: String.raw`C:\Users\张三\.openclaw\skills\打开东方财富`, mimeType: 'application/x-directory' },
    ]);
  });
});
