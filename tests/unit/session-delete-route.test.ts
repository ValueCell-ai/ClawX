/**
 * Unit tests for the /api/sessions/delete HTTP route.
 *
 * The route hard-deletes a conversation's transcript on disk:
 *   - <id>.jsonl              — the live transcript
 *   - <id>.deleted.jsonl      — leftovers from earlier soft-delete releases
 *   - <id>.jsonl.reset.*      — reset snapshots from sessions.reset
 * It also removes the entry from sessions.json.
 *
 * These tests exercise the real `handleSessionRoutes` against a temp
 * OpenClaw config directory so the FS contract is verified end-to-end.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();

const testOpenClawConfigDir = join(tmpdir(), 'clawx-tests', 'session-delete-route-openclaw');

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawConfigDir,
  getOpenClawDir: () => testOpenClawConfigDir,
  getOpenClawResolvedDir: () => testOpenClawConfigDir,
}));

const AGENT_ID = 'main';
const SESSIONS_DIR = join(testOpenClawConfigDir, 'agents', AGENT_ID, 'sessions');
const SESSIONS_JSON = join(SESSIONS_DIR, 'sessions.json');

function seedSessionsDir(): void {
  rmSync(testOpenClawConfigDir, { recursive: true, force: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

function writeSessionsJson(payload: Record<string, unknown>): void {
  writeFileSync(SESSIONS_JSON, JSON.stringify(payload, null, 2), 'utf8');
}

function makeReq(method = 'POST'): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

const DELETE_URL = new URL('http://127.0.0.1:13210/api/sessions/delete');
const ctx = {} as never;

describe('handleSessionRoutes — POST /api/sessions/delete', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    seedSessionsDir();
  });

  afterAll(() => {
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
  });

  it('hard-deletes the live <id>.jsonl and clears the entry from sessions.json', async () => {
    const sessionKey = 'agent:main:session-aaa';
    const fileName = 'aaa-uuid.jsonl';
    writeFileSync(join(SESSIONS_DIR, fileName), 'message\n', 'utf8');
    writeSessionsJson({
      [sessionKey]: { sessionFile: join(SESSIONS_DIR, fileName), sessionId: 'aaa-uuid' },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
    expect(existsSync(join(SESSIONS_DIR, fileName))).toBe(false);
    const updated = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'));
    expect(updated[sessionKey]).toBeUndefined();
  });

  it('also removes a leftover <id>.deleted.jsonl from a prior soft-delete release', async () => {
    const sessionKey = 'agent:main:session-bbb';
    const baseId = 'bbb-uuid';
    writeFileSync(join(SESSIONS_DIR, `${baseId}.jsonl`), '', 'utf8');
    writeFileSync(join(SESSIONS_DIR, `${baseId}.deleted.jsonl`), '', 'utf8');
    writeSessionsJson({
      [sessionKey]: { sessionFile: join(SESSIONS_DIR, `${baseId}.jsonl`), sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(join(SESSIONS_DIR, `${baseId}.jsonl`))).toBe(false);
    expect(existsSync(join(SESSIONS_DIR, `${baseId}.deleted.jsonl`))).toBe(false);
  });

  it('removes every <id>.jsonl.reset.* sibling that belongs to the same session id', async () => {
    const sessionKey = 'agent:main:session-ccc';
    const baseId = 'ccc-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    const reset1 = join(SESSIONS_DIR, `${baseId}.jsonl.reset.2026-04-01T00-00-00.000Z`);
    const reset2 = join(SESSIONS_DIR, `${baseId}.jsonl.reset.2026-04-02T00-00-00.000Z`);
    writeFileSync(liveFile, '', 'utf8');
    writeFileSync(reset1, '', 'utf8');
    writeFileSync(reset2, '', 'utf8');
    writeSessionsJson({
      [sessionKey]: { sessionFile: liveFile, sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(liveFile)).toBe(false);
    expect(existsSync(reset1)).toBe(false);
    expect(existsSync(reset2)).toBe(false);
  });

  it('still succeeds and updates sessions.json when the transcript is already gone', async () => {
    const sessionKey = 'agent:main:session-ddd';
    const baseId = 'ddd-uuid';
    // No transcript file on disk — only sessions.json knows about it.
    writeSessionsJson({
      [sessionKey]: { sessionFile: join(SESSIONS_DIR, `${baseId}.jsonl`), sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
    const updated = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'));
    expect(updated[sessionKey]).toBeUndefined();
  });

  it('rejects sessionKeys that are not agent-scoped with 400', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey: 'main' });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({ success: false }),
    );
  });

  it('does not touch other sessions in the same directory', async () => {
    const targetKey = 'agent:main:session-eee';
    const survivorKey = 'agent:main:session-fff';
    const targetBase = 'eee-uuid';
    const survivorBase = 'fff-uuid';
    const targetFile = join(SESSIONS_DIR, `${targetBase}.jsonl`);
    const survivorFile = join(SESSIONS_DIR, `${survivorBase}.jsonl`);
    writeFileSync(targetFile, '', 'utf8');
    writeFileSync(survivorFile, 'kept', 'utf8');
    writeSessionsJson({
      [targetKey]: { sessionFile: targetFile, sessionId: targetBase },
      [survivorKey]: { sessionFile: survivorFile, sessionId: survivorBase },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey: targetKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(targetFile)).toBe(false);
    expect(existsSync(survivorFile)).toBe(true);
    expect(readFileSync(survivorFile, 'utf8')).toBe('kept');
    const updated = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'));
    expect(updated[targetKey]).toBeUndefined();
    expect(updated[survivorKey]).toBeDefined();
  });

  it('also supports the array-shape sessions.json (sessions[] with id field)', async () => {
    const sessionKey = 'agent:main:session-ggg';
    const baseId = 'ggg-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    writeFileSync(liveFile, '', 'utf8');
    writeSessionsJson({
      sessions: [
        { key: sessionKey, id: baseId },
        { key: 'agent:main:keep', id: 'keep-uuid' },
      ],
    });
    writeFileSync(join(SESSIONS_DIR, 'keep-uuid.jsonl'), 'kept', 'utf8');
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(liveFile)).toBe(false);
    expect(existsSync(join(SESSIONS_DIR, 'keep-uuid.jsonl'))).toBe(true);
    const updated = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8')) as { sessions: Array<{ key: string }> };
    expect(updated.sessions.find((s) => s.key === sessionKey)).toBeUndefined();
    expect(updated.sessions.find((s) => s.key === 'agent:main:keep')).toBeDefined();
  });
});
