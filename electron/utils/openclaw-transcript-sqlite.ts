import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { resolveOpenClawStateDir } from './paths';
import type { RawMessage } from '@shared/chat/types';

export type SqliteTranscriptRecord = {
  sessionId?: string;
  id?: string;
  type?: string;
  timestamp?: unknown;
  message?: RawMessage;
};

type SqliteDb = {
  prepare: (sql: string) => { all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown };
};

function decodeRow(row: Record<string, unknown>): SqliteTranscriptRecord | null {
  let raw: string | null = typeof row.event_json === 'string' ? row.event_json : null;
  if (!raw && row.event_json instanceof Uint8Array) raw = Buffer.from(row.event_json).toString('utf8');
  if (!raw && row.event_zstd instanceof Uint8Array) {
    try { raw = zstdDecompressSync(row.event_zstd).toString('utf8'); } catch { return null; }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof row.session_id === 'string' ? { sessionId: row.session_id } : {}),
      ...(typeof parsed.id === 'string' ? { id: parsed.id } : {}),
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      timestamp: parsed.timestamp,
      message: parsed.message && typeof parsed.message === 'object' ? parsed.message as RawMessage : undefined,
    };
  } catch { return null; }
}

export function readSqliteTranscriptRecords(db: SqliteDb, sessionKey: string): SqliteTranscriptRecord[] {
  const node = db.prepare('SELECT current_session_id FROM session_nodes WHERE session_key = ?').get(sessionKey) as { current_session_id?: unknown } | undefined;
  const sessionIds = new Set<string>();
  if (typeof node?.current_session_id === 'string') sessionIds.add(node.current_session_id);
  try {
    const windows = db.prepare('SELECT session_id FROM session_windows WHERE session_key = ? ORDER BY created_at ASC, session_id ASC').all(sessionKey) as Array<{ session_id?: unknown }>;
    for (const row of windows) if (typeof row.session_id === 'string') sessionIds.add(row.session_id);
  } catch { /* old migration fixture without session_windows */ }
  if (sessionIds.size === 0) return [];
  const records: SqliteTranscriptRecord[] = [];
  for (const sessionId of sessionIds) {
    const archiveRows = (() => {
      try {
        return db.prepare('SELECT archive_blob, encoding FROM session_transcript_archives WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Array<{ archive_blob?: unknown; encoding?: unknown }>;
      } catch { return []; }
    })();
    const coldRows = (() => {
      try {
        return db.prepare('SELECT archive_blob, archive_name FROM session_transcript_cold_archives WHERE session_id = ? ORDER BY archived_at ASC').all(sessionId) as Array<{ archive_blob?: unknown; archive_name?: unknown }>;
      } catch { return []; }
    })();
    for (const archive of [...archiveRows, ...coldRows]) {
      if (!(archive.archive_blob instanceof Uint8Array)) continue;
      try {
        const compressed = archive.encoding === 'zstd' || (typeof archive.archive_name === 'string' && archive.archive_name.endsWith('.zst'));
        const text = (compressed ? zstdDecompressSync(archive.archive_blob) : Buffer.from(archive.archive_blob)).toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const record = decodeRow({ event_json: line, session_id: sessionId });
          if (record?.message) records.push(record);
        }
      } catch { /* corrupt cold rows are skipped; hot rows remain readable */ }
    }
    const columns = (db.prepare('PRAGMA table_info(transcript_events)').all() as Array<{ name?: unknown }>)
      .map(row => row.name).filter((name): name is string => typeof name === 'string');
    const selected = ['event_json', ...(columns.includes('event_zstd') ? ['event_zstd'] : [])];
    const rows = db.prepare(
      `SELECT session_id, ${selected.join(', ')} FROM transcript_events WHERE session_id = ? ORDER BY seq ASC`,
    ).all(sessionId) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const record = decodeRow(row);
      if (record?.message) records.push(record);
    }
  }
  return records;
}

export function readSqliteSessionEntries(db: SqliteDb): Array<{ sessionKey: string; entry: Record<string, unknown> }> {
  try {
    const rows = db.prepare('SELECT session_key, entry_json FROM session_nodes').all() as Array<{ session_key?: unknown; entry_json?: unknown }>;
    return rows.flatMap(row => {
      if (typeof row.session_key !== 'string' || typeof row.entry_json !== 'string') return [];
      try {
        const entry = JSON.parse(row.entry_json) as unknown;
        return entry && typeof entry === 'object' ? [{ sessionKey: row.session_key, entry: entry as Record<string, unknown> }] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

export async function readSqliteSessionEntriesForAgent(agentId: string): Promise<Array<{ sessionKey: string; entry: Record<string, unknown> }> | null> {
  const path = join(resolveOpenClawStateDir(), 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
  try { await access(path); } catch { return null; }
  try {
    const { DatabaseSync } = await import(/* @vite-ignore */ 'node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true }) as unknown as SqliteDb & { close: () => void };
    try { return readSqliteSessionEntries(db); } finally { db.close(); }
  } catch { return null; }
}

export async function readSqliteTranscriptRecordsForAgent(agentId: string, sessionKey: string): Promise<SqliteTranscriptRecord[] | null> {
  const path = join(resolveOpenClawStateDir(), 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
  try { await access(path); } catch { return null; }
  try {
    const { DatabaseSync } = await import(/* @vite-ignore */ 'node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true }) as unknown as SqliteDb & { close: () => void };
    try {
      const records = readSqliteTranscriptRecords(db, sessionKey);
      return records.length > 0 ? records : null;
    } finally { db.close(); }
  } catch { return null; }
}
