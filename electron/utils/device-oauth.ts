/**
 * Device OAuth Manager
 *
 * Delegates MiniMax and Qwen OAuth to the OpenClaw extension oauth.ts functions
 * imported directly from the bundled openclaw package at build time.
 *
 * This approach:
 * - Avoids hardcoding client_id (lives in openclaw extension)
 * - Avoids duplicating HTTP OAuth logic
 * - Avoids spawning CLI process (which requires interactive TTY)
 * - Works identically on macOS, Windows, and Linux
 *
 * The extension oauth.ts files only use `node:crypto` and global `fetch` —
 * they are pure Node.js HTTP functions, no TTY, no prompter needed.
 *
 * We provide our own callbacks (openUrl/note/progress) that hook into
 * the Electron IPC system to display UI in the ClawX frontend.
 */
import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { saveProvider, getProvider, ProviderConfig } from './secure-storage';
import { getProviderDefaultModel } from './provider-registry';
import { isOpenClawPresent } from './paths';
import {
    loginMiniMaxPortalOAuth,
    type MiniMaxOAuthToken,
    type MiniMaxRegion,
} from '../../node_modules/openclaw/extensions/minimax-portal-auth/oauth';
import {
    loginQwenPortalOAuth,
    type QwenOAuthToken,
} from '../../node_modules/openclaw/extensions/qwen-portal-auth/oauth';
import { saveOAuthTokenToOpenClaw, setOpenClawDefaultModelWithOverride } from './openclaw-auth';

export type OAuthProviderType = 'minimax-portal' | 'qwen-portal';
export type { MiniMaxRegion };

// ─────────────────────────────────────────────────────────────
// DeviceOAuthManager
// ─────────────────────────────────────────────────────────────

class DeviceOAuthManager extends EventEmitter {
    private activeProvider: OAuthProviderType | null = null;
    private active: boolean = false;
    private mainWindow: BrowserWindow | null = null;

    setWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    async startFlow(provider: OAuthProviderType, region: MiniMaxRegion = 'global'): Promise<boolean> {
        if (this.active) {
            await this.stopFlow();
        }

        this.active = true;
        this.activeProvider = provider;

        try {
            if (provider === 'minimax-portal') {
                await this.runMiniMaxFlow(region);
            } else if (provider === 'qwen-portal') {
                await this.runQwenFlow();
            } else {
                throw new Error(`Unsupported OAuth provider: ${provider}`);
            }
            return true;
        } catch (error) {
            if (!this.active) {
                // Flow was cancelled — not an error
                return false;
            }
            logger.error(`[DeviceOAuth] Flow error for ${provider}:`, error);
            this.emitError(error instanceof Error ? error.message : String(error));
            this.active = false;
            this.activeProvider = null;
            return false;
        }
    }

    async stopFlow(): Promise<void> {
        this.active = false;
        this.activeProvider = null;
        logger.info('[DeviceOAuth] Flow explicitly stopped');
    }

    // ─────────────────────────────────────────────────────────
    // MiniMax flow
    // ─────────────────────────────────────────────────────────

    private async runMiniMaxFlow(region: MiniMaxRegion): Promise<void> {
        if (!isOpenClawPresent()) {
            throw new Error('OpenClaw package not found');
        }
        const provider = this.activeProvider!;

        const token: MiniMaxOAuthToken = await loginMiniMaxPortalOAuth({
            region,
            openUrl: async (url) => {
                logger.info(`[DeviceOAuth] MiniMax opening browser: ${url}`);
                // Open the authorization URL in the system browser
                shell.openExternal(url).catch((err) =>
                    logger.warn(`[DeviceOAuth] Failed to open browser:`, err)
                );
            },
            note: async (message, _title) => {
                if (!this.active) return;
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
                update: (msg) => logger.info(`[DeviceOAuth] MiniMax progress: ${msg}`),
                stop: (msg) => logger.info(`[DeviceOAuth] MiniMax progress done: ${msg ?? ''}`),
            },
        });

        if (!this.active) return;

        await this.onSuccess('minimax-portal', {
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            // MiniMax returns a per-account resourceUrl as the API base URL
            resourceUrl: token.resourceUrl,
            // MiniMax uses Anthropic Messages API format
            api: 'anthropic-messages',
        });
    }

