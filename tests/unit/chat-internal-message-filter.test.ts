import { describe, expect, it } from 'vitest';
import { isInternalMessage } from '@/stores/chat/helpers';

describe('chat internal message filter', () => {
  it('filters runtime system injection bundle like async exec completion payload', () => {
    const content = [
      'System (untrusted): [2026-04-22 10:06:24 GMT+8] Exec completed (nimbler, code 0) ...',
      'An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.',
      'Current time: Wednesday, April 22nd, 2026 - 10:06 (Asia/Shanghai) / 2026-04-22 02:06 UTC',
    ].join('\n\n');

    expect(isInternalMessage({ role: 'user', content })).toBe(true);
  });

  it('filters standalone current-time runtime ping', () => {
    const content = 'Current time: Wednesday, April 22nd, 2026 - 10:06 (Asia/Shanghai) / 2026-04-22 02:06 UTC';

    expect(isInternalMessage({ role: 'assistant', content })).toBe(true);
  });

  it('does not filter normal user message that starts with current time', () => {
    const content = 'Current time: 北京现在几点？';

    expect(isInternalMessage({ role: 'user', content })).toBe(false);
  });

  it('does not filter normal assistant text that mentions async completion phrase only', () => {
    const content = 'The sentence "An async command you ran earlier has completed" is just an example in docs.';

    expect(isInternalMessage({ role: 'assistant', content })).toBe(false);
  });
});
