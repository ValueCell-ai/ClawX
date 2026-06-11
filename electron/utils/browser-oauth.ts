import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { loginOpenAICodexOAuth, type OpenAICodexOAuthCredentials } from './openai-codex-oauth';
import { getProviderService } from '../services/providers/provider-service';
import { getSecretStore } from '../services/secrets/secret-store';
import {
  ensureOpenClawProviderAgentRuntimePins,
  OPENAI_CODEX_OAUTH_PROVIDER_CONFIG,
  saveOAuthTokenToOpenClaw,
  setOpenClawDefaultModelWithOverride,
} from './openclaw-auth';

// Google was removed: OpenClaw's `google-gemini-cli` OAuth integration is an
// unofficial third-party flow that requires the `gemini` CLI binary to be on
// PATH and ships with explicit "use at your own risk" warnings about Google
// account suspensions. ClawX does not bundle that binary, so the only
// browser-OAuth provider we currently expose end-to-end is OpenAI Codex.
export type BrowserOAuthProviderType = 'openai';

const OPENAI_RUNTIME_PROVIDER_ID = 'openai';
const OPENAI_OAUTH_DEFAULT_MODEL = 'gpt-5.5';

class BrowserOAuthManager extends EventEmitter {
  private activeAccountId: string | null = null;
  private activeLabel: string | null = null;
  private active = false;
  private mainWindow: BrowserWindow | null = null;
  private pendingManualCodeResolve: ((value: string) => void) | null = null;
  private pendingManualCodeReject: ((reason?: unknown) => void) | null = null;

  setWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async startFlow(
    provider: BrowserOAuthProviderType,
    options?: { accountId?: string; label?: string },
  ): Promise<boolean> {
    if (this.active) {
      await this.stopFlow();
    }

    this.active = true;
    this.activeAccountId = options?.accountId || provider;
    this.activeLabel = options?.label || null;
    this.emit('oauth:start', { provider, accountId: this.activeAccountId });

    // OpenAI flow may switch to manual callback mode; keep start API non-blocking.
    void this.executeFlow(provider);
    return true;
  }

  private async executeFlow(provider: BrowserOAuthProviderType): Promise<void> {
    try {
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
          this.emit('oauth:code', payload);
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:code', payload);
          }
        },
        onManualCodeInput: async () => {
          return await new Promise<string>((resolve, reject) => {
            this.pendingManualCodeResolve = resolve;
            this.pendingManualCodeReject = reject;
          });
        },
      });

      await this.onSuccess(provider, token);
    } catch (error) {
      if (!this.active) {
        return;
      }
      logger.error(`[BrowserOAuth] Flow error for ${provider}:`, error);
      this.emitError(error instanceof Error ? error.message : String(error));
      this.active = false;
      this.activeAccountId = null;
      this.activeLabel = null;
      this.pendingManualCodeResolve = null;
      this.pendingManualCodeReject = null;
    }
  }

  async stopFlow(): Promise<void> {
    this.active = false;
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
    providerType: BrowserOAuthProviderType,
    token: OpenAICodexOAuthCredentials,
  ) {
    const accountId = this.activeAccountId || providerType;
    const accountLabel = this.activeLabel;
    this.active = false;
    this.activeAccountId = null;
    this.activeLabel = null;
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    logger.info(`[BrowserOAuth] Successfully completed OAuth for ${providerType}`);

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

    this.emit('oauth:success', { provider: providerType, accountId: nextAccount.id });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:success', {
        provider: providerType,
        accountId: nextAccount.id,
        success: true,
      });
    }
  }

  private emitError(message: string) {
    this.emit('oauth:error', { message });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:error', { message });
    }
  }
}

export const browserOAuthManager = new BrowserOAuthManager();