    // ─────────────────────────────────────────────────────────
    // Qwen flow
    // ─────────────────────────────────────────────────────────

    private async runQwenFlow(): Promise<void> {
        if (!isOpenClawPresent()) {
            throw new Error('OpenClaw package not found');
        }
        const provider = this.activeProvider!;

        const token: QwenOAuthToken = await loginQwenPortalOAuth({
            openUrl: async (url) => {
                logger.info(`[DeviceOAuth] Qwen opening browser: ${url}`);
                shell.openExternal(url).catch((err) =>
                    logger.warn(`[DeviceOAuth] Failed to open browser:`, err)
                );
            },
            note: async (message, _title) => {
                if (!this.active) return;
                const { verificationUri, userCode } = this.parseNote(message);
                if (verificationUri && userCode) {
                    this.emitCode({ provider, verificationUri, userCode, expiresIn: 300 });
                } else {
                    logger.info(`[DeviceOAuth] Qwen note: ${message}`);
                }
            },
            progress: {
                update: (msg) => logger.info(`[DeviceOAuth] Qwen progress: ${msg}`),
                stop: (msg) => logger.info(`[DeviceOAuth] Qwen progress done: ${msg ?? ''}`),
            },
        });

        if (!this.active) return;

        await this.onSuccess('qwen-portal', {
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            // Qwen returns a per-account resourceUrl as the API base URL
            resourceUrl: token.resourceUrl,
            // Qwen uses OpenAI Completions API format
            api: 'openai-completions',
        });
    }

    // ─────────────────────────────────────────────────────────
    // Success handler
    // ─────────────────────────────────────────────────────────

    private async onSuccess(providerType: OAuthProviderType, token: {
        access: string;
        refresh: string;
        expires: number;
        resourceUrl?: string;
        api: 'anthropic-messages' | 'openai-completions';
    }) {
        this.active = false;
        this.activeProvider = null;
        logger.info(`[DeviceOAuth] Successfully completed OAuth for ${providerType}`);

        // 1. Write OAuth token to OpenClaw's auth-profiles.json in native OAuth format
        //    (matches what `openclaw models auth login` → upsertAuthProfile writes)
        try {
            saveOAuthTokenToOpenClaw(providerType, {
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
        // Note: MiniMax Anthropic-compatible API requires the /anthropic suffix.
        const defaultBaseUrl = providerType === 'minimax-portal'
            ? 'https://api.minimax.io/anthropic'
            : 'https://portal.qwen.ai/v1';

        let baseUrl = token.resourceUrl || defaultBaseUrl;

        // If MiniMax returned a resourceUrl (e.g. https://api.minimax.io) but no /anthropic suffix,
        // we must append it because we use the 'anthropic-messages' API mode
        if (providerType === 'minimax-portal' && baseUrl && !baseUrl.endsWith('/anthropic')) {
            baseUrl = baseUrl.replace(/\/$/, '') + '/anthropic';
        }

        try {
            setOpenClawDefaultModelWithOverride(providerType, undefined, {
                baseUrl,
                api: token.api,
                // OAuth placeholder — tells Gateway to resolve credentials
                // from auth-profiles.json (type: 'oauth') instead of a static API key.
                // This matches what the OpenClaw plugin's configPatch writes:
                //   minimax-portal → apiKey: 'minimax-oauth'
                //   qwen-portal    → apiKey: 'qwen-oauth'
                apiKeyEnv: providerType === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
            });
        } catch (err) {
            logger.warn(`[DeviceOAuth] Failed to configure openclaw models:`, err);
        }

        // 3. Save provider record in ClawX's own store so UI shows it as configured
        const existing = await getProvider(providerType);
        const providerConfig: ProviderConfig = {
            id: providerType,
            name: providerType === 'minimax-portal' ? 'MiniMax' : 'Qwen',
            type: providerType,
            enabled: existing?.enabled ?? true,
            baseUrl: existing?.baseUrl,
            model: existing?.model || getProviderDefaultModel(providerType),
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await saveProvider(providerConfig);

        // 4. Emit success to frontend
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:success', { provider: providerType, success: true });
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
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:code', data);
        }
    }

    private emitError(message: string) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:error', { message });
        }
    }
}

export const deviceOAuthManager = new DeviceOAuthManager();
