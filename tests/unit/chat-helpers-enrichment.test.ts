import { describe, expect, it, vi } from 'vitest';
import {
  enrichWithToolResultFiles,
  enrichWithToolCallAttachments,
  enrichWithCachedImages,
  loadMissingPreviews,
} from '@/stores/chat/helpers';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage } from '@/stores/chat';

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

describe('enrichWithToolResultFiles', () => {
  it('does not promote image content blocks emitted by `read` tool results', () => {
    // The `read` tool re-encodes the file as JPEG so the model can "see" it.
    // The resulting image-data block is internal vision data, NOT a
    // user-facing artifact — it must NOT spill onto the next assistant
    // message as an attachment, otherwise every screenshot the agent
    // inspects would render in the chat.
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'toolCall', id: 'tc1', name: 'read', input: { path: '/tmp/foo.png' } }],
      },
      {
        role: 'toolresult',
        id: 't1',
        toolCallId: 'tc1',
        toolName: 'read',
        content: [
          { type: 'text', text: 'Read image file [image/jpeg]\n[Image: ...]' },
          { type: 'image', data: 'BASE64_BYTES_HERE', mimeType: 'image/jpeg' },
        ],
      },
      {
        role: 'assistant',
        id: 'a2',
        content: [{ type: 'text', text: 'I had a look at the screenshot.' }],
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);
    const reply = enriched.find((m) => m.id === 'a2')!;
    expect(reply._attachedFiles ?? []).toEqual([]);
  });

  it('does not promote raw image paths from tool result stdout (sips / ls / file)', () => {
    // `sips ... && ls -la *.jpg` etc. spam image paths in the tool's
    // stdout. Each one used to surface as an `_attachedFiles` entry on
    // the next assistant message, causing the canonical artifact to be
    // duplicated 3-4 times per send.
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'toolCall', id: 'tc1', name: 'exec', input: { command: 'sips ... && ls -la' } }],
      },
      {
        role: 'toolresult',
        id: 't1',
        toolCallId: 'tc1',
        toolName: 'exec',
        content: [{
          type: 'text',
          text: '/private/tmp/desktop_screenshot.png\n  /private/tmp/desktop_screenshot.jpg\n-rw-r--r--@ 1 me  staff  857671 May  6 18:05 /tmp/desktop_screenshot.jpg',
        }],
      },
      {
        role: 'assistant',
        id: 'a2',
        content: [{ type: 'text', text: 'Compressed to 837KB, sending again.' }],
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);
    const reply = enriched.find((m) => m.id === 'a2')!;
    expect(reply._attachedFiles ?? []).toEqual([]);
  });

  it('still promotes non-image artifact paths from tool results (PDF / XLSX)', () => {
    // Documents emitted by tools (e.g. a Python script that wrote a
    // spreadsheet to disk) ARE user-facing — they remain surfaced.
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'toolCall', id: 'tc1', name: 'exec', input: { command: '...' } }],
      },
      {
        role: 'toolresult',
        id: 't1',
        toolCallId: 'tc1',
        toolName: 'exec',
        content: [{ type: 'text', text: 'Saved report at /tmp/report.pdf and data at /tmp/sales.xlsx' }],
      },
      {
        role: 'assistant',
        id: 'a2',
        content: [{ type: 'text', text: 'Generated.' }],
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);
    const reply = enriched.find((m) => m.id === 'a2')!;
    const paths = (reply._attachedFiles ?? []).map((f) => f.filePath);
    expect(paths).toEqual(expect.arrayContaining(['/tmp/report.pdf', '/tmp/sales.xlsx']));
    expect(paths.find((p) => p?.endsWith('.png'))).toBeUndefined();
    expect(paths.find((p) => p?.endsWith('.jpg'))).toBeUndefined();
  });

  it('still promotes [media attached: ...] references emitted in tool results', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'toolCall', id: 'tc1', name: 'fetch', input: {} }],
      },
      {
        role: 'toolresult',
        id: 't1',
        toolCallId: 'tc1',
        toolName: 'fetch',
        content: [{
          type: 'text',
          text: 'Done [media attached: /tmp/foo.pdf (application/pdf) | /tmp/foo.pdf]',
        }],
      },
      {
        role: 'assistant',
        id: 'a2',
        content: [{ type: 'text', text: 'Here it is.' }],
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);
    const reply = enriched.find((m) => m.id === 'a2')!;
    const paths = (reply._attachedFiles ?? []).map((f) => f.filePath);
    expect(paths).toContain('/tmp/foo.pdf');
  });

  it('skips internal NO_REPLY turns when attaching pending tool-result files', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'toolCall', id: 'tc1', name: 'exec', input: { command: 'echo report > /tmp/report.pdf' } }],
      },
      {
        role: 'toolresult',
        id: 't1',
        toolCallId: 'tc1',
        toolName: 'exec',
        content: [{ type: 'text', text: 'Wrote /tmp/report.pdf' }],
      },
      {
        role: 'assistant',
        id: 'no-reply',
        content: [{ type: 'text', text: 'NO_REPLY' }],
      },
      {
        role: 'assistant',
        id: 'final',
        content: [{ type: 'text', text: 'Report is ready.' }],
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);
    const final = enriched.find((m) => m.id === 'final')!;
    expect(final._attachedFiles?.map((file) => file.filePath)).toEqual(['/tmp/report.pdf']);
    expect(enriched.find((m) => m.id === 'no-reply')?._attachedFiles ?? []).toEqual([]);
  });
});

