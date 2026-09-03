import type { AsrConfig } from '@shared/host-api/contract';
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

export async function transcribeWav(input: {
  wav: Uint8Array;
  config: AsrConfig;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { wav, config, apiKey, fetchImpl } = input;
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'recording.wav');
  form.append('model', config.model);
  const language = config.language?.trim();
  if (language) {
    form.append('language', language);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASR_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    throw new AsrClientError(
      'NETWORK',
      `ASR request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
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
