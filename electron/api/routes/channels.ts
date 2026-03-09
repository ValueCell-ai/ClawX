import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';
import { existsSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  deleteChannelConfig,
  getChannelFormValues,
  listConfiguredChannels,
  saveChannelConfig,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import { whatsAppLoginManager } from '../../utils/whatsapp-login';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function ensureDingTalkPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const targetDir = join(homedir(), '.openclaw', 'extensions', 'dingtalk');
  const targetManifest = join(targetDir, 'openclaw.plugin.json');

  if (existsSync(targetManifest)) {
    return { installed: true };
  }

  const candidateSources = app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', 'dingtalk'),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', 'dingtalk'),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', 'dingtalk'),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', 'dingtalk'),
      join(process.cwd(), 'build', 'openclaw-plugins', 'dingtalk'),
      join(__dirname, '../../../build/openclaw-plugins/dingtalk'),
    ];

  const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled DingTalk plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!existsSync(targetManifest)) {
      return { installed: false, warning: 'Failed to install DingTalk plugin mirror (manifest missing).' };
    }
    return { installed: true };
  } catch {
    return { installed: false, warning: 'Failed to install bundled DingTalk plugin mirror' };
  }
}

async function ensureWeComPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const targetDir = join(homedir(), '.openclaw', 'extensions', 'wecom');
  const targetManifest = join(targetDir, 'openclaw.plugin.json');

  if (existsSync(targetManifest)) {
    return { installed: true };
  }

  const candidateSources = app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', 'wecom'),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', 'wecom'),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', 'wecom'),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', 'wecom'),
      join(process.cwd(), 'build', 'openclaw-plugins', 'wecom'),
      join(__dirname, '../../../build/openclaw-plugins/wecom'),
    ];

  const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled WeCom plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!existsSync(targetManifest)) {
      return { installed: false, warning: 'Failed to install WeCom plugin mirror (manifest missing).' };
    }
    return { installed: true };
  } catch {
    return { installed: false, warning: 'Failed to install bundled WeCom plugin mirror' };
  }
}

export async function handleChannelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/channels/configured' && req.method === 'GET') {
    sendJson(res, 200, { success: true, channels: await listConfiguredChannels() });
    return true;
  }

  if (url.pathname === '/api/channels/config/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelConfig(body.channelType)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/credentials/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, string> }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelCredentials(body.channelType, body.config)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      await whatsAppLoginManager.start(body.accountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/cancel' && req.method === 'POST') {
    try {
      await whatsAppLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, unknown> }>(req);
      if (body.channelType === 'dingtalk') {
        const installResult = await ensureDingTalkPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'DingTalk plugin install failed' });
          return true;
        }
      }
      if (body.channelType === 'wecom') {
        const installResult = await ensureWeComPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeCom plugin install failed' });
          return true;
        }
      }
      await saveChannelConfig(body.channelType, body.config);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/enabled' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; enabled: boolean }>(req);
      await setChannelEnabled(body.channelType, body.enabled);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'GET') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      sendJson(res, 200, {
        success: true,
        values: await getChannelFormValues(channelType),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'DELETE') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      await deleteChannelConfig(channelType);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
