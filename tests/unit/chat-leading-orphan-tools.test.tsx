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

describe('OpenClaw leading tool history rendering', () => {
  it('renders leading tool calls as stable tool cards and keeps later messages visible', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'orphan-exec',
        message: {
          role: 'assistant',
          id: 'orphan-exec',
          content: [
            { type: 'toolCall', id: 'e1', name: 'exec', input: { command: 'pwd' } },
            { type: 'tool_result', tool_use_id: 'e1', content: '/tmp/project' },
          ],
        },
      },
      {
        kind: 'message',
        id: 'user-1',
        message: { role: 'user', id: 'user-1', content: 'Continue the task' },
      },
      {
        kind: 'message',
        id: 'reply',
        message: {
          role: 'assistant',
          id: 'reply',
          content: [{ type: 'text', text: 'Finished.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('exec');
    expect(screen.getByText('Continue the task')).toBeInTheDocument();
    expect(screen.getByText('Finished.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Calling exec/i }));

    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('pwd');
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('/tmp/project');
  });
});