describe('enrichWithCachedImages — Gateway media bubble dedup', () => {
  it('drops image-typed MEDIA: refs on the reply when the next message is a Gateway assistant-media bubble', () => {
    // When the agent emits `MEDIA:/tmp/x.png` the Gateway answers with a
    // dedicated `assistant-media` bubble. Surfacing the same image again
    // on the prior reply text would render two copies of the screenshot.
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'reply',
        content: [{ type: 'text', text: 'Compressed to 837KB:\n\nMEDIA:/tmp/desktop_screenshot.jpg' }],
      },
      {
        role: 'assistant',
        id: 'gateway-media',
        content: [{
          type: 'image',
          url: '/api/chat/media/outgoing/agent%3Amain%3As-1/abc-123/full',
          mimeType: 'image/jpeg',
          alt: 'desktop_screenshot.jpg',
        }],
      },
    ];

    const enriched = enrichWithCachedImages(messages);
    const reply = enriched.find((m) => m.id === 'reply')!;
    const replyPaths = (reply._attachedFiles ?? []).map((f) => f.filePath);
    expect(replyPaths).toEqual([]);

    const bubble = enriched.find((m) => m.id === 'gateway-media')!;
    const bubbleEntries = bubble._attachedFiles ?? [];
    expect(bubbleEntries).toHaveLength(1);
    expect(bubbleEntries[0]).toMatchObject({
      gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/abc-123/full',
      mimeType: 'image/jpeg',
      source: 'gateway-media',
    });
  });

  it('keeps non-image MEDIA: refs on the reply even when a Gateway bubble follows', () => {
    // Documents do not benefit from the Gateway's image pipeline; they
    // should still render as inline cards on the reply text.
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'reply',
        content: [{
          type: 'text',
          text: 'Report generated:\n\nMEDIA:/tmp/report.pdf\n\nMEDIA:/tmp/cover.png',
        }],
      },
      {
        role: 'assistant',
        id: 'gateway-media',
        content: [{
          type: 'image',
          url: '/api/chat/media/outgoing/agent%3Amain%3As-1/cover-id/full',
          mimeType: 'image/png',
          alt: 'cover.png',
        }],
      },
    ];

    const enriched = enrichWithCachedImages(messages);
    const reply = enriched.find((m) => m.id === 'reply')!;
    const replyPaths = (reply._attachedFiles ?? []).map((f) => f.filePath);
    expect(replyPaths).toContain('/tmp/report.pdf');
    expect(replyPaths.find((p) => p?.endsWith('.png'))).toBeUndefined();
  });

  it('attaches a gateway-media entry to the assistant-media bubble itself (text reply + injected bubble)', () => {
    // Reproduces the exact shape of session
    //   ~/.openclaw/agents/main/sessions/5fb6925e-...jsonl
    //   - msg 12: assistant reply "...MEDIA:/tmp/openclaw/desktop_*.png"
    //   - msg 13: assistant `image` block with flat `url`
    // After enrichment, msg 13 must carry exactly one `_attachedFiles`
    // entry sourced from the Gateway URL — otherwise ChatMessage's early
    // return swallows the bubble (no text, no tools, no extracted images,
    // no attachments → returns null → user sees nothing).
    const messages: RawMessage[] = [
      {
        role: 'user',
        id: 'u1',
        content: [{ type: 'text', text: 'Send me a desktop screenshot.' }],
      },
      {
        role: 'assistant',
        id: 'reply',
        content: [{ type: 'text', text: 'Done, here it is:\n\nMEDIA:/tmp/openclaw/desktop_20260506_193407.png' }],
      },
      {
        role: 'assistant',
        id: 'gateway-media',
        content: [{
          type: 'image',
          url: '/api/chat/media/outgoing/agent%3Amain%3As-1/e024afb9-2bc2-4a64-bf43-1c26fc779b6b/full',
          openUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/e024afb9-2bc2-4a64-bf43-1c26fc779b6b/full',
          mimeType: 'image/png',
          width: 1536,
          height: 998,
          alt: 'desktop_20260506_193407.png',
        }],
      },
    ];

    const enriched = enrichWithCachedImages(messages);
    const reply = enriched.find((m) => m.id === 'reply')!;
    expect((reply._attachedFiles ?? []).map((f) => f.filePath)).toEqual([]);

    const bubble = enriched.find((m) => m.id === 'gateway-media')!;
    const bubbleEntries = bubble._attachedFiles ?? [];
    expect(bubbleEntries).toHaveLength(1);
    expect(bubbleEntries[0]).toMatchObject({
      gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/e024afb9-2bc2-4a64-bf43-1c26fc779b6b/full',
      mimeType: 'image/png',
      source: 'gateway-media',
    });
  });

  it('keeps image-typed MEDIA: refs when there is no Gateway bubble after the reply', () => {
    // If the Gateway is disabled / hasn't injected a bubble, the agent's
    // own `MEDIA:` marker is the only signal and must still surface.
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'reply',
        content: [{ type: 'text', text: 'Here is the screenshot:\n\nMEDIA:/tmp/foo.png' }],
      },
    ];

    const enriched = enrichWithCachedImages(messages);
    const reply = enriched[0]!;
    const replyPaths = (reply._attachedFiles ?? []).map((f) => f.filePath);
    expect(replyPaths).toEqual(['/tmp/foo.png']);
  });

  it('promotes markdown local image paths to attached files', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'reply',
        content: [{
          type: 'text',
          text: '宇航员图片完成啦 🧑‍🚀✨\n\n![Astronaut with Milky Way in helmet visor](/Users/me/.openclaw/media/tool-image-generation/cat.png)',
        }],
      },
    ];

    const enriched = enrichWithCachedImages(messages);
    expect(enriched[0]?._attachedFiles?.map((file) => file.filePath)).toEqual([
      '/Users/me/.openclaw/media/tool-image-generation/cat.png',
    ]);
  });

  it('promotes markdown gateway image URLs to gateway-media attachments', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'reply',
        content: [{
          type: 'text',
          text: 'Done\n\n![Astronaut with Milky Way in helmet visor](/api/chat/media/outgoing/agent%3Amain%3As-1/abc/full)',
        }],
      },
    ];

    const enriched = enrichWithCachedImages(messages);
    expect(enriched[0]?._attachedFiles?.[0]).toMatchObject({
      gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/abc/full',
      source: 'gateway-media',
      fileName: 'Astronaut with Milky Way in helmet visor',
    });
  });
});

