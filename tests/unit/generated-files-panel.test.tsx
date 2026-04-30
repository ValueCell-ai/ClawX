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
  it('keeps unsupported document formats non-clickable', () => {
    const onOpen = vi.fn();
    render(
      <GeneratedFilesPanel
        files={[
          makeFile({
            filePath: '/tmp/report.pdf',
            fileName: 'report.pdf',
            ext: '.pdf',
            mimeType: 'application/pdf',
            contentType: 'document',
          }),
        ]}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', { name: /report\.pdf/ });
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
