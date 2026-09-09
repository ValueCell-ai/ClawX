import type { AsrConfig } from '@shared/host-api/contract';
import { normalizeAsrProtocol } from '@shared/asr/presets';
import { ASR_PRESET_DEFAULTS } from '@shared/asr/presets';
import { AsrClientError } from '@shared/asr/errors';
import { isRecord } from '../payload-utils';

export { AsrClientError, type AsrErrorCode } from '@shared/asr/errors';

export const ASR_REQUEST_TIMEOUT_MS = 30_000;

export function validateAsrConfig(config: AsrConfig): void {
  if (!isRecord(config)) {
    throw new AsrClientError('INVALID_INPUT', 'ASR config must be an object');
  }
  if (typeof config.preset !== 'string' || !(config.preset in ASR_PRESET_DEFAULTS)) {
    throw new AsrClientError('INVALID_INPUT', 'Unknown ASR preset');
  }
  if (
    config.protocol !== undefined &&
    config.protocol !== 'transcriptions' &&
    config.protocol !== 'chat'
  ) {
    throw new AsrClientError('INVALID_INPUT', 'Unknown ASR protocol');
  }
  if (typeof config.baseUrl !== 'string' || !config.baseUrl.trim()) {
    throw new AsrClientError('INVALID_INPUT', 'ASR base URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(config.baseUrl.trim());
  } catch {
    throw new AsrClientError('INVALID_INPUT', 'ASR base URL must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AsrClientError('INVALID_INPUT', 'ASR base URL must use http(s)');
  }
  if (typeof config.model !== 'string' || !config.model.trim()) {
    throw new AsrClientError('INVALID_INPUT', 'ASR model is required');
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASR_REQUEST_TIMEOUT_MS);
  try {
    return await (fetchImpl ?? fetch)(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new AsrClientError(
      'NETWORK',
      `ASR request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function assertResponseOk(response: Response): Promise<void> {
  if (response.ok) return;
  const snippet = (await response.text().catch(() => '')).trim().slice(0, 200);
  throw new AsrClientError(
    response.status === 401 || response.status === 403
      ? 'AUTH'
      : response.status === 429
        ? 'RATE_LIMITED'
        : response.status >= 500
          ? 'SERVER'
          : 'REQUEST',
    `ASR request failed with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
  );
}

function extractChatContent(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = (choices[0] as { message?: unknown } | null)?.message;
  if (!isRecord(message)) return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
    return text.trim();
  }
  return '';
}

async function transcribeViaChatCompletions(input: {
  wav: Uint8Array;
  config: AsrConfig;
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { wav, config, apiKey, baseUrl, fetchImpl } = input;
  const payload = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: Buffer.from(wav).toString('base64'),
              format: 'wav',
            },
          },
        ],
      },
    ],
  };
  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    fetchImpl,
  );
  if (!response.ok) {
    await assertResponseOk(response);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AsrClientError('EMPTY_RESULT', 'ASR response is not valid JSON');
  }
  const text = extractChatContent(parsed);
  if (!text) {
    throw new AsrClientError('EMPTY_RESULT', 'ASR service returned no text');
  }
  return text;
}

export async function transcribeWav(input: {
  wav: Uint8Array;
  config: AsrConfig;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { wav, config, apiKey, fetchImpl } = input;
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');

  if (normalizeAsrProtocol(config.protocol) === 'chat') {
    return transcribeViaChatCompletions({ wav, config, apiKey, baseUrl, fetchImpl });
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'recording.wav');
  form.append('model', config.model);
  const language = config.language?.trim();
  if (language) {
    form.append('language', language);
  }

  const endpoint = config.preset === 'custom' ? baseUrl : `${baseUrl}/audio/transcriptions`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
    fetchImpl,
  );
  if (!response.ok) {
    await assertResponseOk(response);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AsrClientError('EMPTY_RESULT', 'ASR response is not valid JSON');
  }

  const text = isRecord(payload) && typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    throw new AsrClientError('EMPTY_RESULT', 'ASR service returned no text');
  }
  return text;
}