describe('enrichWithToolCallAttachments', () => {
  it('attaches image paths from message tool attachments array', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'send-image',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'message',
          input: {
            action: 'send',
            attachments: [{ filePath: '/Users/me/.openclaw/media/tool-image-generation/cat.png' }],
          },
        }],
      },
    ];

    const enriched = enrichWithToolCallAttachments(messages);
    expect(enriched[0]?._attachedFiles?.map((file) => file.filePath)).toEqual([
      '/Users/me/.openclaw/media/tool-image-generation/cat.png',
    ]);
    expect(enriched[0]?._attachedFiles?.[0]?.mimeType).toBe('image/png');
  });
});

describe('loadMissingPreviews', () => {
  it('retries image preview hydration when Gateway media records are not ready yet', async () => {
    vi.useFakeTimers();
    try {
      const gatewayUrl = '/api/chat/media/outgoing/agent%3Amain%3As-1/generated/full';
      const messages: RawMessage[] = [
        {
          role: 'assistant',
          content: [],
          _attachedFiles: [{
            fileName: 'generated.png',
            mimeType: 'image/png',
            fileSize: 0,
            preview: null,
            gatewayUrl,
            source: 'gateway-media',
          }],
        },
      ];

      vi.mocked(invokeIpc)
        .mockResolvedValueOnce({ [gatewayUrl]: { preview: null, fileSize: 0 } })
        .mockResolvedValueOnce({ [gatewayUrl]: { preview: 'data:image/png;base64,ok', fileSize: 42 } });

      const result = loadMissingPreviews(messages);
      expect(invokeIpc).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(300);
      await expect(result).resolves.toBe(true);

      expect(invokeIpc).toHaveBeenCalledTimes(2);
      expect(messages[0]?._attachedFiles?.[0]).toMatchObject({
        preview: 'data:image/png;base64,ok',
        fileSize: 42,
      });
      expect(messages[0]?._attachedFiles?.[0]?.previewStatus).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks image previews unavailable after retry exhaustion', async () => {
    vi.useFakeTimers();
    try {
      const gatewayUrl = '/api/chat/media/outgoing/agent%3Amain%3As-1/missing/full';
      const messages: RawMessage[] = [
        {
          role: 'assistant',
          content: [],
          _attachedFiles: [{
            fileName: 'missing.png',
            mimeType: 'image/png',
            fileSize: 0,
            preview: null,
            gatewayUrl,
            source: 'gateway-media',
          }],
        },
      ];

      vi.mocked(invokeIpc).mockResolvedValue({ [gatewayUrl]: { preview: null, fileSize: 0 } });

      const result = loadMissingPreviews(messages);
      await vi.advanceTimersByTimeAsync(300 + 900 + 1800);
      await expect(result).resolves.toBe(true);

      expect(invokeIpc).toHaveBeenCalledTimes(4);
      expect(messages[0]?._attachedFiles?.[0]?.previewStatus).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});
