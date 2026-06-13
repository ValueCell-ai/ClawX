import { describe, expect, it } from 'vitest';
import { extractText, sanitizeAssistantReplyText } from '@/pages/Chat/message-utils';

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

  it('strips internal delivery-planning narration before the user-facing caption', () => {
    const text = [
      "The message tool isn't suitable here since I'm in a webchat session with no proper routing target. The runtime context says 'Use the current visible-reply contract... Otherwise, write the normal final reply and attach every generated media path with final-reply MEDIA lines.' Since webchat isn't a valid channel for the message tool, I should fall back to writing the normal final reply with MEDIA directives.",
      '西瓜切片来了 🍉 红透多汁，夏日续命必备~',
      'MEDIA:/Users/zhonghaolu/.openclaw/media/tool-image-generation/clawx-image-1---4d2c1ef7-0d16-451c-9c09-9b58c4c99846.png',
    ].join('\n\n');

    expect(extractText({ role: 'assistant', content: text })).toBe('西瓜切片来了 🍉 红透多汁，夏日续命必备~');
    expect(sanitizeAssistantReplyText(text)).toBe('西瓜切片来了 🍉 红透多汁，夏日续命必备~');
  });

  it('strips inline MEDIA: markers glued to caption punctuation', () => {
    const text =
      '橘子来了 🍊 一筐新鲜砂糖橘，酸甜爆汁~MEDIA:/Users/zhonghaolu/.openclaw/media/tool-image-generation/clawx-image-1---03c6fed9-836c-49ed-87df-09969d5d6fe1.png';

    expect(extractText({ role: 'assistant', content: text })).toBe('橘子来了 🍊 一筐新鲜砂糖橘，酸甜爆汁~');
  });
});
