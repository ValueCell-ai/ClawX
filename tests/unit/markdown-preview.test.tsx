import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MarkdownPreview from '@/components/file-preview/MarkdownPreview';

describe('MarkdownPreview', () => {
  it('lets prose margins control vertical spacing without a root margin reset', () => {
    const { container } = render(<MarkdownPreview source="Preview body" />);
    const preview = container.querySelector('.clawx-markdown-preview');

    expect(preview).not.toHaveClass('space-y-0');
  });

  it.each([
    ['YAML', '---\ntitle: YAML metadata\n---', 'title: YAML metadata'],
    ['TOML', '+++\ntitle = "TOML metadata"\n+++', 'title = "TOML metadata"'],
  ])('shows %s frontmatter expanded by default and allows collapsing it', (_format, frontmatter, metadata) => {
    render(
      <MarkdownPreview source={`${frontmatter}\n\n# Visible heading\n\nVisible body`} />,
    );

    expect(screen.getByRole('heading', { name: 'Visible heading' })).toBeVisible();
    expect(screen.getByText('Visible body')).toBeVisible();
    const disclosure = screen.getByTestId('markdown-frontmatter');
    const content = screen.getByTestId('markdown-frontmatter-content');
    expect(disclosure).toHaveAttribute('open');
    expect(content).toBeVisible();
    expect(content.textContent).toBe(metadata);
    fireEvent.click(disclosure.querySelector('summary')!);
    expect(content).not.toBeVisible();
    fireEvent.click(disclosure.querySelector('summary')!);
    expect(content).toBeVisible();
  });

  it('preserves nested multiline metadata with BOM and CRLF as inert text', () => {
    const metadata = 'name: pdf\r\ndescription: |\r\n  Multi-line description\r\n  <script>alert(1)</script>\r\nmetadata:\r\n  tools: [read, write]';
    const { container } = render(<MarkdownPreview source={`\uFEFF---\r\n${metadata}\r\n---\r\n\r\n# Body`} />);
    expect(screen.getByTestId('markdown-frontmatter-content')).toBeVisible();
    expect(screen.getByTestId('markdown-frontmatter-content').textContent).toBe(metadata);
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Body' })).toBeVisible();
  });

  it('does not mistake body separators or fenced YAML for frontmatter', () => {
    const { container } = render(<MarkdownPreview source={'# Body\n\n---\n\n```yaml\nname: example\n```'} />);

    expect(screen.queryByTestId('markdown-frontmatter')).not.toBeInTheDocument();
    expect(container.querySelector('hr')).toBeInTheDocument();
    expect(container.querySelector('[data-streamdown="code-block"]')).toHaveTextContent('name: example');
  });

  it('keeps an unclosed frontmatter fence in the visible body', () => {
    const { container } = render(<MarkdownPreview source={'---\nname: incomplete\n\nbody'} />);

    expect(screen.queryByTestId('markdown-frontmatter')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('name: incomplete');
    expect(container).toHaveTextContent('body');
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
    expect(codeBlock?.querySelector('[data-streamdown="code-block-copy-button"]')).toBeVisible();
    expect(codeBlock?.querySelector('[data-streamdown="code-block-download-button"]')).not.toBeInTheDocument();
  });

  it('keeps Mermaid fences as ordinary code', async () => {
    const { container } = render(
      <MarkdownPreview source={'```mermaid\ngraph TD\n  A --> B\n```'} />,
    );

    const codeBlock = container.querySelector('[data-streamdown="code-block"]');
    expect(codeBlock).toBeInTheDocument();
    expect(codeBlock).toHaveTextContent('graph TD');
    expect(codeBlock?.querySelector('[data-streamdown="code-block-body"] svg')).not.toBeInTheDocument();
    expect(container.querySelector('[data-streamdown="mermaid"]')).not.toBeInTheDocument();
  });
});
