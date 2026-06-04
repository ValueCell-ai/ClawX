import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import {
  hasDeliveredImageGenerationResult,
  IMAGE_GENERATION_TIMEOUT_MS,
  isImageGenerationPending,
} from '@/pages/Chat/image-generation-status';

const TASK_ID = '27443fdb-6cca-48e6-a3a7-ee34b0491aee';
const NOW = 1_700_000_000_000;

describe('isImageGenerationPending', () => {
  it('returns true while waiting after image_generate without a final reply', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'astronaut' } }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 5,
        content: [{ type: 'text', text: '图片生成中，稍等片刻 🧑‍🚀✨' }],
      },
    ];

    expect(isImageGenerationPending(segmentMessages, [], NOW)).toBe(true);
  });

  it('stays pending after async task start even if the agent posts a visible status reply', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'cherry' } }],
      },
      {
        role: 'toolresult',
        toolName: 'image_generate',
        timestamp: NOW / 1000 + 1,
        content: [{
          type: 'text',
          text: `Background task started for image generation (${TASK_ID}).`,
        }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 2,
        content: [{ type: 'text', text: '图已经开始生成啦 🍒 完成后会直接发到这里。' }],
      },
    ];

    expect(isImageGenerationPending(segmentMessages, [], NOW + 2_000)).toBe(true);
  });

  it('returns false after the inter-session completion event arrives', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'toolresult',
        toolName: 'image_generate',
        timestamp: NOW / 1000,
        content: [{
          type: 'text',
          text: `Background task started for image generation (${TASK_ID}).`,
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'text',
          text: `[Inter-session message] sourceSession=image_generate:${TASK_ID} sourceTool=image_generate`,
        }],
      },
    ];

    expect(isImageGenerationPending(segmentMessages, [], NOW)).toBe(false);
  });

  it('returns false once a non-generating assistant reply arrives', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'astronaut' } }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 5,
        content: [{ type: 'text', text: '图片生成中，稍等片刻 🧑‍🚀✨' }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 120,
        content: [{ type: 'text', text: '抱歉，图片生成超时了，稍后重试一下吧 🧑‍🚀' }],
      },
    ];

    expect(isImageGenerationPending(segmentMessages, [], NOW + 120_000)).toBe(false);
  });

  it('returns false after the configured timeout even if only generating narration exists', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'astronaut' } }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 5,
        content: [{ type: 'text', text: '图片生成中，稍等片刻 🧑‍🚀✨' }],
      },
    ];

    expect(
      isImageGenerationPending(
        segmentMessages,
        [],
        NOW + IMAGE_GENERATION_TIMEOUT_MS + 20_000,
      ),
    ).toBe(false);
  });

  it('returns false when a stale streaming tool status is still marked running', () => {
    expect(isImageGenerationPending([], [{
      name: 'image_generate',
      status: 'running',
      updatedAt: NOW - IMAGE_GENERATION_TIMEOUT_MS - 60_000,
    }], NOW)).toBe(false);
  });

  it('returns true while image_generate is actively running in streaming tools', () => {
    expect(isImageGenerationPending([], [{
      name: 'image_generate',
      status: 'running',
      updatedAt: NOW,
    }], NOW)).toBe(true);
  });

  it('returns false once an image attachment is delivered', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'astronaut' } }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 90,
        content: [{ type: 'text', text: '宇航员图片完成啦 🧑‍🚀✨' }],
        _attachedFiles: [{
          fileName: 'astronaut.png',
          mimeType: 'image/png',
          fileSize: 123,
          preview: null,
          filePath: '/tmp/astronaut.png',
        }],
      },
    ];

    expect(isImageGenerationPending(segmentMessages, [], NOW + 90_000)).toBe(false);
    expect(hasDeliveredImageGenerationResult(segmentMessages)).toBe(true);
  });

  it('returns false after message tool delivers generated image media', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'tomato' } }],
      },
      {
        role: 'toolresult',
        toolName: 'image_generate',
        timestamp: NOW / 1000 + 1,
        content: [{
          type: 'text',
          text: `Background task started for image generation (${TASK_ID}).`,
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'text',
          text: `[Inter-session message] sourceSession=image_generate:${TASK_ID} sourceTool=image_generate`,
        }],
      },
      {
        role: 'toolresult',
        toolName: 'message',
        content: [{ type: 'text', text: '{ "status": "ok" }' }],
        details: {
          status: 'ok',
          mediaUrl: '/Users/me/.openclaw/media/tool-image-generation/tomato.png',
          sourceReply: {
            mediaUrls: ['/Users/me/.openclaw/media/tool-image-generation/tomato.png'],
          },
        },
      } as RawMessage,
    ];

    expect(isImageGenerationPending(segmentMessages, [], NOW + 90_000)).toBe(false);
    expect(hasDeliveredImageGenerationResult(segmentMessages)).toBe(true);
  });

  it('returns false after image delivery even if streaming tool status is still running', () => {
    const segmentMessages: RawMessage[] = [
      {
        role: 'assistant',
        timestamp: NOW / 1000,
        content: [{ type: 'toolCall', id: 'call_1', name: 'image_generate', arguments: { prompt: 'narwhal' } }],
      },
      {
        role: 'assistant',
        timestamp: NOW / 1000 + 90,
        content: [{
          type: 'image',
          url: '/api/chat/media/outgoing/agent%3Amain%3As-1/narwhal/full',
          mimeType: 'image/png',
          alt: 'narwhal.png',
        }],
        _attachedFiles: [{
          fileName: 'narwhal.png',
          mimeType: 'image/png',
          fileSize: 123,
          preview: null,
          gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/narwhal/full',
          source: 'gateway-media',
        }],
      },
    ];

    expect(isImageGenerationPending(segmentMessages, [{
      name: 'image_generate',
      status: 'running',
      updatedAt: NOW + 90_000,
    }], NOW + 90_000)).toBe(false);
  });
});
