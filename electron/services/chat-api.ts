import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import { isRecord } from './payload-utils';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
]);

type ChatSendWithMediaPayload = {
  sessionKey?: unknown;
  message?: unknown;
  deliver?: unknown;
  idempotencyKey?: unknown;
  media?: unknown;
};

type MediaPayload = {
  filePath?: unknown;
  mimeType?: unknown;
  fileName?: unknown;
};

function normalizeMedia(media: unknown): Array<{ filePath: string; mimeType: string; fileName: string }> {
  if (!Array.isArray(media)) return [];
  return media.flatMap((entry): Array<{ filePath: string; mimeType: string; fileName: string }> => {
    if (!isRecord(entry)) return [];
    const item = entry as MediaPayload;
    if (typeof item.filePath !== 'string' || !item.filePath) return [];
    return [{
      filePath: item.filePath,
      mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'application/octet-stream',
      fileName: typeof item.fileName === 'string' && item.fileName ? item.fileName : item.filePath.split(/[\\/]/).pop() || 'file',
    }];
  });
}

export function createChatApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['chat'] {
  return {
    sendWithMedia: async (payload) => {
      const body = isRecord(payload) ? payload as ChatSendWithMediaPayload : {};
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
      if (!sessionKey || !idempotencyKey) {
        return { success: false, error: 'Invalid chat send payload' };
      }

      try {
        let message = typeof body.message === 'string' ? body.message : '';
        const imageAttachments: Array<Record<string, unknown>> = [];
        const fileReferences: string[] = [];
        const media = normalizeMedia(body.media);

        if (media.length > 0) {
          const fsP = await import('node:fs/promises');
          for (const item of media) {
            const exists = await fsP.access(item.filePath).then(() => true, () => false);
            logger.info(
              `[chat:sendWithMedia] Processing file: ${item.fileName} (${item.mimeType}), path: ${item.filePath}, exists: ${exists}, isVision: ${VISION_MIME_TYPES.has(item.mimeType)}`,
            );

            fileReferences.push(
              `[media attached: ${item.filePath} (${item.mimeType}) | ${item.filePath}]`,
            );

            if (VISION_MIME_TYPES.has(item.mimeType)) {
              const fileBuffer = await fsP.readFile(item.filePath);
              const base64Data = fileBuffer.toString('base64');
              logger.info(`[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`);
              imageAttachments.push({
                content: base64Data,
                mimeType: item.mimeType,
                fileName: item.fileName,
              });
            }
          }
        }

        if (fileReferences.length > 0) {
          const refs = fileReferences.join('\n');
          message = message ? `${message}\n\n${refs}` : refs;
        }

        const rpcParams: Record<string, unknown> = {
          sessionKey,
          message,
          deliver: body.deliver ?? false,
          idempotencyKey,
        };
        if (imageAttachments.length > 0) {
          rpcParams.attachments = imageAttachments;
        }

        logger.info(
          `[chat:sendWithMedia] Sending: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`,
        );
        const result = await gatewayManager.rpc('chat.send', rpcParams, 120000);
        logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
        const response = isRecord(result) && typeof result.runId === 'string'
          ? { runId: result.runId }
          : undefined;
        return { success: true, ...(response ? { result: response } : {}) };
      } catch (error) {
        logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
        return { success: false, error: String(error) };
      }
    },
  };
}
