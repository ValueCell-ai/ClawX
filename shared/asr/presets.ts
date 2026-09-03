import type { AsrPreset } from '../host-api/contract';

export const ASR_PRESET_DEFAULTS: Record<AsrPreset, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B' },
  custom: { baseUrl: '', model: '' },
};
