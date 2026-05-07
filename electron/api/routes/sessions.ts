import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import {
  removeSessionEntry,
  resolveSessionTranscriptPath,
  sweepSessionArtefacts,
} from '../../utils/session-files';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/sessions/transcript' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId')?.trim() || '';
      const sessionId = url.searchParams.get('sessionId')?.trim() || '';
      if (!agentId || !sessionId) {
        sendJson(res, 400, { success: false, error: 'agentId and sessionId are required' });
        return true;
      }
      if (!SAFE_SESSION_SEGMENT.test(agentId) || !SAFE_SESSION_SEGMENT.test(sessionId)) {
        sendJson(res, 400, { success: false, error: 'Invalid transcript identifier' });
        return true;
      }

      const transcriptPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(transcriptPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const messages = lines.flatMap((line) => {
        try {
          const entry = JSON.parse(line) as { type?: string; message?: unknown };
          return entry.type === 'message' && entry.message ? [entry.message] : [];
        } catch {
          return [];
        }
      });

      sendJson(res, 200, { success: true, messages });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        sendJson(res, 404, { success: false, error: 'Transcript not found' });
      } else {
        sendJson(res, 500, { success: false, error: 'Failed to load transcript' });
      }
    }
    return true;
  }

  // POST /api/sessions/delete — HTTP mirror of the `session:delete` IPC.
  // Both surfaces share electron/utils/session-files.ts so they sweep the
  // same set of artefacts: the live transcript, legacy `.deleted.jsonl`,
  // `.jsonl.reset.*` snapshots, the trajectory sidecar pair
  // (`<id>.trajectory.jsonl` + `<id>.trajectory-path.json`) and — when the
  // pointer points outside sessions/ (the OPENCLAW_TRAJECTORY_DIR case) —
  // the off-disk runtime trajectory it references.
  if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string }>(req);
      const sessionKey = body.sessionKey;
      if (!sessionKey || !sessionKey.startsWith('agent:')) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }
      const parts = sessionKey.split(':');
      if (parts.length < 3) {
        sendJson(res, 400, { success: false, error: `sessionKey has too few parts: ${sessionKey}` });
        return true;
      }
      const agentId = parts[1];
      // Defence-in-depth: agentId becomes a path segment under
      // ~/.openclaw/agents/. The sibling /api/sessions/transcript route
      // applies the same check to its sessionId; mirror it here so a
      // malformed key can never steer the unlink loop into another folder.
      if (!SAFE_SESSION_SEGMENT.test(agentId)) {
        sendJson(res, 400, { success: false, error: `Invalid agentId: ${agentId}` });
        return true;
      }
      const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
      const sessionsJsonPath = join(sessionsDir, 'sessions.json');
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      const sessionsJson = JSON.parse(raw) as Record<string, unknown>;

      const resolution = resolveSessionTranscriptPath(sessionsJson, sessionsDir, sessionKey);
      if (!resolution.ok) {
        if (resolution.failure.kind === 'not-found') {
          sendJson(res, 404, { success: false, error: `Cannot resolve file for session: ${sessionKey}` });
        } else {
          logger.warn(`[api/sessions/delete] Refusing out-of-scope path for "${sessionKey}": ${resolution.failure.resolvedPath}`);
          sendJson(res, 400, { success: false, error: `Resolved session path is outside the agent sessions dir: ${resolution.failure.resolvedPath}` });
        }
        return true;
      }

      const sweep = await sweepSessionArtefacts(resolution.sessionsDirAbs, resolution.baseId);
      for (const { path: failedPath, error } of sweep.errors) {
        logger.warn(`[api/sessions/delete] Failed to unlink ${failedPath}: ${String(error)}`);
      }

      const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json2 = JSON.parse(raw2) as Record<string, unknown>;
      removeSessionEntry(json2, sessionKey);
      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
