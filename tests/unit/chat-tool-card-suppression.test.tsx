import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { ChatSurface } from '@/pages/Chat/ChatSurface';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        'toolCard.show': 'Show',
        'toolCard.hide': 'Hide',
        'toolCard.error': 'Error',
        'toolCard.calling': 'Calling {{tool}}',
      };
      const template = values[key] ?? key;
      return Object.entries(vars ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

describe('OpenClaw tool card rendering', () => {
  it('renders tool messages as expandable cards without the removed raw-output action', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'user-1',
        message: { id: 'user-1', role: 'user', content: 'Generate assets' },
      },
      {
        kind: 'message',
        id: 'tool-exec',
        message: {
          role: 'assistant',
          id: 'tool-exec',
          content: [
            { type: 'tool_use', id: 'exec-1', name: 'exec', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'exec-1', content: 'dist\nsrc' },
          ],
        },
      },
      {
        kind: 'message',
        id: 'reply',
        message: {
          role: 'assistant',
          id: 'reply',
          content: [{ type: 'text', text: 'All done.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    const card = screen.getByTestId('chat-tool-card');
    expect(card).toHaveTextContent('exec');
    expect(card.className).toContain('w-[50vw]');
    expect(screen.getByText('Generate assets')).toBeInTheDocument();
    expect(screen.getByText('All done.')).toBeInTheDocument();
    expect(screen.queryByText('dist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raw output' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Calling exec/i }));

    expect(card).toHaveTextContent('dist');
    expect(screen.queryByRole('button', { name: 'Raw output' })).not.toBeInTheDocument();
  });
});
