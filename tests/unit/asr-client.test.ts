import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASR_REQUEST_TIMEOUT_MS,
  AsrClientError,
  transcribeWav,
  validateAsrConfig,
} from '@electron/services/asr/asr-client';
import type { AsrConfig } from '@shared/host-api/contract';

const openAiConfig: AsrConfig = {
  preset: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'whisper-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, body = 'upstream exploded'): Response {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({ error: body }),
  } as unknown as Response;
}

describe('asr-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the 30s request timeout', () => {
    expect(ASR_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  describe('transcribeWav', () => {
    it('posts the WAV as multipart form data to the transcriptions endpoint and returns trimmed text', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: '  你好世界  ' }));
      const wav = new Uint8Array([1, 2, 3, 4]);

      await expect(transcribeWav({ wav, config: openAiConfig, apiKey: 'sk-test', fetchImpl }))
        .resolves.toBe('你好世界');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');

      const form = init.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe('whisper-1');
      expect(form.has('language')).toBe(false);

      const file = form.get('file') as File;
      expect(file.name).toBe('recording.wav');
      expect(file.type).toBe('audio/wav');
      expect((await file.arrayBuffer()).byteLength).toBe(4);
    });

    it('keeps a trailing-slash base URL on a single endpoint path', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: 'ok' }));
      await transcribeWav({
        wav: new Uint8Array(8),
        config: { ...openAiConfig, baseUrl: 'http://127.0.0.1:8080/v1/' },
        apiKey: 'k',
        fetchImpl,
      });
      expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/audio/transcriptions');
    });

    it('appends language only when it is a non-empty trimmed string', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: 'hi' }));
      await transcribeWav({
        wav: new Uint8Array(8),
        config: { ...openAiConfig, language: ' zh ' },
        apiKey: 'sk-test',
        fetchImpl,
      });
      const form = fetchImpl.mock.calls[0][1].body as FormData;
      expect(form.get('language')).toBe('zh');

      const fetchNoLanguage = vi.fn().mockResolvedValue(jsonResponse({ text: 'hi' }));
      await transcribeWav({
        wav: new Uint8Array(8),
        config: { ...openAiConfig, language: '   ' },
        apiKey: 'sk-test',
        fetchImpl: fetchNoLanguage,
      });
      expect((fetchNoLanguage.mock.calls[0][1].body as FormData).has('language')).toBe(false);
    });

    it('maps 401/403 to AUTH and 429 to RATE_LIMITED', async () => {
      for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMITED']] as const) {
        const fetchImpl = vi.fn().mockResolvedValue(errorResponse(status));
        await expect(transcribeWav({ wav: new Uint8Array(8), config: openAiConfig, apiKey: 'k', fetchImpl }))
          .rejects.toMatchObject({ code });
      }
    });

    it('maps 5xx to SERVER and other statuses to REQUEST with a response snippet', async () => {
      const serverFetch = vi.fn().mockResolvedValue(errorResponse(500));
      await expect(transcribeWav({ wav: new Uint8Array(8), config: openAiConfig, apiKey: 'k', fetchImpl: serverFetch }))
        .rejects.toMatchObject({ code: 'SERVER' });

      const requestFetch = vi.fn().mockResolvedValue(errorResponse(400, '{"error":"bad wav"}'));
      await expect(transcribeWav({ wav: new Uint8Array(8), config: openAiConfig, apiKey: 'k', fetchImpl: requestFetch }))
        .rejects.toSatisfy((error: AsrClientError) => (
          error.code === 'REQUEST' && error.message.includes('bad wav')
        ));
    });

    it('throws EMPTY_RESULT when text is empty or missing', async () => {
      const emptyFetch = vi.fn().mockResolvedValue(jsonResponse({ text: '   ' }));
      await expect(transcribeWav({ wav: new Uint8Array(8), config: openAiConfig, apiKey: 'k', fetchImpl: emptyFetch }))
        .rejects.toMatchObject({ code: 'EMPTY_RESULT' });

      const missingFetch = vi.fn().mockResolvedValue(jsonResponse({ nope: true }));
      await expect(transcribeWav({ wav: new Uint8Array(8), config: openAiConfig, apiKey: 'k', fetchImpl: missingFetch }))
        .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('throws NETWORK when the fetch itself rejects', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      await expect(transcribeWav({ wav: new Uint8Array(8), config: openAiConfig, apiKey: 'k', fetchImpl }))
        .rejects.toMatchObject({ code: 'NETWORK' });
    });
  });

  describe('validateAsrConfig', () => {
    it('accepts a valid config', () => {
      expect(() => validateAsrConfig(openAiConfig)).not.toThrow();
      expect(() => validateAsrConfig({ ...openAiConfig, preset: 'custom', baseUrl: 'http://127.0.0.1:9000' })).not.toThrow();
    });

    it('rejects non-http(s) base URLs', () => {
      expect(() => validateAsrConfig({ ...openAiConfig, baseUrl: 'ftp://example.com/v1' }))
        .toThrow(AsrClientError);
      try {
        validateAsrConfig({ ...openAiConfig, baseUrl: 'ftp://example.com/v1' });
      } catch (error) {
        expect((error as AsrClientError).code).toBe('INVALID_INPUT');
      }
    });

    it('rejects unparseable or empty base URLs', () => {
      expect(() => validateAsrConfig({ ...openAiConfig, baseUrl: 'not a url' })).toThrow(AsrClientError);
      expect(() => validateAsrConfig({ ...openAiConfig, baseUrl: '' })).toThrow(AsrClientError);
    });

    it('rejects empty models', () => {
      expect(() => validateAsrConfig({ ...openAiConfig, model: '   ' })).toThrow(AsrClientError);
    });

    it('rejects unknown presets', () => {
      expect(() => validateAsrConfig({ ...openAiConfig, preset: 'nope' as AsrConfig['preset'] }))
        .toThrow(AsrClientError);
    });
  });
});
