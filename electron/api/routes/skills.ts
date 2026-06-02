import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig, updateSkillConfigs } from '../../utils/skill-config';
import { collectQuickAccessSkills, filterEnabledQuickAccessSkills, type QuickAccessRuntimeSkillStatus } from '../../utils/skill-quick-access';
import { listLocalSkills } from '../../services/skills/local-skill-service';
import type { MarketplaceInstallParams, MarketplaceSearchParams, MarketplaceUninstallParams } from '../../gateway/clawhub';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleMarketplaceCapability(res: ServerResponse, ctx: HostApiContext): Promise<void> {
  sendJson(res, 200, {
    success: true,
    capability: await ctx.clawHubService.getMarketplaceCapability(),
  });
}

async function handleMarketplaceSearch(req: IncomingMessage, res: ServerResponse, ctx: HostApiContext): Promise<void> {
  const body = await parseJsonBody<MarketplaceSearchParams>(req);
  sendJson(res, 200, {
    success: true,
    results: await ctx.clawHubService.search(body),
  });
}

async function handleMarketplaceInstall(req: IncomingMessage, res: ServerResponse, ctx: HostApiContext): Promise<void> {
  const body = await parseJsonBody<MarketplaceInstallParams>(req);
  await ctx.clawHubService.install(body);
  sendJson(res, 200, { success: true });
}

async function handleMarketplaceUninstall(req: IncomingMessage, res: ServerResponse, ctx: HostApiContext): Promise<void> {
  const body = await parseJsonBody<MarketplaceUninstallParams>(req);
  await ctx.clawHubService.uninstall(body);
  sendJson(res, 200, { success: true });
}

async function handleMarketplaceList(res: ServerResponse, ctx: HostApiContext): Promise<void> {
  sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        enabled?: boolean;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        enabled: body.enabled,
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/configs' && req.method === 'PATCH') {
    try {
      const body = await parseJsonBody<{
        updates?: Array<{
          skillKey: string;
          enabled?: boolean;
          apiKey?: string;
          env?: Record<string, string>;
        }>;
      }>(req);
      sendJson(res, 200, await updateSkillConfigs(body.updates || []));
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/local' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        skills: await listLocalSkills(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/quick-access' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        workspace?: string;
      }>(req);
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: body.workspace,
        }),
        getAllSkillConfigs(),
      ]);
      let runtimeSkills: QuickAccessRuntimeSkillStatus[] | undefined;
      if (ctx.gatewayManager.getStatus().state === 'running') {
        try {
          const runtimeStatus = await ctx.gatewayManager.rpc<{ skills?: QuickAccessRuntimeSkillStatus[] }>('skills.status');
          runtimeSkills = runtimeStatus.skills || [];
        } catch {
          runtimeSkills = undefined;
        }
      }
      sendJson(res, 200, {
        success: true,
        skills: filterEnabledQuickAccessSkills(scannedSkills, runtimeSkills, configs),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/capability' && req.method === 'GET') {
    try {
      await handleMarketplaceCapability(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/search' && req.method === 'POST') {
    try {
      await handleMarketplaceSearch(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/install' && req.method === 'POST') {
    try {
      await handleMarketplaceInstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/uninstall' && req.method === 'POST') {
    try {
      await handleMarketplaceUninstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/list' && req.method === 'GET') {
    try {
      await handleMarketplaceList(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/capability' && req.method === 'GET') {
    try {
      await handleMarketplaceCapability(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      await handleMarketplaceSearch(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      await handleMarketplaceInstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      await handleMarketplaceUninstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      await handleMarketplaceList(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  return false;
}
