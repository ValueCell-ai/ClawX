import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GeneratedFilesPanel } from '@/components/file-preview/GeneratedFilesPanel';
import type { GeneratedFile } from '@/lib/generated-files';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, params?: Record<string, unknown>) => {
      if (typeof params?.count === 'number') return `文件变更（${params.count} 个）`;
      return '';
    },
  }),
}));

function makeFile(overrides: Partial<GeneratedFile>): GeneratedFile {
  return {
    filePath: '/tmp/example.ts',
    fileName: 'example.ts',
    ext: '.ts',
    mimeType: 'text/typescript',
    contentType: 'code',
    action: 'modified',
    fullContent: 'const value = 2\n',
    lastSeenIndex: 1,
    ...overrides,
  };
}

describe('GeneratedFilesPanel', () => {
  it('shows pdf and spreadsheet outputs as open-folder actions', () => {
    const onOpen = vi.fn();
    const onRevealInFileManager = vi.fn();
    const windowsPath = String.raw`C:\Users\张三\Downloads\测试PDF文件-有内容.pdf`;
    const file = makeFile({
      filePath: windowsPath,
      fileName: '测试PDF文件-有内容.pdf',
      ext: '.pdf',
      mimeType: 'application/pdf',
      contentType: 'document',
    });

    render(
      <GeneratedFilesPanel
        files={[file]}
        onOpen={onOpen}
        onRevealInFileManager={onRevealInFileManager}
      />,
    );

    const button = screen.getByRole('button', { name: /测试PDF文件-有内容\.pdf/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRevealInFileManager).toHaveBeenCalledWith(expect.objectContaining({ filePath: windowsPath }));
  });

  it('reveals xls and xlsx files with unicode Windows paths', () => {
    const onOpen = vi.fn();
    const onRevealInFileManager = vi.fn();
    const files = [
      makeFile({
        filePath: String.raw`C:\Users\张三\Documents\销售报表.xls`,
        fileName: '销售报表.xls',
        ext: '.xls',
        mimeType: 'application/vnd.ms-excel',
        contentType: 'document',
      }),
      makeFile({
        filePath: String.raw`C:\Users\张三\Documents\财务明细.xlsx`,
        fileName: '财务明细.xlsx',
        ext: '.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentType: 'document',
        lastSeenIndex: 2,
      }),
    ];

    render(
      <GeneratedFilesPanel
        files={files}
        onOpen={onOpen}
        onRevealInFileManager={onRevealInFileManager}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /销售报表\.xls/ }));
    fireEvent.click(screen.getByRole('button', { name: /财务明细\.xlsx/ }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onRevealInFileManager).toHaveBeenNthCalledWith(1, expect.objectContaining({ filePath: files[0].filePath }));
    expect(onRevealInFileManager).toHaveBeenNthCalledWith(2, expect.objectContaining({ filePath: files[1].filePath }));
  });

  it('keeps unsupported non-preview document formats non-clickable', () => {
    const onOpen = vi.fn();
    render(
      <GeneratedFilesPanel
        files={[
          makeFile({
            filePath: '/tmp/report.docx',
            fileName: 'report.docx',
            ext: '.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            contentType: 'document',
          }),
        ]}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', { name: /report\.docx/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps supported text/code formats clickable', () => {
    const onOpen = vi.fn();
    const file = makeFile({ filePath: '/tmp/example.ts' });
    render(<GeneratedFilesPanel files={[file]} onOpen={onOpen} />);

    const button = screen.getByRole('button', { name: /example\.ts/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/example.ts' }));
  });
});
