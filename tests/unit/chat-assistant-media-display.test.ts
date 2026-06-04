import { describe, expect, it } from 'vitest';
import { extractText } from '@/pages/Chat/message-utils';

describe('assistant media path display cleanup', () => {
  it('strips bare OpenClaw media paths when the image is shown as an attachment card', () => {
    const text = [
      '宇航员图片生成完成啦 🧑‍🚀✨',
      '/Users/zhonghaolu/.openclaw/media/tool-image-generation/clawx-image-1---82d6c7e6-ea44-4850-a24b-9e88e1660683.png',
    ].join('\n');

    expect(extractText({ role: 'assistant', content: text })).toBe('宇航员图片生成完成啦 🧑‍🚀✨');
  });

  it('still strips MEDIA: tagged OpenClaw artifact paths', () => {
    const text = 'Done:\n\nMEDIA:/Users/alice/.openclaw/media/outbound/cat---abc.png';

    expect(extractText({ role: 'assistant', content: text })).toBe('Done:');
  });

  it('strips MEDIA: tagged Windows artifact paths', () => {
    const text = String.raw`SVG file is ready:

MEDIA:C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`;

    expect(extractText({ role: 'assistant', content: text })).toBe('SVG file is ready:');
  });

  it('strips bare Windows OpenClaw media paths when surfaced as attachment cards', () => {
    const text = String.raw`Done:
C:\Users\alice\.openclaw\media\outbound\cat---abc.png`;

    expect(extractText({ role: 'assistant', content: text })).toBe('Done:');
  });

  it('strips markdown image syntax that cannot be rendered directly', () => {
    const text = '宇航员图片完成啦 🧑‍🚀✨\n\n![Astronaut with Milky Way in helmet visor](/api/chat/media/outgoing/agent%3Amain%3As-1/abc/full)';

    expect(extractText({ role: 'assistant', content: text })).toBe('宇航员图片完成啦 🧑‍🚀✨');
  });
});
