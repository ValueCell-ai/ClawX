import type { AsrConfig, AsrTranscribePayload } from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { serializeAsrError } from '@shared/asr/errors';
import { AsrClientError, transcribeWav, validateAsrConfig } from './asr/asr-client';
import { getAsrApiKey, resolveAsrReadiness, setAsrApiKey, setAsrConfig } from './asr/config-store';
import { isRecord } from './payload-utils';

const MIN_WAV_BYTES = 44;

function toSerializedAsrError(error: unknown): unknown {
  return error instanceof AsrClientError ? serializeAsrError(error) : error;
}

export function createAsrApi(): CompleteHostServiceRegistry['asr'] {
  return {
    getConfig: async () => resolveAsrReadiness(),
    saveConfig: async (payload) => {
      if (!isRecord(payload) || !isRecord(payload.config)) {
        throw serializeAsrError(new AsrClientError('INVALID_INPUT', 'Invalid ASR config payload'));
      }
      const config = payload.config as AsrConfig;
      try {
        validateAsrConfig(config);
      } catch (error) {
        throw toSerializedAsrError(error);
      }
      await setAsrConfig(config);
      if (typeof payload.apiKey === 'string') {
        await setAsrApiKey(payload.apiKey.trim());
      }
      return resolveAsrReadiness();
    },
    transcribe: async (payload) => {
      const wav = isRecord(payload) ? (payload as AsrTranscribePayload).wav : undefined;
      if (!(wav instanceof Uint8Array) || wav.byteLength < MIN_WAV_BYTES) {
        throw serializeAsrError(new AsrClientError('INVALID_INPUT', 'Invalid ASR WAV payload'));
      }
      const readiness = await resolveAsrReadiness();
      if (!readiness.configured || !readiness.config) {
        throw serializeAsrError(new AsrClientError('NOT_CONFIGURED', 'ASR is not configured'));
      }
      const apiKey = (await getAsrApiKey()) ?? '';
      let text: string;
      try {
        text = await transcribeWav({ wav, config: readiness.config, apiKey });
      } catch (error) {
        throw toSerializedAsrError(error);
      }
      return { text };
    },
  };
}
