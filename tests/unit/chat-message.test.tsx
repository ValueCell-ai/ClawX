import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import type { RawMessage } from '@/stores/chat';

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

  it('derives preview cards from assistant text paths when attachments are missing', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: '已生成测试 PDF 文件： 测试PDF文件.pdf 位置： `/Users/zhonghaolu/.openclaw/workspace/测试PDF文件.pdf`',
    };

    render(<ChatMessage message={message} suppressProcessAttachments />);

    expect(screen.getByText('测试PDF文件.pdf')).toBeInTheDocument();
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
