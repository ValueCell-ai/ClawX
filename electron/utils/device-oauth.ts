/**
 * Device OAuth Manager
 *
 * Delegates MiniMax and Qwen OAuth to the OpenClaw extension oauth.ts functions
 * loaded dynamically at runtime from the bundled openclaw package.
 *
 * This approach:
 * - Avoids hardcoding client_id (lives in openclaw extension)
 * - Avoids duplicating HTTP OAuth logic
 * - Avoids spawning CLI process (which requires interactive TTY)
 * - Works identically on macOS, Windows, and Linux
 *
 * The extension oauth.ts/.js files only use `node:crypto` and global `fetch` —
 * they are pure Node.js HTTP functions, no TTY, no prompter needed.
 *
 * We provide our own callbacks (openUrl/note/progress) that hook into
 * the Electron IPC system to display UI in the ClawX frontend.
 *
 * NOTE: The OAuth modules are loaded via dynamic import() at runtime rather
 * than static imports, because the openclaw npm package may not ship the
 * extension source files at build time. They are resolved from the OpenClaw
 * runtime directory (dev: node_modules/openclaw, prod: resources/openclaw).
 */
import { join } from 'path';
import { readdirSync } from 'fs';
import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { saveProvider, getProvider, ProviderConfig } from './secure-storage';
import { getProviderDefaultModel } from './provider-registry';
import { isOpenClawPresent, getOpenClawDir } from './paths';
import { proxyAwareFetch } from './proxy-fetch';
import { saveOAuthTokenToOpenClaw, setOpenClawDefaultModelWithOverride } from './openclaw-auth';

export type OAuthProviderType = 'minimax-portal' | 'minimax-portal-cn' | 'qwen-portal';

// ── Types mirroring the OpenClaw extension oauth modules ─────
// Defined locally to avoid build-time dependency on the openclaw package.

export type MiniMaxRegion = 'global' | 'cn';

export interface MiniMaxOAuthToken {
    access: string;
    refresh: string;
    expires: number;
    resourceUrl?: string;
}

export interface QwenOAuthToken {
    access: string;
    refresh: string;
    expires: number;
    resourceUrl?: string;
}

interface OAuthCallbacks {
    openUrl: (url: string) => Promise<void>;
    note: (message: string, title?: string) => Promise<void>;
    progress: { update: (msg: string) => void; stop: (msg?: string) => void };
}

interface MiniMaxOAuthOptions extends OAuthCallbacks {
    region?: MiniMaxRegion;
}

type QwenOAuthOptions = OAuthCallbacks;

// ── Dynamic extension loaders ────────────────────────────────
// The openclaw npm package has changed its layout across versions:
//   - Old: extensions/minimax-portal-auth/oauth (source .ts/.js)
//   - New: dist/extensions/minimax/index (bundled .js)
// We try multiple candidate paths to remain compatible.


import { getOpenClawResolvedDir } from './paths';

