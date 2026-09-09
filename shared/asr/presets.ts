import type { AsrPreset, AsrProtocol } from '../host-api/contract';

export type { AsrProtocol };

export const ASR_PROTOCOLS: readonly AsrProtocol[] = ['transcriptions', 'chat'] as const;

export const ASR_PRESETS_BY_PROTOCOL: Record<AsrProtocol, readonly AsrPreset[]> = {
  transcriptions: ['openai', 'groq', 'siliconflow', 'custom'],
  chat: ['bailian', 'custom'],
};

export const ASR_PRESET_DEFAULTS: Record<AsrPreset, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B' },
  bailian: {
    baseUrl: 'https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-asr-flash',
  },
  custom: { baseUrl: '', model: '' },
};

export function normalizeAsrProtocol(protocol: unknown): AsrProtocol {
  return protocol === 'chat' ? 'chat' : 'transcriptions';
}
