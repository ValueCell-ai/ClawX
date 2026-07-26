import { describe, expect, it } from 'vitest';
import {
  extractImageGenerationCompletionFromAcpEnvelope,
  extractImageGenerationCompletionFromGatewayChatMessage,
  extractImageGenerationCompletionFromRuntimeEvent,
  extractImageGenerationTranscriptSupplement,
  extractImageGenerationStartFromAcpEnvelope,
  imageGenerationEvidenceKey,
} from '@/lib/acp/image-generation-compat';

const SESSION_KEY = 'agent:main:main';
const TASK_ID = '32aa3a12-a05b-4074-af4e-246cc4a9a303';

describe('ACP image-generation compatibility extraction', () => {
  it('extracts a background image-generation task id from ACP tool output', () => {
    const start = extractImageGenerationStartFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-image',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${TASK_ID}). Do not call image_generate again.`,
            },
          }],
        },
      },
    });

    expect(start).toEqual({
      sessionKey: SESSION_KEY,
      taskId: TASK_ID,
      toolCallId: 'tool-image',
      evidenceId: `start:${SESSION_KEY}:tool-image:${TASK_ID}`,
    });
  });

  it('extracts message-tool media URLs from Gateway chat-message payloads', () => {
    const evidence = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        state: 'final',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: {
            mediaUrl: '/Users/me/.openclaw/media/outgoing/sky.png',
            sourceReply: {
              mediaUrls: ['/api/chat/media/outgoing/session/attachment-1/file'],
            },
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      sessionKey: SESSION_KEY,
      source: 'gateway-chat-message',
      caption: 'Generated image is ready.',
    });
    expect(evidence?.candidates).toEqual([
      { key: '/Users/me/.openclaw/media/outgoing/sky.png', filePath: '/Users/me/.openclaw/media/outgoing/sky.png', mimeType: 'image/png' },
      { key: '/api/chat/media/outgoing/session/attachment-1/file', gatewayUrl: '/api/chat/media/outgoing/session/attachment-1/file' },
    ]);
  });

  it('extracts runtime assistant media URLs from active session events', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-clouds.webp'],
    });

    expect(evidence?.candidates).toEqual([
      { key: '/tmp/generated-clouds.webp', filePath: '/tmp/generated-clouds.webp', mimeType: 'image/webp' },
    ]);
  });

  it('extracts message-tool media URLs nested under runtime result details', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'tool.completed',
      runId: `image_generate:${TASK_ID}:ok`,
      sessionKey: `image_generate:${TASK_ID}`,
      toolCallId: 'message-tool',
      name: 'message',
      result: {
        content: [{
          type: 'text',
          text: 'Sent visible reply to the current source conversation via internal-ui.',
        }],
        details: {
          status: 'ok',
          deliveryStatus: 'sent',
          sourceReplySink: 'internal-ui',
          sourceReply: {
            text: 'Your sunset over the mountains is ready.',
            mediaUrls: ['/tmp/generated-sky.png'],
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      sessionKey: `image_generate:${TASK_ID}`,
      source: 'runtime-event',
      caption: 'Your sunset over the mountains is ready.',
    });
    expect(evidence?.candidates).toEqual([
      { key: '/tmp/generated-sky.png', filePath: '/tmp/generated-sky.png', mimeType: 'image/png' },
    ]);
  });

  it('extracts authoritative source-reply text from ACP tool output with or without media', () => {
    const completion = (sourceReply: { text: string; mediaUrls?: string[] }) => extractImageGenerationCompletionFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'message-tool',
          status: 'completed',
          rawOutput: {
            details: {
              status: 'ok',
              deliveryStatus: 'sent',
              sourceReplySink: 'internal-ui',
              sourceReply,
            },
          },
        },
      },
    });

    expect(completion({
      text: 'Here is the watercolor skyline you requested.',
      mediaUrls: ['/tmp/generated-skyline.png'],
    })).toMatchObject({
      source: 'acp-session-update',
      caption: 'Here is the watercolor skyline you requested.',
      candidates: [{ key: '/tmp/generated-skyline.png' }],
    });
    expect(completion({
      text: 'Image generation failed because no image model is available.',
    })).toMatchObject({
      source: 'acp-session-update',
      caption: 'Image generation failed because no image model is available.',
      candidates: [],
    });
  });

  it('preserves source-reply text exactly and rejects unsuccessful internal-UI deliveries', () => {
    const completion = (details: Record<string, unknown>) => extractImageGenerationCompletionFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'message-tool',
          status: 'completed',
          rawOutput: { details },
        },
      },
    });
    const exactText = '  First line\n  indented line  \n';

    expect(completion({
      status: 'ok',
      deliveryStatus: 'sent',
      sourceReplySink: 'internal-ui',
      sourceReply: { text: exactText },
    })?.caption).toBe(exactText);
    expect(completion({
      status: 'error',
      deliveryStatus: 'failed',
      sourceReplySink: 'internal-ui',
      sourceReply: { text: 'This was not delivered.', mediaUrls: ['/tmp/not-delivered.png'] },
    })).toBeNull();
    expect(completion({
      status: 'ok',
      deliveryStatus: 'cancelled',
      sourceReplySink: 'internal-ui',
      sourceReply: { text: 'This was cancelled.' },
    })).toBeNull();
  });

  it('extracts text-only internal-UI failures from runtime message-tool deliveries', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'tool.completed',
      runId: `image_generate:${TASK_ID}:error`,
      sessionKey: `image_generate:${TASK_ID}`,
      toolCallId: 'message-tool',
      name: 'message',
      result: {
        details: {
          status: 'ok',
          deliveryStatus: 'sent',
          sourceReplySink: 'internal-ui',
          sourceReply: {
            text: 'Image generation timed out before an image was produced.',
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      sessionKey: `image_generate:${TASK_ID}`,
      source: 'runtime-event',
      taskId: TASK_ID,
      caption: 'Image generation timed out before an image was produced.',
      candidates: [],
    });
  });

  it('accepts OpenClaw message-tool delivery details when lifecycle meta is completed', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'tool.completed',
      runId: `image_generate:${TASK_ID}:ok`,
      sessionKey: `image_generate:${TASK_ID}`,
      toolCallId: 'message-tool',
      name: 'message',
      meta: { status: 'completed' },
      result: {
        details: {
          deliveryStatus: 'sent',
          sourceReplySink: 'internal-ui',
          sourceReply: {
            text: 'The generated puppy is ready.',
            mediaUrls: ['/tmp/generated-puppy.png'],
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      taskId: TASK_ID,
      caption: 'The generated puppy is ready.',
      candidates: [{ key: '/tmp/generated-puppy.png' }],
    });
  });

  it('extracts final assistant text from a correlated image-generation completion run', () => {
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: `image_generate:${TASK_ID}:error`,
      sessionKey: SESSION_KEY,
      phase: 'final_answer',
      text: '抱歉，这次小猫图生成失败了：当前图像生成模型通道不可用。',
    })).toMatchObject({
      taskId: TASK_ID,
      caption: '抱歉，这次小猫图生成失败了：当前图像生成模型通道不可用。',
      authoritativeCaption: true,
      candidates: [],
    });
  });

  it('extracts final Gateway assistant MEDIA replies from a correlated completion run', () => {
    const evidence = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        runId: `image_generate:${TASK_ID}:ok`,
        sessionKey: SESSION_KEY,
        state: 'final',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: '生成好了 🐶\n\nMEDIA:/tmp/generated-puppy.png',
          }],
        },
      },
    });

    expect(evidence).toMatchObject({
      taskId: TASK_ID,
      caption: '生成好了 🐶',
      authoritativeCaption: true,
      candidates: [{ key: '/tmp/generated-puppy.png' }],
    });
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        runId: `image_generate:${TASK_ID}:ok`,
        sessionKey: SESSION_KEY,
        state: 'final',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: '  橘子来了~MEDIA:/tmp/generated-orange.png',
          }],
        },
      },
    })).toMatchObject({
      caption: '  橘子来了~',
      candidates: [{ key: '/tmp/generated-orange.png' }],
    });
  });

  it('rejects failed runtime deliveries and text-only assistant deltas', () => {
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'tool.completed',
      runId: `image_generate:${TASK_ID}:error`,
      sessionKey: `image_generate:${TASK_ID}`,
      toolCallId: 'message-tool',
      name: 'message',
      isError: true,
      result: {
        details: {
          status: 'error',
          deliveryStatus: 'not-sent',
          sourceReplySink: 'internal-ui',
          sourceReply: { text: 'Not delivered.', mediaUrls: ['/tmp/not-delivered.png'] },
        },
      },
    })).toBeNull();
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: `image_generate:${TASK_ID}:error`,
      sessionKey: SESSION_KEY,
      text: 'Partial untrusted completion text',
    })).toBeNull();
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'tool.completed',
      runId: `image_generate:${TASK_ID}:error`,
      sessionKey: `image_generate:${TASK_ID}`,
      toolCallId: 'message-tool',
      name: 'message',
      result: {
        details: {
          status: 'ok',
          deliveryStatus: 'timeout',
          sourceReplySink: 'internal-ui',
          sourceReply: { mediaUrls: ['/tmp/timed-out.png'] },
        },
      },
    })).toBeNull();
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: `image_generate:${TASK_ID}`,
        state: 'final',
        runId: `image_generate:${TASK_ID}:error`,
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: {
            status: 'rejected',
            deliveryStatus: 'sent',
            sourceReplySink: 'internal-ui',
            sourceReply: { mediaUrls: ['/tmp/rejected.png'] },
          },
        },
      },
    })).toBeNull();
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: `image_generate:${TASK_ID}`,
        state: 'final',
        runId: `image_generate:${TASK_ID}:error`,
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: {
            status: 'error',
            mediaUrls: ['/tmp/unconfirmed-error.png'],
          },
        },
      },
    })).toBeNull();
  });

  it('extracts historical ACP image-generation media from assistant MEDIA text', () => {
    const evidence = extractImageGenerationCompletionFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      historical: true,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'replayed-image-result',
          content: {
            type: 'text',
            text: '图片生成完成！这是为你创建的蓝天白云风景图。\n\nMEDIA:/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      sessionKey: SESSION_KEY,
      source: 'acp-session-update',
      historical: true,
      caption: 'Generated image is ready.',
    });
    expect(evidence?.candidates).toEqual([
      {
        key: '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
        filePath: '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('extracts historical transcript image completions after an image_generate start', () => {
    const supplement = extractImageGenerationTranscriptSupplement([
      {
        role: 'toolresult',
        toolCallId: 'tool-image',
        toolName: 'image_generate',
        content: [{
          type: 'text',
          text: `Background task started for image generation (${TASK_ID}).`,
        }],
        details: { taskId: TASK_ID },
      },
      {
        role: 'assistant',
        id: 'assistant-image-ready',
        content: [{
          type: 'text',
          text: '图片生成完成！\n\nMEDIA:/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
        }],
      },
    ], SESSION_KEY);

    expect(supplement.starts).toEqual([{
      sessionKey: SESSION_KEY,
      taskId: TASK_ID,
      toolCallId: 'tool-image',
      evidenceId: `start:${SESSION_KEY}:tool-image:${TASK_ID}`,
    }]);
    expect(supplement.completions).toHaveLength(1);
    expect(supplement.completions[0]).toMatchObject({
      sessionKey: SESSION_KEY,
      source: 'transcript-history',
      historical: true,
      caption: '图片生成完成！',
    });
    expect(supplement.completions[0]?.candidates).toEqual([
      {
        key: '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
        filePath: '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('extracts text-only internal-UI failures from transcript fallback after an image_generate start', () => {
    const supplement = extractImageGenerationTranscriptSupplement([
      {
        role: 'toolresult',
        toolCallId: 'tool-image',
        toolName: 'image_generate',
        content: `Background task started for image generation (${TASK_ID}).`,
        details: { taskId: TASK_ID },
      },
      {
        role: 'toolresult',
        id: 'message-delivery-failure',
        toolCallId: 'message-tool',
        toolName: 'message',
        content: 'Sent visible reply to the current source conversation via internal-ui.',
        details: {
          status: 'ok',
          deliveryStatus: 'sent',
          sourceReplySink: 'internal-ui',
          sourceReply: {
            text: 'Image generation failed because the provider returned no images.',
          },
        },
      },
    ], SESSION_KEY);

    expect(supplement.completions).toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        toolCallId: 'tool-image',
        caption: 'Image generation failed because the provider returned no images.',
        candidates: [],
      }),
    ]);
  });

  it('does not associate transcript MEDIA evidence across user-turn boundaries', () => {
    const supplement = extractImageGenerationTranscriptSupplement([
      {
        role: 'toolresult',
        toolCallId: 'tool-image',
        toolName: 'image_generate',
        content: `Background task started for image generation (${TASK_ID}).`,
        details: { taskId: TASK_ID },
      },
      { role: 'user', content: 'A different request' },
      {
        role: 'assistant',
        id: 'unrelated-media',
        content: 'MEDIA:/tmp/unrelated.png',
      },
    ], SESSION_KEY);

    expect(supplement.starts).toHaveLength(1);
    expect(supplement.completions).toEqual([]);
  });

  it('keeps internal image-completion triggers in the originating transcript turn', () => {
    const failure = extractImageGenerationTranscriptSupplement([
      { role: 'user', content: '生成一张小猫图' },
      {
        role: 'toolresult',
        toolCallId: 'tool-image',
        toolName: 'image_generate',
        content: `Background task started for image generation (${TASK_ID}).`,
        details: { taskId: TASK_ID },
      },
      {
        role: 'user',
        content: `[Inter-session message] sourceSession=image_generate:${TASK_ID} sourceChannel=webchat sourceTool=image_generate isUser=false\n[Internal task completion event]\nstatus: failed`,
      },
      {
        role: 'assistant',
        id: 'kitten-failure',
        content: '抱歉，这次小猫图生成失败了：当前图像生成模型通道不可用。',
      },
    ], SESSION_KEY);
    const success = extractImageGenerationTranscriptSupplement([
      { role: 'user', content: '生成一张小狗图' },
      {
        role: 'toolresult',
        toolCallId: 'tool-image',
        toolName: 'image_generate',
        content: `Background task started for image generation (${TASK_ID}).`,
        details: { taskId: TASK_ID },
      },
      {
        role: 'user',
        content: `[Inter-session message] sourceSession=image_generate:${TASK_ID} sourceChannel=webchat sourceTool=image_generate isUser=false\n[Internal task completion event]\nstatus: completed successfully`,
      },
      {
        role: 'assistant',
        id: 'puppy-success',
        content: '生成好了 🐶\n\nMEDIA:/tmp/generated-puppy.png',
      },
    ], SESSION_KEY);

    expect(failure.completions).toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        caption: '抱歉，这次小猫图生成失败了：当前图像生成模型通道不可用。',
        candidates: [],
      }),
    ]);
    expect(success.completions).toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        caption: '生成好了 🐶',
        candidates: [expect.objectContaining({ key: '/tmp/generated-puppy.png' })],
      }),
    ]);
  });

  it('does not extract transcript assistant MEDIA text without a prior image_generate start', () => {
    const supplement = extractImageGenerationTranscriptSupplement([
      {
        role: 'assistant',
        id: 'assistant-image-ready',
        content: [{
          type: 'text',
          text: 'MEDIA:/Users/me/.openclaw/media/tool-image-generation/not-authorized.png',
        }],
      },
    ], SESSION_KEY);

    expect(supplement).toEqual({ starts: [], completions: [] });
  });

  it('does not extract spaced historical ACP MEDIA text markers', () => {
    expect(extractImageGenerationCompletionFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      historical: true,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'spaced-media-marker',
          content: {
            type: 'text',
            text: '图片生成完成！\n\nMEDIA: /Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png',
          },
        },
      },
    })).toBeNull();
  });

  it('rejects arbitrary assistant MEDIA text without structured media fields', () => {
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'MEDIA:/tmp/not-trusted.png' }],
        },
      },
    })).toBeNull();
  });

  it('rejects untrusted Gateway structured media fields', () => {
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'read',
          details: { mediaUrl: '/tmp/not-image-generation.png' },
        },
      },
    })).toBeNull();

    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        message: {
          role: 'assistant',
          mediaUrls: ['/tmp/not-structured-delivery.png'],
        },
      },
    })).toBeNull();

    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        message: {
          role: 'assistant',
          _attachedFiles: [],
          mediaUrls: ['/tmp/not-trusted.png'],
        },
      },
    })).toBeNull();

    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      sessionKey: SESSION_KEY,
      runId: 'run-1',
      mediaUrls: ['/tmp/not-gateway-chat-message.png'],
    })).toBeNull();
  });

  it('rejects non-image media candidates', () => {
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-report.pdf'],
    })).toBeNull();
  });

  it('builds source-agnostic evidence keys from image candidate sets', () => {
    const gatewayEvidence = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        state: 'final',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/generated-clouds.webp', '/tmp/generated-sunset.webp'] },
        },
      },
    });
    const runtimeEvidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-sunset.webp', '/tmp/generated-clouds.webp'],
    });
    const otherRuntimeEvidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-clouds.webp'],
    });

    expect(gatewayEvidence).not.toBeNull();
    expect(runtimeEvidence).not.toBeNull();
    expect(otherRuntimeEvidence).not.toBeNull();
    expect(gatewayEvidence?.evidenceId).not.toBe(runtimeEvidence?.evidenceId);
    expect(imageGenerationEvidenceKey(gatewayEvidence!)).toBe(imageGenerationEvidenceKey(runtimeEvidence!));
    expect(imageGenerationEvidenceKey(runtimeEvidence!)).toBe(
      'agent:main:main:image-generation:["/tmp/generated-clouds.webp","/tmp/generated-sunset.webp"]',
    );
    expect(imageGenerationEvidenceKey(runtimeEvidence!)).not.toBe(imageGenerationEvidenceKey(otherRuntimeEvidence!));

    const collisionEvidenceA = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mimeType: 'image/png',
      mediaUrls: ['a|b', 'c'],
    });
    const collisionEvidenceB = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mimeType: 'image/png',
      mediaUrls: ['a', 'b|c'],
    });

    expect(collisionEvidenceA).not.toBeNull();
    expect(collisionEvidenceB).not.toBeNull();
    expect(imageGenerationEvidenceKey(collisionEvidenceA!)).not.toBe(imageGenerationEvidenceKey(collisionEvidenceB!));

    const gatewayFailure = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: `image_generate:${TASK_ID}`,
        state: 'final',
        runId: `image_generate:${TASK_ID}:error`,
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: {
            status: 'ok',
            deliveryStatus: 'sent',
            sourceReplySink: 'internal-ui',
            sourceReply: { text: 'Image generation failed.' },
          },
        },
      },
    });
    const runtimeFailure = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'tool.completed',
      runId: `image_generate:${TASK_ID}:error`,
      sessionKey: `image_generate:${TASK_ID}`,
      toolCallId: 'message-tool',
      name: 'message',
      result: {
        details: {
          status: 'ok',
          deliveryStatus: 'sent',
          sourceReplySink: 'internal-ui',
          sourceReply: { text: 'Image generation failed.' },
        },
      },
    });

    expect(gatewayFailure).not.toBeNull();
    expect(runtimeFailure).not.toBeNull();
    expect(imageGenerationEvidenceKey(gatewayFailure!)).toBe(imageGenerationEvidenceKey(runtimeFailure!));
  });
});
