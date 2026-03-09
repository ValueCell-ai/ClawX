import type { IncomingMessage, ServerResponse } from 'http';
import {
  type ProviderConfig,
} from '../../utils/secure-storage';
import {
  getProviderConfig,
} from '../../utils/provider-registry';
import { deviceOAuthManager, type OAuthProviderType } from '../../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../../utils/browser-oauth';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../../services/providers/provider-runtime-sync';
import { validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';

const legacyProviderRoutesWarned = new Set<string>();

export async function handleProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const providerService = getProviderService();
  const logLegacyProviderRoute = (route: string): void => {
    if (legacyProviderRoutesWarned.has(route)) return;
    legacyProviderRoutesWarned.add(route);
    logger.warn(
      `[provider-migration] Legacy HTTP route "${route}" is deprecated. Prefer /api/provider-accounts endpoints.`,
    );
  };

  if (url.pathname === '/api/provider-vendors' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listVendors());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccounts());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ account: ProviderAccount; apiKey?: string }>(req);
      const account = await providerService.createAccount(body.account, body.apiKey);
      await syncSavedProviderToRuntime(providerAccountToConfig(account), body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true, account });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'GET') {
    sendJson(res, 200, { accountId: await providerService.getDefaultAccountId() ?? null });
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      await providerService.setDefaultAccount(body.accountId);
      await syncDefaultProviderToRuntime(body.accountId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'GET') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    sendJson(res, 200, await providerService.getAccount(accountId));
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderAccount>; apiKey?: string }>(req);
      const existing = await providerService.getAccount(accountId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider account not found' });
        return true;
      }
      const nextAccount = await providerService.updateAccount(accountId, body.updates, body.apiKey);
      await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true, account: nextAccount });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const existing = await providerService.getAccount(accountId);
      const runtimeProviderKey = existing?.vendorId === 'google' && existing.authMode === 'oauth_browser'
        ? 'google-gemini-cli'
        : undefined;
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(accountId);
        await syncDeletedProviderApiKeyToRuntime(
          existing ? providerAccountToConfig(existing) : null,
          accountId,
          runtimeProviderKey,
        );
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteAccount(accountId);
      await syncDeletedProviderToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx.gatewayManager,
        runtimeProviderKey,
      );
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers');
    sendJson(res, 200, await providerService.listLegacyProvidersWithKeyInfo());
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/default');
    sendJson(res, 200, { providerId: await providerService.getDefaultLegacyProvider() ?? null });
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/default');
    try {
      const body = await parseJsonBody<{ providerId: string }>(req);
      await providerService.setDefaultLegacyProvider(body.providerId);
      await syncDefaultProviderToRuntime(body.providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/validate' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/validate');
    try {
      const body = await parseJsonBody<{ providerId: string; apiKey: string; options?: { baseUrl?: string } }>(req);
      const provider = await providerService.getLegacyProvider(body.providerId);
      const providerType = provider?.type || body.providerId;
      const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
      const resolvedBaseUrl = body.options?.baseUrl || provider?.baseUrl || registryBaseUrl;
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, { baseUrl: resolvedBaseUrl }));
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/start' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/start');
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
      }>(req);
      if (body.provider === 'google') {
        await browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
        });
      } else {
        await deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/cancel' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/cancel');
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers');
    try {
      const body = await parseJsonBody<{ config: ProviderConfig; apiKey?: string }>(req);
      const config = body.config;
      await providerService.saveLegacyProvider(config);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
          await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
        }
      }
      await syncSavedProviderToRuntime(config, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    if (providerId.endsWith('/api-key')) {
      const actualId = providerId.slice(0, -('/api-key'.length));
      sendJson(res, 200, { apiKey: await providerService.getLegacyProviderApiKey(actualId) });
      return true;
    }
    if (providerId.endsWith('/has-api-key')) {
      const actualId = providerId.slice(0, -('/has-api-key'.length));
      sendJson(res, 200, { hasKey: await providerService.hasLegacyProviderApiKey(actualId) });
      return true;
    }
    sendJson(res, 200, await providerService.getLegacyProvider(providerId));
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderConfig>; apiKey?: string }>(req);
      const existing = await providerService.getLegacyProvider(providerId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider not found' });
        return true;
      }
      const nextConfig: ProviderConfig = { ...existing, ...body.updates, updatedAt: new Date().toISOString() };
      await providerService.saveLegacyProvider(nextConfig);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
          await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
        } else {
          await providerService.deleteLegacyProviderApiKey(providerId);
          await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        }
      }
      await syncUpdatedProviderToRuntime(nextConfig, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'DELETE') {
    logLegacyProviderRoute('DELETE /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const existing = await providerService.getLegacyProvider(providerId);
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(providerId);
        await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteLegacyProvider(providerId);
      await syncDeletedProviderToRuntime(existing, providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