/** Try importing a module from multiple candidate paths, return first success. */
async function tryImportFrom(candidates: string[]): Promise<{ mod: Record<string, unknown>; path: string }> {
    const errors: string[] = [];
    for (const p of candidates) {
        // ESM dynamic import() requires explicit .js extension;
        // try both .js-suffixed and original path for CJS compat.
        const variants = p.endsWith('.js') ? [p] : [`${p}.js`, p];
        for (const v of variants) {
            try {
                const mod = await import(v);
                return { mod, path: v };
            } catch (err) {
                errors.push(`  ${v}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // On failure, list files in extension directories for debugging
    const dirSet = new Set<string>();
    for (const p of candidates) {
        // Get parent directory of the candidate (e.g. dist/extensions/minimax)
        // Use join(p, '..') instead of regex to handle both Unix / and Windows \ separators
        const parentDir = join(p, '..');
        if (dirSet.has(parentDir)) continue;
        dirSet.add(parentDir);
        try {
            const files = readdirSync(parentDir);
            errors.push(`  [dir listing] ${parentDir}: [${files.join(', ')}]`);
        } catch {
            errors.push(`  [dir listing] ${parentDir}: (not accessible)`);
        }
    }

    throw new Error(
        `Failed to load OAuth extension from any candidate path:\n${errors.join('\n')}`
    );
}

function buildMiniMaxCandidates(): string[] {
    const dirs = [getOpenClawDir(), getOpenClawResolvedDir()];
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const dir of dirs) {
        if (seen.has(dir)) continue;
        seen.add(dir);
        // New dist layout (openclaw >= 2026.3.23) — oauth module is separate from index
        candidates.push(join(dir, 'dist', 'extensions', 'minimax', 'oauth'));
        candidates.push(join(dir, 'dist', 'extensions', 'minimax-portal-auth', 'oauth'));
        candidates.push(join(dir, 'dist', 'extensions', 'minimax', 'index'));
        candidates.push(join(dir, 'dist', 'extensions', 'minimax-portal-auth', 'index'));
        // Old source layout
        candidates.push(join(dir, 'extensions', 'minimax-portal-auth', 'oauth'));
        candidates.push(join(dir, 'extensions', 'minimax', 'oauth'));
    }
    return candidates;
}

function buildQwenCandidates(): string[] {
    const dirs = [getOpenClawDir(), getOpenClawResolvedDir()];
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const dir of dirs) {
        if (seen.has(dir)) continue;
        seen.add(dir);
        // New dist layout — oauth module is separate from index
        candidates.push(join(dir, 'dist', 'extensions', 'qwen', 'oauth'));
        candidates.push(join(dir, 'dist', 'extensions', 'qwen-portal-auth', 'oauth'));
        candidates.push(join(dir, 'dist', 'extensions', 'qwen', 'index'));
        candidates.push(join(dir, 'dist', 'extensions', 'qwen-portal-auth', 'index'));
        // Old source layout
        candidates.push(join(dir, 'extensions', 'qwen-portal-auth', 'oauth'));
        candidates.push(join(dir, 'extensions', 'qwen', 'oauth'));
    }
    return candidates;
}

/** Search for an OAuth function export by trying several naming conventions. */
function findOAuthExport(
    mod: Record<string, unknown>,
    names: string[],
    resolvedPath: string,
    label: string,
): (...args: unknown[]) => unknown {
    // Log all exports for debugging
    const topKeys = Object.keys(mod);
    logger.info(`[DeviceOAuth] ${label} module top-level exports: [${topKeys.join(', ')}]`);
    const defaultObj = mod.default as Record<string, unknown> | undefined;
    if (defaultObj && typeof defaultObj === 'object') {
        logger.info(`[DeviceOAuth] ${label} module default exports: [${Object.keys(defaultObj).join(', ')}]`);
    }

    // Search through candidate names in top-level, then in default
    for (const name of names) {
        if (typeof mod[name] === 'function') return mod[name] as (...args: unknown[]) => unknown;
        if (defaultObj && typeof defaultObj[name] === 'function') return defaultObj[name] as (...args: unknown[]) => unknown;
    }

    // Fallback: find any function export whose name contains 'oauth' (case-insensitive)
    for (const [k, v] of Object.entries(mod)) {
        if (typeof v === 'function' && k.toLowerCase().includes('oauth')) {
            logger.info(`[DeviceOAuth] ${label} using fallback function: ${k}`);
            return v as (...args: unknown[]) => unknown;
        }
    }
    if (defaultObj && typeof defaultObj === 'object') {
        for (const [k, v] of Object.entries(defaultObj)) {
            if (typeof v === 'function' && k.toLowerCase().includes('oauth')) {
                logger.info(`[DeviceOAuth] ${label} using fallback default function: ${k}`);
                return v as (...args: unknown[]) => unknown;
            }
        }
    }

    // If the default export itself is a function, try it
    if (typeof mod.default === 'function') {
        logger.info(`[DeviceOAuth] ${label} using default export as function`);
        return mod.default as (...args: unknown[]) => unknown;
    }

    throw new Error(
        `${label} OAuth module at ${resolvedPath} does not export any recognized OAuth function. ` +
        `Top-level: [${topKeys.join(', ')}]` +
        (defaultObj ? `, default: [${Object.keys(defaultObj).join(', ')}]` : '')
    );
}

async function loadMiniMaxOAuth(): Promise<(opts: MiniMaxOAuthOptions) => Promise<MiniMaxOAuthToken>> {
    const candidates = buildMiniMaxCandidates();
    const { mod, path: resolvedPath } = await tryImportFrom(candidates);
    logger.info(`[DeviceOAuth] Loaded MiniMax OAuth from: ${resolvedPath}`);
    const fn = findOAuthExport(mod, [
        'loginMiniMaxPortalOAuth',
        'loginMiniMaxOAuth',
        'loginMinimaxPortalOAuth',
        'loginMinimaxOAuth',
        'login',
        'deviceCodeLogin',
    ], resolvedPath, 'MiniMax');
    return fn as (opts: MiniMaxOAuthOptions) => Promise<MiniMaxOAuthToken>;
}

async function loadQwenOAuth(): Promise<(opts: QwenOAuthOptions) => Promise<QwenOAuthToken>> {
    const candidates = buildQwenCandidates();
    const { mod, path: resolvedPath } = await tryImportFrom(candidates);
    logger.info(`[DeviceOAuth] Loaded Qwen OAuth from: ${resolvedPath}`);
    const fn = findOAuthExport(mod, [
        'loginQwenPortalOAuth',
        'loginQwenOAuth',
        'login',
        'deviceCodeLogin',
    ], resolvedPath, 'Qwen');
    return fn as (opts: QwenOAuthOptions) => Promise<QwenOAuthToken>;
}

// ─────────────────────────────────────────────────────────────
// DeviceOAuthManager
// ─────────────────────────────────────────────────────────────

class DeviceOAuthManager extends EventEmitter {
    private activeProvider: OAuthProviderType | null = null;
    private activeAccountId: string | null = null;
    private activeLabel: string | null = null;
    private active: boolean = false;
    private mainWindow: BrowserWindow | null = null;

    private async runWithProxyAwareFetch<T>(task: () => Promise<T>): Promise<T> {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = ((input: string | URL, init?: RequestInit) =>
            proxyAwareFetch(input, init)) as typeof fetch;
        try {
            return await task();
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    setWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    async startFlow(
        provider: OAuthProviderType,
        region: MiniMaxRegion = 'global',
        options?: { accountId?: string; label?: string },
    ): Promise<boolean> {
        if (this.active) {
            await this.stopFlow();
        }

        this.active = true;
        this.emit('oauth:start', { provider, accountId: options?.accountId || provider });
        this.activeProvider = provider;
        this.activeAccountId = options?.accountId || provider;
        this.activeLabel = options?.label || null;

        try {
            if (provider === 'minimax-portal' || provider === 'minimax-portal-cn') {
                const actualRegion = provider === 'minimax-portal-cn' ? 'cn' : (region || 'global');
                await this.runMiniMaxFlow(actualRegion, provider);
            } else if (provider === 'qwen-portal') {
                await this.runQwenFlow();
            } else {
                throw new Error(`Unsupported OAuth provider type: ${provider}`);
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
            this.activeAccountId = null;
            this.activeLabel = null;
            return false;
        }
    }

    async stopFlow(): Promise<void> {
        this.active = false;
        this.activeProvider = null;
        this.activeAccountId = null;
        this.activeLabel = null;
        logger.info('[DeviceOAuth] Flow explicitly stopped');
    }

    // ─────────────────────────────────────────────────────────
    // MiniMax flow
    // ─────────────────────────────────────────────────────────

    private async runMiniMaxFlow(region?: MiniMaxRegion, providerType: OAuthProviderType = 'minimax-portal'): Promise<void> {
        if (!isOpenClawPresent()) {
            throw new Error('OpenClaw package not found');
        }
        const provider = this.activeProvider!;

        const loginMiniMaxPortalOAuth = await loadMiniMaxOAuth();
        const token: MiniMaxOAuthToken = await this.runWithProxyAwareFetch(() => loginMiniMaxPortalOAuth({
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
        }));

        if (!this.active) return;

        await this.onSuccess(providerType, {
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            // MiniMax returns a per-account resourceUrl as the API base URL
            resourceUrl: token.resourceUrl,
            // Revert back to anthropic-messages
            api: 'anthropic-messages',
            region,
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

        const loginQwenPortalOAuth = await loadQwenOAuth();
        const token: QwenOAuthToken = await this.runWithProxyAwareFetch(() => loginQwenPortalOAuth({
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
        }));

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
        region?: MiniMaxRegion;
    }) {
        const accountId = this.activeAccountId || providerType;
        const accountLabel = this.activeLabel;
        this.active = false;
        this.activeProvider = null;
        this.activeAccountId = null;
        this.activeLabel = null;
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
            : (providerType === 'minimax-portal-cn' ? 'https://api.minimaxi.com/anthropic' : 'https://portal.qwen.ai/v1');

        let baseUrl = token.resourceUrl || defaultBaseUrl;

        // Ensure baseUrl has a protocol prefix
        if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
            baseUrl = 'https://' + baseUrl;
        }

        // Ensure the base URL ends with /anthropic
        if (providerType.startsWith('minimax-portal') && baseUrl) {
            baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
        } else if (providerType === 'qwen-portal' && baseUrl) {
            // Ensure Qwen API gets /v1 at the end
            if (!baseUrl.endsWith('/v1')) {
                baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
            }
        }

        try {
            const tokenProviderId = providerType.startsWith('minimax-portal') ? 'minimax-portal' : providerType;
            await setOpenClawDefaultModelWithOverride(tokenProviderId, undefined, {
                baseUrl,
                api: token.api,
                // Tells OpenClaw's anthropic adapter to use `Authorization: Bearer` instead of `x-api-key`
                authHeader: providerType.startsWith('minimax-portal') ? true : undefined,
                // OAuth placeholder — tells Gateway to resolve credentials
                // from auth-profiles.json (type: 'oauth') instead of a static API key.
                apiKeyEnv: tokenProviderId === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
            });
        } catch (err) {
            logger.warn(`[DeviceOAuth] Failed to configure openclaw models:`, err);
        }

        // 3. Save provider record in ClawX's own store so UI shows it as configured
        const existing = await getProvider(accountId);
        const nameMap: Record<OAuthProviderType, string> = {
            'minimax-portal': 'MiniMax (Global)',
            'minimax-portal-cn': 'MiniMax (CN)',
            'qwen-portal': 'Qwen',
        };
        const providerConfig: ProviderConfig = {
            id: accountId,
            name: accountLabel || nameMap[providerType as OAuthProviderType] || providerType,
            type: providerType,
            enabled: existing?.enabled ?? true,
            baseUrl, // Save the dynamically resolved URL (Global vs CN)

            model: existing?.model || getProviderDefaultModel(providerType),
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
