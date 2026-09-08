import { EventEmitter } from 'events';
import { shell } from 'electron';
import { logger } from './logger';
import { loginOpenAICodexOAuth, type OpenAICodexOAuthCredentials } from './openai-codex-oauth';
import {
  loginTokenDanceOAuth,
  TOKENDANCE_APP_HEADER,
  TOKENDANCE_DEFAULT_MODEL,
  TOKENDANCE_GATEWAY_BASE_URL,
  type TokenDanceOAuthResult,
} from './tokendance-oauth';
import { getProviderService } from '../services/providers/provider-service';
import { getSecretStore } from '../services/secrets/secret-store';
import {
  ensureOpenClawProviderAgentRuntimePins,
  OPENAI_CODEX_OAUTH_PROVIDER_CONFIG,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModelWithOverride,
} from './openclaw-auth';

// Google was removed: OpenClaw's `google-gemini-cli` OAuth integration is an
// unofficial third-party flow that requires the `gemini` CLI binary to be on
// PATH and ships with explicit "use at your own risk" warnings about Google
// account suspensions. ClawX does not bundle that binary.
export type BrowserOAuthProviderType = 'openai' | 'tokendance';

const OPENAI_RUNTIME_PROVIDER_ID = 'openai';
const OPENAI_OAUTH_DEFAULT_MODEL = 'gpt-5.6-sol';

export class BrowserOAuthManager extends EventEmitter {
  private activeAccountId: string | null = null;
  private activeLabel: string | null = null;
  private active = false;
  private activeFlowId: number | null = null;
  private nextFlowId = 0;
  private pendingManualCodeResolve: ((value: string) => void) | null = null;
  private pendingManualCodeReject: ((reason?: unknown) => void) | null = null;
  private flowAbortController: AbortController | null = null;

  async startFlow(
    provider: BrowserOAuthProviderType,
    options?: { accountId?: string; label?: string },
  ): Promise<boolean> {
    // A double click or a reopened dialog can dispatch the same request twice.
    // Reuse the active flow instead of opening parallel callback servers and
    // repeating the expensive OpenClaw configuration synchronization.
    if (this.active) {
      logger.info(`[BrowserOAuth] Ignoring duplicate start for ${provider}; a browser flow is already active`);
      return true;
    }

    const flowId = ++this.nextFlowId;
    const controller = new AbortController();
    this.active = true;
    this.activeFlowId = flowId;
    this.activeAccountId = options?.accountId || provider;
    this.activeLabel = options?.label || null;
    this.flowAbortController = controller;
    this.emit('oauth:start', { provider, accountId: this.activeAccountId });

    // OpenAI flow may switch to manual callback mode; keep start API non-blocking.
    void this.executeFlow(provider, flowId, controller.signal);
    return true;
  }

  private isCurrentFlow(flowId: number): boolean {
    return this.active && this.activeFlowId === flowId;
  }

  private clearFlow(flowId: number): boolean {
    if (!this.isCurrentFlow(flowId)) {
      return false;
    }
    this.active = false;
    this.activeFlowId = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    this.flowAbortController = null;
    return true;
  }

