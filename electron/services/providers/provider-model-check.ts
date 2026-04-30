import type { ProviderProtocol, ProviderType } from '../../shared/providers/types';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getApiKey } from '../../utils/secure-storage';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getProviderService } from './provider-service';

export type ModelCheckStatus = 'operational' | 'degraded' | 'failed';
export type ModelCheckErrorCategory = 'modelNotFound' | 'auth' | 'timeout' | 'connection' | 'unsupported';

export interface ModelCheckInput {
  accountId?: string;
  vendorId: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  model?: string;
  timeoutMs?: number;
  degradedThresholdMs?: number;
  testPrompt?: string;
}

export interface ModelCheckResult {
  success: boolean;
  status: ModelCheckStatus;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  modelUsed: string;
  errorCategory?: ModelCheckErrorCategory;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_DEGRADED_THRESHOLD_MS = 6_000;
const DEFAULT_TEST_PROMPT = 'Hi';

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key, value]) => key && typeof value === 'string' && value.trim()),
  );
}

function buildResult(
  success: boolean,
  responseTimeMs: number,
  degradedThresholdMs: number,
  modelUsed: string,
  message: string,
  httpStatus?: number,
  errorCategory?: ModelCheckErrorCategory,
): ModelCheckResult {
  if (!success) {
    return {
      success: false,
      status: 'failed',
      message,
      responseTimeMs,
      httpStatus,
      modelUsed,
      errorCategory,
    };
  }

  return {
    success: true,
    status: responseTimeMs > degradedThresholdMs ? 'degraded' : 'operational',
    message: responseTimeMs > degradedThresholdMs ? 'Model is available, but response is slow' : 'Model is available',
    responseTimeMs,
    httpStatus,
    modelUsed,
  };
}

function detectModelNotFound(body: string): boolean {
  const text = body.toLowerCase();
  if (!text.includes('model')) return false;
  return [
    'model_not_found',
    'model not found',
    'does not exist',
    'invalid_model',
    'invalid model',
    'unknown_model',
    'unknown model',
    'is not a valid model',
    'not_found_error',
  ].some((token) => text.includes(token));
}

function detectAuthFailure(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  const text = body.toLowerCase();
  return text.includes('invalid api key') || text.includes('unauthorized') || text.includes('authentication');
}

async function ensureReadableStream(response: Response): Promise<void> {
  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  try {
    const firstChunk = await reader.read();
    if (!firstChunk || firstChunk.done) {
      throw new Error('No response data received');
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    try {
      await response.body.cancel();
    } catch {
      // ignore
    }
  }
}

function mergeHeaders(base: Record<string, string>, extra?: Record<string, string>): Record<string, string> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    merged[key] = value;
  }
  return merged;
}

function buildOpenAICompletionRequestBody(model: string, prompt: string, vendorId: ProviderType): Record<string, unknown> {
  if (vendorId === 'deepseek') {
    return {
      model,
      stream: true,
      max_tokens: 16,
      reasoning_effort: 'high',
      extra_body: { thinking: { type: 'enabled' } },
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: prompt },
      ],
    };
  }

  return {
    model,
    stream: true,
    max_tokens: 16,
    messages: [{ role: 'user', content: prompt }],
  };
}

async function checkOpenAICompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  headers: Record<string, string>,
  prompt: string,
  signal: AbortSignal,
  vendorId: ProviderType,
): Promise<Response> {
  return proxyAwareFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: mergeHeaders({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Encoding': 'identity',
    }, headers),
    body: JSON.stringify(buildOpenAICompletionRequestBody(model, prompt, vendorId)),
  });
}

async function checkOpenAIResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  headers: Record<string, string>,
  prompt: string,
  signal: AbortSignal,
): Promise<Response> {
  return proxyAwareFetch(`${baseUrl}/responses`, {
    method: 'POST',
    signal,
    headers: mergeHeaders({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Encoding': 'identity',
    }, headers),
    body: JSON.stringify({
      model,
      stream: true,
      max_output_tokens: 16,
      input: prompt,
    }),
  });
}

