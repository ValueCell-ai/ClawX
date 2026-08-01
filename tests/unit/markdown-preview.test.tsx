import { render, screen, waitFor } from '@testing-library/react';
import MarkdownPreview from '@/components/file-preview/MarkdownPreview';

describe('MarkdownPreview', () => {
  it('lets prose margins control vertical spacing', () => {
    const { container } = render(<MarkdownPreview source="Preview body" />);
    const preview = container.querySelector('.clawx-markdown-preview');

    expect(preview).toHaveClass('space-y-0');
    expect(preview).not.toHaveClass('space-y-4');
  });

  it.each([
    ['YAML', '---\ntitle: Hidden YAML metadata\n---'],
    ['TOML', '+++\ntitle = "Hidden TOML metadata"\n+++'],
  ])('omits %s frontmatter without rendering a metadata card', (_format, frontmatter) => {
    const { container } = render(
      <MarkdownPreview source={`${frontmatter}\n\n# Visible heading\n\nVisible body`} />,
    );

    expect(screen.getByRole('heading', { name: 'Visible heading' })).toBeVisible();
    expect(screen.getByText('Visible body')).toBeVisible();
    expect(container).not.toHaveTextContent('Hidden');
    expect(container.querySelector('pre')).not.toBeInTheDocument();
  });

  it('keeps raw HTML visible without creating active elements', () => {
    const source = '<script>alert(1)</script>';
    const { container } = render(<MarkdownPreview source={source} />);

    expect(container).toHaveTextContent(source);
    expect(container.querySelector('script')).not.toBeInTheDocument();
  });

  it('renders Markdown links through inert BrowserLink output', () => {
    render(<MarkdownPreview source="[label](https://example.com)" />);

    expect(screen.getByText('label')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'label' })).not.toBeInTheDocument();
  });

  it('renders single-dollar math with KaTeX', () => {
    const { container } = render(<MarkdownPreview source="$x^2$" />);

    expect(container.querySelector('.katex')).toBeInTheDocument();
  });

  it('keeps CJK punctuation and following text outside an autolink', () => {
    const { container } = render(<MarkdownPreview source="https://example.com。后续" />);
    const url = screen.getByText('https://example.com');

    expect(url).toBeVisible();
    expect(url).toHaveTextContent(/^https:\/\/example\.com$/);
    expect(url.parentElement).toHaveTextContent(/^https:\/\/example\.com。后续$/);
    expect(container).toHaveTextContent('。后续');
  });

  it('uses the Streamdown code renderer and asynchronously highlights JavaScript', async () => {
    const { container } = render(
      <MarkdownPreview source={'```javascript\nconst answer = 42;\n```'} />,
    );

    const codeBlock = container.querySelector('[data-streamdown="code-block"]');
    expect(codeBlock).toBeInTheDocument();
    await waitFor(() => {
      expect(codeBlock?.querySelector('span[style*="--sdm-c"]')).toBeInTheDocument();
    });
  });

  it('keeps Mermaid fences as ordinary code', async () => {
    const { container } = render(
      <MarkdownPreview source={'```mermaid\ngraph TD\n  A --> B\n```'} />,
    );

    const codeBlock = container.querySelector('[data-streamdown="code-block"]');
    expect(codeBlock).toBeInTheDocument();
    expect(codeBlock).toHaveTextContent('graph TD');
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(container.querySelector('[data-streamdown="mermaid"]')).not.toBeInTheDocument();
  });
});
