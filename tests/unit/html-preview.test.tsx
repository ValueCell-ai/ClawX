import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HtmlPreview from '@/components/file-preview/HtmlPreview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? '' }),
}));

describe('HtmlPreview', () => {
  it('injects a file base for trusted paths', () => {
    render(<HtmlPreview source="<html><head></head><body></body></html>" filePath="/tmp/site/index.html" />);
    expect(screen.getByTestId('html-preview-frame')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('<base href="file:///tmp/site/">'),
    );
  });

  it('never creates a file URL base for scoped workspace HTML', () => {
    render(
      <HtmlPreview
        source="<html><head></head><body></body></html>"
        filePath="site/index.html"
        workspaceFileRef={{ workspaceRoot: '/secret/workspace', relativePath: 'site/index.html' }}
      />,
    );
    const srcDoc = screen.getByTestId('html-preview-frame').getAttribute('srcdoc');
    expect(srcDoc).not.toContain('<base');
    expect(srcDoc).not.toContain('file://');
    expect(srcDoc).not.toContain('/secret/workspace');
  });
});
