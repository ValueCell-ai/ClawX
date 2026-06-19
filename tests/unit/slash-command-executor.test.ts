import { describe, expect, it, vi } from 'vitest';
import { executeSlashCommand } from '@/chat-core/openclaw-port/slash-command-executor';
import type { ChatCoreClient } from '@/chat-core/openclaw-port/types';

const client = {
  request: vi.fn(),
} satisfies ChatCoreClient;

describe('executeSlashCommand', () => {
  it('lists skills with executable slash command syntax', async () => {
    const result = await executeSlashCommand(client, 'session-1', 'skills', '', {
      skills: [{ name: 'create-skill', description: 'Create reusable skills' }],
    });

    expect(result.content).toContain('`/skill create-skill` - Create reusable skills');
  });

  it('shows a selected skill using the same command syntax', async () => {
    const result = await executeSlashCommand(client, 'session-1', 'skill', 'create-skill', {
      skills: [{ name: 'create-skill', description: 'Create reusable skills' }],
    });

    expect(result.content).toBe('/skill create-skill - Create reusable skills');
  });
});