  private async executeFlow(
    provider: BrowserOAuthProviderType,
    flowId: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      if (provider === 'tokendance') {
        const token = await loginTokenDanceOAuth({
          openUrl: async (url) => {
            await shell.openExternal(url);
          },
          signal,
          onProgress: (message) => logger.info(`[BrowserOAuth] ${message}`),
        });
        if (this.isCurrentFlow(flowId)) {
          await this.onTokenDanceSuccess(token, flowId);
        }
        return;
      }

      const token = await loginOpenAICodexOAuth({
        openUrl: async (url) => {
          await shell.openExternal(url);
        },
        onProgress: (message) => logger.info(`[BrowserOAuth] ${message}`),
        onManualCodeRequired: ({ authorizationUrl, reason }) => {
          const message = reason === 'port_in_use'
            ? 'OpenAI OAuth callback port 1455 is in use. Complete sign-in, then paste the final callback URL or code.'
            : 'OpenAI OAuth callback timed out. Paste the final callback URL or code to continue.';
          const payload = {
            provider,
            mode: 'manual' as const,
            authorizationUrl,
            message,
          };
          if (this.isCurrentFlow(flowId)) {
            this.emit('oauth:code', payload);
          }
        },
        onManualCodeInput: async () => {
          if (!this.isCurrentFlow(flowId)) {
            throw new Error('OAuth flow cancelled');
          }
          return await new Promise<string>((resolve, reject) => {
            this.pendingManualCodeResolve = resolve;
            this.pendingManualCodeReject = reject;
          });
        },
      });

      if (this.isCurrentFlow(flowId)) {
        await this.onSuccess(provider, token, flowId);
      }
    } catch (error) {
      if (!this.isCurrentFlow(flowId)) {
        return;
      }
      logger.error(`[BrowserOAuth] Flow error for ${provider}:`, error);
      this.emitError(error instanceof Error ? error.message : String(error));
      this.clearFlow(flowId);
    }
  }

  async stopFlow(): Promise<void> {
    this.active = false;
    this.activeFlowId = null;
    this.flowAbortController?.abort();
    this.flowAbortController = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    if (this.pendingManualCodeReject) {
      this.pendingManualCodeReject(new Error('OAuth flow cancelled'));
    }
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    logger.info('[BrowserOAuth] Flow explicitly stopped');
  }

  submitManualCode(code: string): boolean {
    const value = code.trim();
    if (!value || !this.pendingManualCodeResolve) {
      return false;
    }
    this.pendingManualCodeResolve(value);
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    return true;
  }

  private async onSuccess(
    providerType: 'openai',
    token: OpenAICodexOAuthCredentials,
    flowId: number,
  ) {
    const accountId = this.activeAccountId || providerType;
    const accountLabel = this.activeLabel;

    const providerService = getProviderService();
    const existing = await providerService.getAccount(accountId);
    const runtimeProviderId = OPENAI_RUNTIME_PROVIDER_ID;
    const defaultModel = OPENAI_OAUTH_DEFAULT_MODEL;
    const accountLabelDefault = 'OpenAI Codex';
    const oauthTokenEmail = typeof token.email === 'string' ? token.email : undefined;
    const oauthTokenSubject = typeof token.accountId === 'string' ? token.accountId : undefined;

    const normalizedExistingModel = (() => {
      const value = existing?.model?.trim();
      if (!value) return undefined;
      if (value.startsWith('openai/') || value.startsWith('openai-codex/')) {
        return value.split('/').pop();
      }
      return value.includes('/') ? value.split('/').pop() : value;
    })();

    const nextAccount = await providerService.createAccount({
      id: accountId,
      vendorId: providerType,
      label: accountLabel || existing?.label || accountLabelDefault,
      authMode: 'oauth_browser',
      baseUrl: existing?.baseUrl,
      apiProtocol: existing?.apiProtocol,
      model: normalizedExistingModel || defaultModel,
      fallbackModels: existing?.fallbackModels,
      fallbackAccountIds: existing?.fallbackAccountIds,
      enabled: existing?.enabled ?? true,
      isDefault: existing?.isDefault ?? false,
      metadata: {
        ...existing?.metadata,
        email: oauthTokenEmail,
        resourceUrl: runtimeProviderId,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await getSecretStore().set({
      type: 'oauth',
      accountId,
      accessToken: token.access,
      refreshToken: token.refresh,
      expiresAt: token.expires,
      email: oauthTokenEmail,
      subject: oauthTokenSubject,
    });

    await saveOAuthTokenToOpenClaw(runtimeProviderId, {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      email: oauthTokenEmail,
      projectId: oauthTokenSubject,
      accountId: oauthTokenSubject,
    });

    const modelId = normalizedExistingModel || defaultModel;
    const modelRef = `${runtimeProviderId}/${modelId}`;
    const fallbackModelRefs = (nextAccount.fallbackModels ?? [])
      .map((fallback) => fallback.trim())
      .filter(Boolean)
      .map((fallback) => (
        fallback.replace(/^openai-codex\//, `${runtimeProviderId}/`).startsWith(`${runtimeProviderId}/`)
          ? fallback.replace(/^openai-codex\//, `${runtimeProviderId}/`)
          : `${runtimeProviderId}/${fallback}`
      ));

    try {
      await setOpenClawDefaultModelWithOverride(
        runtimeProviderId,
        modelRef,
        {
          baseUrl: OPENAI_CODEX_OAUTH_PROVIDER_CONFIG.baseUrl,
          api: OPENAI_CODEX_OAUTH_PROVIDER_CONFIG.api,
        },
        fallbackModelRefs,
      );
      await ensureOpenClawProviderAgentRuntimePins();
      logger.info(`[BrowserOAuth] Registered ${runtimeProviderId} in openclaw.json (default model: ${modelRef})`);
    } catch (err) {
      logger.warn('[BrowserOAuth] Failed to register OpenAI OAuth provider in openclaw.json:', err);
      throw err;
    }

    if (!this.clearFlow(flowId)) return;
    logger.info(`[BrowserOAuth] Successfully completed OAuth for ${providerType}`);
    this.emitSuccess(providerType, nextAccount.id);
  }

  private async onTokenDanceSuccess(token: TokenDanceOAuthResult, flowId: number): Promise<void> {
    const persistenceStartedAt = Date.now();
    const providerType = 'tokendance' as const;
    const accountId = this.activeAccountId || providerType;
    const accountLabel = this.activeLabel;

    const providerService = getProviderService();
    const existing = await providerService.getAccount(accountId);
    const model = existing?.model?.trim().replace(/^tokendance\//, '') || TOKENDANCE_DEFAULT_MODEL;
    const headers = Object.fromEntries(
      Object.entries(existing?.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'x-app-url'),
    );
    Object.assign(headers, TOKENDANCE_APP_HEADER);

    const nextAccount = await providerService.createAccount({
      id: accountId,
      vendorId: providerType,
      label: accountLabel || existing?.label || 'TokenDance',
      authMode: 'oauth_browser',
      baseUrl: TOKENDANCE_GATEWAY_BASE_URL,
      apiProtocol: 'openai-completions',
      headers,
      model,
      fallbackModels: existing?.fallbackModels,
      fallbackAccountIds: existing?.fallbackAccountIds,
      enabled: existing?.enabled ?? true,
      isDefault: existing?.isDefault ?? false,
      metadata: existing?.metadata,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, token.apiKey);

    await saveProviderKeyToOpenClaw(providerType, token.apiKey);
    await setOpenClawDefaultModelWithOverride(
      providerType,
      `${providerType}/${model}`,
      {
        baseUrl: TOKENDANCE_GATEWAY_BASE_URL,
        api: 'openai-completions',
        apiKeyEnv: 'TOKENDANCE_API_KEY',
        headers: TOKENDANCE_APP_HEADER,
      },
      (nextAccount.fallbackModels ?? []).map((fallback) => (
        fallback.startsWith(`${providerType}/`) ? fallback : `${providerType}/${fallback}`
      )),
    );

    // OAuth already made this model the OpenClaw default. Persist the matching
    // account default before notifying Renderer so its follow-up selection is
    // a cheap no-op instead of another full runtime synchronization.
    await providerService.setDefaultAccount(nextAccount.id);
    logger.info(
      `[BrowserOAuth] TokenDance credentials and runtime configuration persisted in ${Date.now() - persistenceStartedAt}ms`,
    );

    if (!this.clearFlow(flowId)) return;
    logger.info(`[BrowserOAuth] Successfully completed OAuth for ${providerType}`);
    this.emitSuccess(providerType, nextAccount.id);
  }

  private emitSuccess(provider: BrowserOAuthProviderType, accountId: string): void {
    this.emit('oauth:success', { provider, accountId });
  }

  private emitError(message: string) {
    this.emit('oauth:error', { message });
  }
}

export const browserOAuthManager = new BrowserOAuthManager();
