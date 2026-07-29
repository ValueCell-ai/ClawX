import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrowserLink } from '@/components/common/BrowserLink';
import { localHtmlBrowserUrl } from '@/lib/local-html-browser';

describe('BrowserLink', () => {
  it('renders content links as unstyled, non-interactive text', () => {
    render(
      <BrowserLink
        href="https://example.com"
        className="text-primary hover:underline"
      >
        https://example.com
      </BrowserLink>,
    );

    const text = screen.getByText('https://example.com');
    expect(text.tagName).toBe('SPAN');
    expect(text).not.toHaveClass('text-primary', 'hover:underline');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('localHtmlBrowserUrl', () => {
  it('builds encoded file URLs only for HTML workspace targets', () => {
    const target = {
      kind: 'workspace' as const,
      ref: { workspaceRoot: '/workspace/demo', relativePath: 'site/report #1.html' },
    };

    expect(localHtmlBrowserUrl(target, 'site/report #1.html')).toBe(
      'file:///workspace/demo/site/report%20%231.html',
    );
    expect(localHtmlBrowserUrl(target, 'site/report.md')).toBeNull();
  });

  it('accepts local attachment paths but rejects remote HTML attachments', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: '/workspace/site one.htm' };

    expect(localHtmlBrowserUrl({ kind: 'attachment', ref }, 'site one.htm')).toBe(
      'file:///workspace/site%20one.htm',
    );
    expect(localHtmlBrowserUrl({
      kind: 'attachment',
      ref: { ...ref, uri: 'https://example.com/site.htm' },
    }, 'site.htm')).toBeNull();
  });
});
