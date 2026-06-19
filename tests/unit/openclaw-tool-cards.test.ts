import { describe, expect, it } from 'vitest';
import { isToolCardError, isToolErrorOutput } from '@/chat-core/openclaw-port/tool-cards';

describe('OpenClaw tool cards', () => {
  it('treats non-zero command exit output as a tool error', () => {
    expect(isToolErrorOutput([
      'cat: /tmp/missing.txt: No such file or directory',
      '',
      '(Command exited with code 1)',
    ].join('\n'))).toBe(true);
  });

  it('does not treat zero command exit output as a tool error', () => {
    expect(isToolErrorOutput([
      'ok',
      '',
      '(Command exited with code 0)',
    ].join('\n'))).toBe(false);
  });

  it('does not let an explicit false flag hide a non-zero command exit', () => {
    expect(isToolCardError({
      id: 'exec-1',
      toolName: 'exec',
      isError: false,
      outputText: [
        'cat: /tmp/missing.txt: No such file or directory',
        '',
        '(Command exited with code 1)',
      ].join('\n'),
    })).toBe(true);
  });
});
