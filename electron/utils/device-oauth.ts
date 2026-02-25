import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { logger } from './logger';
import { requestMiniMaxOAuthCode, pollMiniMaxOAuthToken, MiniMaxRegion } from './minimax-oauth';
import { requestQwenDeviceCode, pollQwenDeviceToken } from './qwen-oauth';
import { saveProviderKeyToOpenClaw } from './openclaw-auth';
import { saveProvider, ProviderConfig, getProvider } from './secure-storage';
import { getProviderConfig, getProviderDefaultModel, ProviderType } from './provider-registry';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export type OAuthProviderType = 'minimax-portal' | 'qwen-portal';

export interface OAuthFlowResult {
    provider: OAuthProviderType;
    success: boolean;
    error?: string;
    token?: string;
    expiresAt?: number;
}

class DeviceOAuthManager extends EventEmitter {
    private activeProvider: OAuthProviderType | null = null;
    private active: boolean = false;
    private currentTimeout: NodeJS.Timeout | null = null;
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
                await this.handleMiniMaxFlow(region);
            } else if (provider === 'qwen-portal') {
                await this.handleQwenFlow();
            } else {
                throw new Error(`Unsupported OAuth provider: ${provider}`);
            }
            return true;
        } catch (error) {
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
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }
        logger.info('[DeviceOAuth] Flow explicitly stopped');
    }

    private async handleMiniMaxFlow(region: MiniMaxRegion) {
        logger.info(`[DeviceOAuth] Starting MiniMax flow (${region})`);
        const { oauth, verifier } = await requestMiniMaxOAuthCode(region);

        this.emitCode({
            provider: 'minimax-portal',
            verificationUri: oauth.verification_uri,
            userCode: oauth.user_code,
            expiresIn: Math.floor((oauth.expired_in - Date.now()) / 1000),
        });

        let pollIntervalMs = oauth.interval || 2000;
        const expireTimeMs = oauth.expired_in;

        const poll = async () => {
            if (!this.active || this.activeProvider !== 'minimax-portal') return;

            if (Date.now() >= expireTimeMs) {
                this.emitError('Authorization timed out');
                this.active = false;
                return;
            }

            try {
                const result = await pollMiniMaxOAuthToken({
                    userCode: oauth.user_code,
                    verifier,
                    region,
                });

                if (result.status === 'success') {
                    await this.onSuccess('minimax-portal', result.token.access);
                    return;
                }

                if (result.status === 'error') {
                    throw new Error(result.message);
                }

                if (result.status === 'pending') {
                    pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
                }

                this.currentTimeout = setTimeout(poll, pollIntervalMs);
            } catch (error) {
                logger.error('[DeviceOAuth] MiniMax poll error:', error);
                this.emitError(error instanceof Error ? error.message : String(error));
                this.active = false;
            }
        };

        this.currentTimeout = setTimeout(poll, pollIntervalMs);
    }

    private async handleQwenFlow() {
        logger.info('[DeviceOAuth] Starting Qwen flow');
        const { device, verifier } = await requestQwenDeviceCode();

        const verificationUrl = device.verification_uri_complete || device.verification_uri;
        this.emitCode({
            provider: 'qwen-portal',
            verificationUri: verificationUrl,
            userCode: device.user_code,
            expiresIn: device.expires_in,
        });

        const start = Date.now();
        let pollIntervalMs = device.interval ? device.interval * 1000 : 2000;
        const timeoutMs = device.expires_in * 1000;

        const poll = async () => {
            if (!this.active || this.activeProvider !== 'qwen-portal') return;

            if (Date.now() - start >= timeoutMs) {
                this.emitError('Authorization timed out');
                this.active = false;
                return;
            }

            try {
                const result = await pollQwenDeviceToken({
                    deviceCode: device.device_code,
                    verifier,
                });

                if (result.status === 'success') {
                    await this.onSuccess('qwen-portal', result.token.access);
                    return;
                }

                if (result.status === 'error') {
                    throw new Error(result.message);
                }

                if (result.status === 'pending' && result.slowDown) {
                    pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
                }

                this.currentTimeout = setTimeout(poll, pollIntervalMs);
            } catch (error) {
                logger.error('[DeviceOAuth] Qwen poll error:', error);
                this.emitError(error instanceof Error ? error.message : String(error));
                this.active = false;
            }
        };

        this.currentTimeout = setTimeout(poll, pollIntervalMs);
    }

    private async onSuccess(providerType: OAuthProviderType, key: string) {
        this.active = false;
        this.activeProvider = null;
        logger.info(`[DeviceOAuth] Successfully obtained token for ${providerType}`);

        // Save to OpenClaw's auth-profiles.json so the gateway can use it
        saveProviderKeyToOpenClaw(providerType, key);

        // Save to ClawX's secure storage
        const existing = await getProvider(providerType);
        const providerConfig: ProviderConfig = {
            id: providerType,
            name: providerType === 'minimax-portal' ? 'MiniMax' : 'Qwen',
            type: providerType as ProviderType,
            enabled: existing?.enabled ?? true,
            baseUrl: existing?.baseUrl || getProviderConfig(providerType)?.baseUrl,
            model: existing?.model || getProviderDefaultModel(providerType),
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await saveProvider(providerConfig);

        // Wire models.providers config in openclaw.json
        this.configureOpenClawModels(providerType, providerConfig.baseUrl);

        // Emit success event to frontend
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('oauth:success', {
                provider: providerType,
                success: true,
            });
        }
    }

    private configureOpenClawModels(provider: OAuthProviderType, baseUrl?: string) {
        const configPath = join(homedir(), '.openclaw', 'openclaw.json');
        let config: Record<string, unknown> = {};

        try {
            if (existsSync(configPath)) {
                config = JSON.parse(readFileSync(configPath, 'utf-8'));
            }
        } catch (err) {
            logger.warn('Failed to read openclaw.json for models update:', err);
            return;
        }

        const providerCfg = getProviderConfig(provider);
        if (!providerCfg) return;

        const models = (config.models || {}) as Record<string, unknown>;
        const providers = (models.providers || {}) as Record<string, unknown>;

        const defaultModel = getProviderDefaultModel(provider as ProviderType) || '';

        const existingProvider = providers[provider] && typeof providers[provider] === 'object' ? (providers[provider] as Record<string, unknown>) : {};
        const existingModels = Array.isArray(existingProvider.models) ? (existingProvider.models as Array<Record<string, unknown>>) : [];
        const registryModels = (providerCfg.models ?? []).map((m) => ({ ...m })) as Array<Record<string, unknown>>;

        const mergedModels = [...registryModels];
        for (const item of existingModels) {
            const id = typeof item?.id === 'string' ? item.id : '';
            if (id && !mergedModels.some((m) => m.id === id)) {
                mergedModels.push(item);
            }
        }

        providers[provider] = {
            ...existingProvider,
            baseUrl: baseUrl || providerCfg.baseUrl || (provider === 'minimax-portal' ? 'https://api.minimax.io/anthropic' : 'https://chat.qwen.ai/api/v1/oauth2'), // Fallbacks
            api: providerCfg.api || (provider === 'minimax-portal' ? 'anthropic-messages' : 'openai-completions'),
            apiKey: providerCfg.apiKeyEnv || 'minimax-oauth', // Usually just placeholder
            models: mergedModels,
        };

        models.providers = providers;
        config.models = models;

        const agents = (config.agents || {}) as Record<string, unknown>;
        const defaults = (agents.defaults || {}) as Record<string, unknown>;
        defaults.model = { primary: defaultModel };
        agents.defaults = defaults;
        config.agents = agents;

        try {
            writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            logger.info(`[DeviceOAuth] Updated openclaw.json models for ${provider}`);
        } catch (err) {
            logger.error(`[DeviceOAuth] Failed to write config: ${err}`);
        }
    }

    private emitCode(data: { provider: string, verificationUri: string, userCode: string, expiresIn: number }) {
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
