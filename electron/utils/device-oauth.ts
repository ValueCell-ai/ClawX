/**
 * Device OAuth Manager
 *
 * Manages Device Code OAuth flows for MiniMax providers.
 *
 * The OAuth protocol implementations are fully self-contained in:
 *   - ./minimax-oauth.ts  (MiniMax Device Code + PKCE)
 *
 * This approach:
 * - Hardcodes client_id and endpoints (same as openai-codex-oauth.ts)
 * - Implements OAuth flows locally with zero openclaw dependency
 * - Survives openclaw package upgrades without breakage
 * - Works identically on macOS, Windows, and Linux
 *
 * We provide our own callbacks (openUrl/note/progress) that hook into
 * the Electron IPC system to display UI in the ClawX frontend.
 */
import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { saveProvider, getProvider, ProviderConfig } from './secure-storage';
import { getProviderDefaultModel } from './provider-registry';
import { saveOAuthTokenToOpenClaw, setOpenClawDefaultModelWithOverride } from './openclaw-auth';
import { loginMiniMaxPortalOAuth, type MiniMaxOAuthToken, type MiniMaxRegion } from './minimax-oauth';

export type OAuthProviderType = 'minimax-portal' | 'minimax-portal-cn';

// Re-export types for consumers
export type { MiniMaxRegion, MiniMaxOAuthToken };

// ─────────────────────────────────────────────────────────────
// DeviceOAuthManager
// ─────────────────────────────────────────────────────────────

interface DeviceOAuthFlow {
    provider: OAuthProviderType;
    accountId: string;
    label?: string;
    modelId?: string;
    controller: AbortController;
}

class DeviceOAuthManager extends EventEmitter {
    private activeFlow: DeviceOAuthFlow | null = null;
    private persistence: Promise<void> | null = null;
    private mainWindow: BrowserWindow | null = null;

    setWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    async startFlow(
        provider: OAuthProviderType,
        region: MiniMaxRegion = 'global',
        options?: { accountId?: string; label?: string; modelId?: string },
    ): Promise<boolean> {
        if (this.activeFlow) {
            await this.stopFlow();
        }
        const flow: DeviceOAuthFlow = {
            provider,
            accountId: options?.accountId || provider,
            label: options?.label,
            modelId: options?.modelId?.trim().replace(/^minimax-portal(?:-cn)?\//, '') || undefined,
            controller: new AbortController(),
        };
        this.activeFlow = flow;
        this.emit('oauth:start', { provider, accountId: flow.accountId });

        try {
            if (provider !== 'minimax-portal' && provider !== 'minimax-portal-cn') {
                throw new Error(`Unsupported OAuth provider type: ${provider}`);
            }
            await this.runMiniMaxFlow(provider === 'minimax-portal-cn' ? 'cn' : region, flow);
            return !flow.controller.signal.aborted;
        } catch (error) {
            if (flow.controller.signal.aborted) return false;
            logger.error(`[DeviceOAuth] Flow error for ${provider}:`, error);
            this.emitError(error instanceof Error ? error.message : String(error));
            return false;
        } finally {
            if (this.activeFlow === flow) this.activeFlow = null;
        }
    }

    async stopFlow(): Promise<void> {
        if (this.persistence) {
            // Authorization succeeded. Let its configuration writes finish together.
            await this.persistence.catch(() => {});
            return;
        }
        this.activeFlow?.controller.abort();
        this.activeFlow = null;
        logger.info('[DeviceOAuth] Flow explicitly stopped');
    }

    private async runMiniMaxFlow(region: MiniMaxRegion, flow: DeviceOAuthFlow): Promise<void> {
        const { provider, controller: { signal } } = flow;
        const token = await loginMiniMaxPortalOAuth({
            region,
            signal,
            openUrl: async (url: string) => {
                if (signal.aborted) return;
                logger.info('[DeviceOAuth] MiniMax opening browser');
                // Open the authorization URL in the system browser
                shell.openExternal(url).catch((err: unknown) =>
                    logger.warn(`[DeviceOAuth] Failed to open browser:`, err)
                );
            },
            note: async (message: string, _title?: string) => {
                if (signal.aborted) return;
                // The extension calls note() with a message containing
                // the user_code and verification_uri — parse them for the UI
                const { verificationUri, userCode } = this.parseNote(message);
                if (verificationUri && userCode) {
                    this.emitCode({ provider, verificationUri, userCode, expiresIn: 300 });
                } else {
                    logger.info(`[DeviceOAuth] MiniMax note: ${message}`);
                }
            },
            progress: {
                update: (msg: string) => logger.info(`[DeviceOAuth] MiniMax progress: ${msg}`),
                stop: (msg?: string) => logger.info(`[DeviceOAuth] MiniMax progress done: ${msg ?? ''}`),
            },
        });

        if (signal.aborted) return;

        const persistence = this.onSuccess(flow, token);
        this.persistence = persistence;
        try {
            await persistence;
        } finally {
            this.persistence = null;
        }
    }

    private async onSuccess(flow: DeviceOAuthFlow, token: MiniMaxOAuthToken) {
        const { provider: providerType, accountId, label: accountLabel, modelId } = flow;
        logger.info(`[DeviceOAuth] Successfully completed OAuth for ${providerType}`);

        // 1. Write OAuth token to OpenClaw's auth-profiles.json in native OAuth format.
        //    (matches what `openclaw models auth login` → upsertAuthProfile writes).
        //    We save both MiniMax providers to the generic "minimax-portal" profile
        //    so OpenClaw's gateway auto-refresher knows how to find it.
        try {
            const tokenProviderId = providerType.startsWith('minimax-portal') ? 'minimax-portal' : providerType;
            await saveOAuthTokenToOpenClaw(tokenProviderId, {
                access: token.access,
                refresh: token.refresh,
                expires: token.expires,
            });
        } catch (err) {
            logger.warn(`[DeviceOAuth] Failed to save OAuth token to OpenClaw:`, err);
        }

        // 2. Write openclaw.json: set default model + provider config (baseUrl/api/models)
        //    This mirrors what the OpenClaw plugin's configPatch does after CLI login.
        //    The baseUrl comes from token.resourceUrl (per-account URL from the OAuth server)
        //    or falls back to the provider's default public endpoint.
        const defaultBaseUrl = providerType === 'minimax-portal'
            ? 'https://api.minimax.io/anthropic'
            : 'https://api.minimaxi.com/anthropic';

        let baseUrl = token.resourceUrl || defaultBaseUrl;

        // Ensure baseUrl has a protocol prefix
        if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
            baseUrl = 'https://' + baseUrl;
        }

        // Ensure the base URL ends with /anthropic
        if (providerType.startsWith('minimax-portal') && baseUrl) {
            baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
        }

        try {
            const tokenProviderId = providerType.startsWith('minimax-portal') ? 'minimax-portal' : providerType;
            await setOpenClawDefaultModelWithOverride(tokenProviderId, modelId ? `${tokenProviderId}/${modelId}` : undefined, {
                baseUrl,
                api: 'anthropic-messages',
                // Tells OpenClaw's anthropic adapter to use `Authorization: Bearer` instead of `x-api-key`
                authHeader: providerType.startsWith('minimax-portal') ? true : undefined,
                // OAuth placeholder — tells Gateway to resolve credentials
                // from auth-profiles.json (type: 'oauth') instead of a static API key.
                apiKeyEnv: 'minimax-oauth',
            });
        } catch (err) {
            logger.warn(`[DeviceOAuth] Failed to configure openclaw models:`, err);
        }

        // 3. Save provider record in ClawX's own store so UI shows it as configured
        const existing = await getProvider(accountId);
        const nameMap: Record<OAuthProviderType, string> = {
            'minimax-portal': 'MiniMax (Global)',
            'minimax-portal-cn': 'MiniMax (CN)',
        };
        const providerConfig: ProviderConfig = {
            id: accountId,
            name: accountLabel || nameMap[providerType as OAuthProviderType] || providerType,
            type: providerType,
            enabled: existing?.enabled ?? true,
            baseUrl, // Save the dynamically resolved URL (Global vs CN)

            model: modelId || getProviderDefaultModel(providerType) || existing?.model,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await saveProvider(providerConfig);

        // 4. Emit success internally so the main process can restart the Gateway
        this.emit('oauth:success', { provider: providerType, accountId });

        // 5. Emit success to frontend
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:success', { provider: providerType, accountId, success: true });
        }
    }


    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    /**
     * Parse user_code and verification_uri from the note message sent by
     * the OpenClaw extension's loginXxxPortalOAuth function.
     *
     * Note format (minimax-portal-auth/oauth.ts):
     *   "Open https://platform.minimax.io/oauth-authorize?user_code=dyMj_wOhpK&client=... to approve access.\n"
     *   "If prompted, enter the code dyMj_wOhpK.\n"
     *   ...
     *
     * user_code format: mixed-case alphanumeric with underscore, e.g. "dyMj_wOhpK"
     */
    private parseNote(message: string): { verificationUri?: string; userCode?: string } {
        // Primary: extract URL (everything between "Open " and " to")
        const urlMatch = message.match(/Open\s+(https?:\/\/\S+?)\s+to/i);
        const verificationUri = urlMatch?.[1];

        let userCode: string | undefined;

        // Method 1: extract user_code from URL query param (most reliable)
        if (verificationUri) {
            try {
                const parsed = new URL(verificationUri);
                const qp = parsed.searchParams.get('user_code');
                if (qp) userCode = qp;
            } catch {
                // fall through to text-based extraction
            }
        }

        // Method 2: text-based extraction — matches mixed-case alnum + underscore/hyphen codes
        if (!userCode) {
            const codeMatch = message.match(/enter.*?code\s+([A-Za-z0-9][A-Za-z0-9_-]{3,})/i);
            if (codeMatch?.[1]) userCode = codeMatch[1].replace(/\.$/, ''); // strip trailing period
        }

        return { verificationUri, userCode };
    }

    private emitCode(data: {
        provider: string;
        verificationUri: string;
        userCode: string;
        expiresIn: number;
    }) {
        this.emit('oauth:code', data);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:code', data);
        }
    }

    private emitError(message: string) {
        this.emit('oauth:error', { message });
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:error', { message });
        }
    }
}

export const deviceOAuthManager = new DeviceOAuthManager();
