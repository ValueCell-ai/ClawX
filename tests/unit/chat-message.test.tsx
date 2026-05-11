import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import type { RawMessage } from '@/stores/chat';

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
  statFile: vi.fn(async (path: string) => {
    if (path.includes('missing') || path.includes('不存在')) {
      return { ok: false, error: 'notFound' };
    }
    const isFile = /\.[A-Za-z0-9]+$/.test(path);
    return {
      ok: true,
      isFile,
      isDir: !isFile,
      size: isFile ? 1024 : 0,
    };
  }),
}));

describe('ChatMessage attachment dedupe', () => {
  it('keeps attachment-only assistant replies visible even when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [],
      _attachedFiles: [
        {
          fileName: 'artifact.png',
          mimeType: 'image/png',
          fileSize: 0,
          preview: '/tmp/artifact.png',
          filePath: '/tmp/artifact.png',
          source: 'tool-result',
        },
      ],
    };

    render(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByAltText('artifact.png')).toBeInTheDocument();
  });

  it('keeps image artifacts visible alongside reply text when process attachments are suppressed', () => {
    // Regression for media outgoing being silently dropped when the agent
    // accompanies a `MEDIA:/path.png` artifact with any narration text:
    // process-attachment filtering used to require PDF/XLSX/dir/skill but
    // had no carve-out for images, so the file card never rendered.
    const message: RawMessage = {
      role: 'assistant',
      content: 'Screenshot taken, sending it to you as an attachment.',
      _attachedFiles: [
        {
          fileName: 'desktop_screenshot.png',
          mimeType: 'image/png',
          fileSize: 1234,
          preview: 'data:image/png;base64,abc',
          filePath: '/tmp/desktop_screenshot.png',
          source: 'tool-result',
        },
      ],
    };

    render(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByAltText('desktop_screenshot.png')).toBeInTheDocument();
  });

  it('keeps message-ref image artifacts visible alongside reply text when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Compressed, sending it to you:',
      _attachedFiles: [
        {
          fileName: 'desktop_screenshot.jpg',
          mimeType: 'image/jpeg',
          fileSize: 837_000,
          preview: 'data:image/jpeg;base64,xyz',
          filePath: '/tmp/desktop_screenshot.jpg',
          source: 'message-ref',
        },
      ],
    };

    render(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByAltText('desktop_screenshot.jpg')).toBeInTheDocument();
  });

  it('keeps pdf and spreadsheet artifacts visible when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Here are the generated files.',
      _attachedFiles: [
        {
          fileName: 'sales.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 1024,
          preview: null,
          filePath: '/tmp/sales.xlsx',
          source: 'message-ref',
        },
        {
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
          preview: null,
          filePath: '/tmp/report.pdf',
          source: 'tool-result',
        },
      ],
    };

    render(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.getByText('sales.xlsx')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('derives preview cards from assistant text paths when attachments are missing', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '已生成测试 PDF 文件： 测试PDF文件.pdf 位置： `/Users/zhonghaolu/.openclaw/workspace/测试PDF文件.pdf`',
    };

    render(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('测试PDF文件.pdf')).toBeInTheDocument();
  });

  it('derives skill directory cards from assistant text paths', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '名称： open-eastmoney\n位置： ~/.openclaw/skills/open-eastmoney\n校验结果：通过',
    };

    render(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('open-eastmoney')).toBeInTheDocument();
    expect(screen.getByText('文件夹')).toBeInTheDocument();
  });

  it('keeps unicode Windows skill directory paths as cards', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: String.raw`位置： C:\Users\张三\.openclaw\skills\打开东方财富`,
    };

    render(<ChatMessage message={message} suppressProcessAttachments />);

    expect(await screen.findByText('打开东方财富')).toBeInTheDocument();
    expect(screen.getByText('文件夹')).toBeInTheDocument();
  });

  it('shows SKILL.md as a previewable file card instead of a folder', async () => {
    const onOpenFile = vi.fn();
    const message: RawMessage = {
      role: 'assistant',
      content: '位置： ~/.openclaw/skills/open-baidu\nMarkdown 文件： ~/.openclaw/skills/open-baidu/SKILL.md',
    };

    render(<ChatMessage message={message} suppressProcessAttachments onOpenFile={onOpenFile} />);

    expect(await screen.findByText('open-baidu')).toBeInTheDocument();
    expect(await screen.findByText('SKILL.md')).toBeInTheDocument();
    expect(screen.getAllByText('文件夹')).toHaveLength(1);

    fireEvent.click(screen.getByText('SKILL.md'));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'SKILL.md',
      filePath: '~/.openclaw/skills/open-baidu/SKILL.md',
      mimeType: 'text/markdown',
    }));
  });

  it('does not show cards for hallucinated missing paths', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '不存在的文件： ~/.openclaw/skills/missing-skill/SKILL.md',
    };

    render(<ChatMessage message={message} suppressProcessAttachments />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument();
  });

  it('continues hiding non-preview process attachments when process attachments are suppressed', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'I also used a temporary file.',
      _attachedFiles: [
        {
          fileName: 'debug.log',
          mimeType: 'text/plain',
          fileSize: 1024,
          preview: null,
          filePath: '/tmp/debug.log',
          source: 'message-ref',
        },
      ],
    };

    render(
      <ChatMessage
        message={message}
        suppressProcessAttachments
      />,
    );

    expect(screen.queryByText('debug.log')).not.toBeInTheDocument();
  });
});

