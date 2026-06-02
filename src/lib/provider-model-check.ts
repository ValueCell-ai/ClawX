export type ProviderModelCheckStatus = 'operational' | 'degraded' | 'failed';
export type ProviderModelCheckErrorCategory = 'modelNotFound' | 'auth' | 'timeout' | 'connection' | 'unsupported';

export interface ProviderModelCheckPayload {
  accountId?: string;
  vendorId: string;
  apiKey?: string;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  timeoutMs?: number;
  degradedThresholdMs?: number;
  testPrompt?: string;
}

export interface ProviderModelCheckResult {
  success: boolean;
  status: ProviderModelCheckStatus;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  modelUsed: string;
  errorCategory?: ProviderModelCheckErrorCategory;
}

import { hostApiFetch } from '@/lib/host-api';

export async function runProviderModelCheck(
  payload: ProviderModelCheckPayload,
): Promise<ProviderModelCheckResult> {
  return hostApiFetch<ProviderModelCheckResult>('/api/provider-model-check', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
