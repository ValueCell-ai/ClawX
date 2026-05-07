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

  it('rejects agentIds that contain path-traversal segments with 400', async () => {
    // Even if the caller manages to put `..` into the agent slot, the route
    // must refuse before any FS access happens — otherwise sessionsDir would
    // resolve outside ~/.openclaw/agents/.
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey: 'agent:..:foo' });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({ success: false }),
    );
  });

  it('refuses to unlink files when sessionFile points outside the agent sessions dir', async () => {
    // Defence-in-depth: if a corrupt sessions.json claims the transcript
    // lives in /tmp (or anywhere outside the agent sessions folder), the
    // sweep must not run there and existing files must survive untouched.
    const sessionKey = 'agent:main:session-escape';
    const escapeDir = join(testOpenClawConfigDir, 'unrelated-dir');
    mkdirSync(escapeDir, { recursive: true });
    const escapeFile = join(escapeDir, 'escape-uuid.jsonl');
    writeFileSync(escapeFile, 'must-not-be-deleted', 'utf8');
    writeSessionsJson({
      [sessionKey]: { sessionFile: escapeFile, sessionId: 'escape-uuid' },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({ success: false }),
    );
    expect(existsSync(escapeFile)).toBe(true);
    expect(readFileSync(escapeFile, 'utf8')).toBe('must-not-be-deleted');
    // sessions.json is left intact when the resolution fails — the entry
    // stays so a follow-up fix can be applied without losing track of it.
    const updated = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'));
    expect(updated[sessionKey]).toBeDefined();
  });

  it("also sweeps OpenClaw's trajectory sidecars (<id>.trajectory.jsonl + <id>.trajectory-path.json)", async () => {
    // OpenClaw writes `<base>.trajectory.jsonl` (flight recorder) and
    // `<base>.trajectory-path.json` (pointer) next to the session file.
    // Hard-deleting the conversation must leave neither behind, otherwise
    // the next `sessions.list` is clean but the agent's sessions/ folder
    // accumulates orphaned trajectory data.
    const sessionKey = 'agent:main:session-traj';
    const baseId = 'traj-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    const trajFile = join(SESSIONS_DIR, `${baseId}.trajectory.jsonl`);
    const pointerFile = join(SESSIONS_DIR, `${baseId}.trajectory-path.json`);
    writeFileSync(liveFile, '', 'utf8');
    writeFileSync(trajFile, '{"event":"session.started"}\n', 'utf8');
    writeFileSync(
      pointerFile,
      JSON.stringify({
        traceSchema: 'openclaw-trajectory-pointer',
        schemaVersion: 1,
        sessionId: baseId,
        runtimeFile: trajFile,
      }),
      'utf8',
    );
    writeSessionsJson({
      [sessionKey]: { sessionFile: liveFile, sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(liveFile)).toBe(false);
    expect(existsSync(trajFile)).toBe(false);
    expect(existsSync(pointerFile)).toBe(false);
  });

  it('follows the trajectory pointer to unlink an OPENCLAW_TRAJECTORY_DIR-style off-sessions runtime file', async () => {
    // When OPENCLAW_TRAJECTORY_DIR is set, the pointer's `runtimeFile`
    // resolves outside sessions/. Without the pointer-follow, that file
    // would be orphaned forever after deletion.
    const sessionKey = 'agent:main:session-trajdir';
    const baseId = 'trajdir-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    const pointerFile = join(SESSIONS_DIR, `${baseId}.trajectory-path.json`);
    const trajectoryDir = join(testOpenClawConfigDir, 'trajectory-dir');
    mkdirSync(trajectoryDir, { recursive: true });
    const offDiskRuntime = join(trajectoryDir, `${baseId}.jsonl`);
    writeFileSync(liveFile, '', 'utf8');
    writeFileSync(offDiskRuntime, '{"event":"prompt.submitted"}\n', 'utf8');
    writeFileSync(
      pointerFile,
      JSON.stringify({
        traceSchema: 'openclaw-trajectory-pointer',
        schemaVersion: 1,
        sessionId: baseId,
        runtimeFile: offDiskRuntime,
      }),
      'utf8',
    );
    writeSessionsJson({
      [sessionKey]: { sessionFile: liveFile, sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(liveFile)).toBe(false);
    expect(existsSync(pointerFile)).toBe(false);
    expect(existsSync(offDiskRuntime)).toBe(false);
  });

  it('refuses to follow a pointer whose runtimeFile is not an absolute .jsonl path', async () => {
    // Defence-in-depth: a malformed/hostile pointer must NOT get us to
    // unlink arbitrary files (e.g. /etc/passwd or relative paths).
    const sessionKey = 'agent:main:session-evilpointer';
    const baseId = 'evilpointer-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    const pointerFile = join(SESSIONS_DIR, `${baseId}.trajectory-path.json`);
    const bystander = join(testOpenClawConfigDir, 'bystander-dir', 'must-not-touch.txt');
    mkdirSync(join(testOpenClawConfigDir, 'bystander-dir'), { recursive: true });
    writeFileSync(bystander, 'kept', 'utf8');
    writeFileSync(liveFile, '', 'utf8');
    writeFileSync(
      pointerFile,
      JSON.stringify({
        traceSchema: 'openclaw-trajectory-pointer',
        schemaVersion: 1,
        sessionId: baseId,
        // Wrong extension on purpose — not a `.jsonl`.
        runtimeFile: bystander,
      }),
      'utf8',
    );
    writeSessionsJson({
      [sessionKey]: { sessionFile: liveFile, sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    // The session and the (correctly-detected) pointer are gone, but the
    // bystander file the pointer tried to escape to is untouched.
    expect(existsSync(liveFile)).toBe(false);
    expect(existsSync(pointerFile)).toBe(false);
    expect(existsSync(bystander)).toBe(true);
    expect(readFileSync(bystander, 'utf8')).toBe('kept');
  });

  it("tolerates a malformed pointer (still cleans local sidecars, doesn't fail the whole delete)", async () => {
    const sessionKey = 'agent:main:session-malformedptr';
    const baseId = 'malformedptr-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    const trajFile = join(SESSIONS_DIR, `${baseId}.trajectory.jsonl`);
    const pointerFile = join(SESSIONS_DIR, `${baseId}.trajectory-path.json`);
    writeFileSync(liveFile, '', 'utf8');
    writeFileSync(trajFile, '', 'utf8');
    // Garbage JSON — the sweep must not blow up.
    writeFileSync(pointerFile, '{ not-json', 'utf8');
    writeSessionsJson({
      [sessionKey]: { sessionFile: liveFile, sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
    expect(existsSync(liveFile)).toBe(false);
    expect(existsSync(trajFile)).toBe(false);
    expect(existsSync(pointerFile)).toBe(false);
  });

  it("does not touch another session's trajectory sidecars during the sweep", async () => {
    const targetKey = 'agent:main:session-trajiso-target';
    const survivorKey = 'agent:main:session-trajiso-keep';
    const targetBase = 'trajiso-target';
    const survivorBase = 'trajiso-keep';
    const targetFile = join(SESSIONS_DIR, `${targetBase}.jsonl`);
    const targetTraj = join(SESSIONS_DIR, `${targetBase}.trajectory.jsonl`);
    const survivorFile = join(SESSIONS_DIR, `${survivorBase}.jsonl`);
    const survivorTraj = join(SESSIONS_DIR, `${survivorBase}.trajectory.jsonl`);
    const survivorPointer = join(SESSIONS_DIR, `${survivorBase}.trajectory-path.json`);
    writeFileSync(targetFile, '', 'utf8');
    writeFileSync(targetTraj, '', 'utf8');
    writeFileSync(survivorFile, 'kept', 'utf8');
    writeFileSync(survivorTraj, 'kept', 'utf8');
    writeFileSync(survivorPointer, JSON.stringify({
      traceSchema: 'openclaw-trajectory-pointer',
      schemaVersion: 1,
      sessionId: survivorBase,
      runtimeFile: survivorTraj,
    }), 'utf8');
    writeSessionsJson({
      [targetKey]: { sessionFile: targetFile, sessionId: targetBase },
      [survivorKey]: { sessionFile: survivorFile, sessionId: survivorBase },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey: targetKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(existsSync(targetFile)).toBe(false);
    expect(existsSync(targetTraj)).toBe(false);
    expect(existsSync(survivorFile)).toBe(true);
    expect(existsSync(survivorTraj)).toBe(true);
    expect(existsSync(survivorPointer)).toBe(true);
  });

  it('treats Windows forward-slash absolute paths as absolute (cross-platform)', async () => {
    // OpenClaw on Windows can write `sessionFile` as either `C:\…` (back-
    // slash) or `C:/…` (forward-slash). Node's `path.win32.isAbsolute`
    // accepts both; the resolver must too. We can't actually create a
    // `C:/…` path on POSIX, so we cover the same code path with a Windows-
    // style absolute that points back into our temp sessions dir using
    // mixed slashes. The detector should still treat it as absolute and
    // route through the in-scope sibling sweep.
    const sessionKey = 'agent:main:session-win';
    const baseId = 'win-uuid';
    const liveFile = join(SESSIONS_DIR, `${baseId}.jsonl`);
    writeFileSync(liveFile, '', 'utf8');
    // Force forward slashes — historically this would have been classed as
    // a *relative* filename on POSIX and `join`ed onto sessionsDir, which
    // produced a junk path that no `readdir` could find.
    const forwardSlashAbs = liveFile.replace(/\\/g, '/');
    writeSessionsJson({
      [sessionKey]: { sessionFile: forwardSlashAbs, sessionId: baseId },
    });
    parseJsonBodyMock.mockResolvedValueOnce({ sessionKey });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    await handleSessionRoutes(makeReq(), makeRes(), DELETE_URL, ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
    expect(existsSync(liveFile)).toBe(false);
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