describe('ChatMessage LaTeX rendering', () => {
  it('renders inline `$...$` math with KaTeX', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Mass-energy equivalence: $E=mc^2$ is famous.',
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders display `$$...$$` math as a block', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Definite integral:\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n',
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('renders `\\(...\\)` inline math (OpenAI-style escaping)', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Quadratic formula: \\(x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\).',
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull();
  });

  it('renders `\\[...\\]` block math (OpenAI-style escaping)', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Sum formula:\n\n\\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]',
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not rewrite `\\(` inside code fences', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Code sample:\n\n```\nprintf("\\(hello\\)")\n```\n',
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.textContent).toContain('\\(hello\\)');
    expect(container.querySelector('.katex')).toBeNull();
  });
});

describe('ChatMessage word wrapping', () => {
  // Regression for #931: word-break:break-all on the message bubble wrappers
  // forced English words to split mid-character. Long unbreakable tokens
  // (URLs, identifiers) still wrap via overflow-wrap:break-word; inline
  // <code> and <a> children keep break-all because those carry non-prose
  // tokens where mid-char breaks are still desirable.
  it('does not apply break-all to the assistant prose wrapper', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'The neural network response should wrap at word boundaries.',
    };
    const { container } = render(<ChatMessage message={message} />);
    const prose = container.querySelector('.prose');
    expect(prose).not.toBeNull();
    expect(prose?.classList.contains('break-all')).toBe(false);
    expect(prose?.classList.contains('break-words')).toBe(true);
  });

  it('does not apply break-all to user message text', () => {
    const message: RawMessage = {
      role: 'user',
      content: 'A user-typed sentence that should also wrap by words, not characters.',
    };
    const { container } = render(<ChatMessage message={message} />);
    const paragraph = container.querySelector('p.whitespace-pre-wrap');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.classList.contains('break-all')).toBe(false);
    expect(paragraph?.classList.contains('break-words')).toBe(true);
  });

  it('keeps break-all on inline code so long identifiers can still break mid-token', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Use `someVeryLongIdentifierNameThatShouldStillBreakAnywhere` here.',
    };
    const { container } = render(<ChatMessage message={message} />);
    const inlineCode = container.querySelector('.prose code');
    expect(inlineCode).not.toBeNull();
    expect(inlineCode?.classList.contains('break-all')).toBe(true);
  });
});
