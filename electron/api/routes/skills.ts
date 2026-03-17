import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import {
  computeEffectiveSkills,
  readSkillPolicy,
  updateSkillPolicyAgentOverride,
  updateSkillPolicyGlobal,
} from '../../utils/skill-policy';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/policy' && req.method === 'GET') {
    try {
      const policy = await readSkillPolicy();
      const agentId = (url.searchParams.get('agentId') || '').trim();
      sendJson(res, 200, {
        success: true,
        policy,
        ...(agentId ? { effective: computeEffectiveSkills(policy, agentId) } : {}),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/policy/global' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ enabledSkillKeys?: unknown }>(req);
      const enabledSkillKeys = Array.isArray(body.enabledSkillKeys)
        ? body.enabledSkillKeys.filter((v): v is string => typeof v === 'string')
        : [];
      const policy = await updateSkillPolicyGlobal(enabledSkillKeys);
      sendJson(res, 200, { success: true, policy });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/skills/policy/agents/') && req.method === 'PUT') {
    try {
      const agentId = decodeURIComponent(url.pathname.slice('/api/skills/policy/agents/'.length)).trim();
      if (!agentId) {
        sendJson(res, 400, { success: false, error: 'agentId is required' });
        return true;
      }
      const body = await parseJsonBody<{ enabled?: unknown; disabled?: unknown }>(req);
      const enabled = Array.isArray(body.enabled) ? body.enabled.filter((v): v is string => typeof v === 'string') : [];
      const disabled = Array.isArray(body.disabled) ? body.disabled.filter((v): v is string => typeof v === 'string') : [];
      const policy = await updateSkillPolicyAgentOverride(agentId, { enabled, disabled });
      sendJson(res, 200, {
        success: true,
        policy,
        effective: computeEffectiveSkills(policy, agentId),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      sendJson(res, 200, {
        success: true,
        results: await ctx.clawHubService.search(body),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.clawHubService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.clawHubService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