async function checkAnthropicMessages(
  baseUrl: string,
  apiKey: string,
  model: string,
  headers: Record<string, string>,
  prompt: string,
  signal: AbortSignal,
): Promise<Response> {
  return proxyAwareFetch(`${baseUrl}/messages`, {
    method: 'POST',
    signal,
    headers: mergeHeaders({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Encoding': 'identity',
      'anthropic-version': '2023-06-01',
    }, headers),
    body: JSON.stringify({
      model,
      max_tokens: 16,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
}

export async function checkProviderModel(input: ModelCheckInput): Promise<ModelCheckResult> {
  const providerService = getProviderService();
  const account = input.accountId ? await providerService.getAccount(input.accountId) : null;
  const definition = getProviderDefinition(input.vendorId);
  const model = (input.model || account?.model || definition?.defaultModelId || '').trim();
  if (!model) {
    return {
      success: false,
      status: 'failed',
      message: 'Model is required',
      modelUsed: '',
    };
  }

  const protocol = input.apiProtocol || account?.apiProtocol || definition?.providerConfig?.api;
  if (!protocol) {
    return {
      success: false,
      status: 'failed',
      message: 'API protocol is required',
      modelUsed: model,
      errorCategory: 'unsupported',
    };
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl || account?.baseUrl || definition?.providerConfig?.baseUrl);
  if (!baseUrl) {
    return {
      success: false,
      status: 'failed',
      message: 'Base URL is required',
      modelUsed: model,
    };
  }

  const resolvedApiKey = (input.apiKey && input.apiKey.trim()) || (input.accountId ? await getApiKey(input.accountId) : '') || '';
  const requiresApiKey = definition?.requiresApiKey ?? input.vendorId !== 'ollama';
  if (requiresApiKey && !resolvedApiKey) {
    return {
      success: false,
      status: 'failed',
      message: 'API key is required for model check',
      modelUsed: model,
      errorCategory: 'auth',
    };
  }

  const mergedHeaders = mergeHeaders(definition?.providerConfig?.headers ?? {}, normalizeHeaders(account?.headers));
  const requestHeaders = mergeHeaders(mergedHeaders, normalizeHeaders(input.headers));
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const degradedThresholdMs = input.degradedThresholdMs ?? DEFAULT_DEGRADED_THRESHOLD_MS;
  const prompt = input.testPrompt?.trim() || DEFAULT_TEST_PROMPT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const startedAt = Date.now();

  try {
    let response: Response;
    switch (protocol) {
      case 'openai-completions':
        response = await checkOpenAICompletions(baseUrl, resolvedApiKey, model, requestHeaders, prompt, controller.signal, input.vendorId);
        break;
      case 'openai-responses':
        response = await checkOpenAIResponses(baseUrl, resolvedApiKey, model, requestHeaders, prompt, controller.signal);
        break;
      case 'anthropic-messages':
        response = await checkAnthropicMessages(baseUrl, resolvedApiKey, model, requestHeaders, prompt, controller.signal);
        break;
      default:
        return {
          success: false,
          status: 'failed',
          message: `Unsupported protocol for model check: ${protocol}`,
          modelUsed: model,
          errorCategory: 'unsupported',
        };
    }

    const responseTimeMs = Date.now() - startedAt;
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const errorCategory = detectModelNotFound(errorText)
        ? 'modelNotFound'
        : detectAuthFailure(response.status, errorText)
          ? 'auth'
          : undefined;
      return buildResult(
        false,
        responseTimeMs,
        degradedThresholdMs,
        model,
        errorText || `HTTP ${response.status}`,
        response.status,
        errorCategory,
      );
    }

    await ensureReadableStream(response);
    return buildResult(true, responseTimeMs, degradedThresholdMs, model, 'Model is available', response.status);
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    const category: ModelCheckErrorCategory = lowered.includes('timeout') || lowered.includes('aborted')
      ? 'timeout'
      : lowered.includes('fetch') || lowered.includes('network') || lowered.includes('connect')
        ? 'connection'
        : 'connection';
    return buildResult(false, responseTimeMs, degradedThresholdMs, model, message, undefined, category);
  } finally {
    clearTimeout(timeout);
  }
}
