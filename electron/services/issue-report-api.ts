import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import JSZip from 'jszip';
import JSON5 from 'json5';
import type {
  IssueReportExportPayload,
  IssueReportExportResult,
} from '@shared/host-api/contract';
import { logger } from '../utils/logger';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from '../utils/paths';
import { resolveSessionTranscriptPath } from '../utils/session-files';

const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REDACTED = '[REDACTED]';

type IssueReportDependencies = {
  stateDir?: string;
  configPath?: string;
  clawxLogDir?: string | null;
  openClawLogDir?: string;
  outputDir?: string;
  now?: () => Date;
};

type IssueReportManifest = {
  formatVersion: 2;
  createdAt: string;
  sessionKeys: string[];
  skippedSessionKeys: string[];
  includedFiles: string[];
  missingFiles: string[];
  privacy: {
    openClawConfigRedacted: true;
    logsRedacted: true;
    transcriptRedacted: false;
  };
};

function isSensitiveConfigKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized.endsWith('apikey')
    || normalized.endsWith('secret')
    || normalized.endsWith('password')
    || normalized.endsWith('passwd')
    || normalized.endsWith('passphrase')
    || normalized.endsWith('credential')
    || normalized.endsWith('credentials')
    || normalized.endsWith('authorization')
    || normalized.endsWith('cookie')
    || normalized.endsWith('privatekey')
    || normalized === 'token'
    || /(?:access|refresh|auth|bearer|bot|gateway)token$/.test(normalized);
}

export function redactOpenClawConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOpenClawConfig);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    isSensitiveConfigKey(key) ? REDACTED : redactOpenClawConfig(child),
  ]));
}

export function redactDiagnosticText(content: string): string {
  return content
    .replace(
      /("(?:[a-z0-9_-]*api[_-]?key|token|[a-z0-9_-]*(?:access|refresh|auth|bearer|bot|gateway)token|[a-z0-9_-]*secret|[a-z0-9_-]*(?:password|passwd|passphrase|credential|credentials|authorization|cookie|private[_-]?key))"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      `$1"${REDACTED}"`,
    )
    // Authorization schemes carry the credential after the scheme. Redact the
    // complete header value rather than leaving Basic/Digest payloads behind.
    .replace(/(\b(?:proxy[-_])?authorization\s*[=:]\s*)[^\r\n]+/gi, `$1${REDACTED}`)
    .replace(/(\bBearer\s+)[^\s"',;]+/gi, `$1${REDACTED}`)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(
      /((?:[a-z0-9_.-]*api[_-]?key|token|(?:access|refresh|auth|bearer|bot|gateway)[_-]?token|[a-z0-9_.-]*(?:secret|password|passwd|passphrase|credential|credentials|cookie|private[_-]?key))\s*[=:]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}\]\r\n]+)/gi,
      `$1${REDACTED}`,
    );
}

function redactConfigText(content: string): string {
  try {
    return `${JSON.stringify(redactOpenClawConfig(JSON5.parse(content)), null, 2)}\n`;
  } catch {
    return redactDiagnosticText(content).replace(
      /("(?:[a-z0-9_-]*api[_-]?key|token|[a-z0-9_-]*(?:access|refresh|auth|bearer|bot|gateway)token|[a-z0-9_-]*secret|[a-z0-9_-]*(?:password|passwd|passphrase|credential|credentials|authorization|cookie|private[_-]?key))"\s*:\s*)("(?:\\.|[^"\\])*"|[^,}\r\n]+)/gi,
      `$1"${REDACTED}"`,
    );
  }
}

function parseSessionKey(sessionKey: unknown): { sessionKey: string; agentId: string } {
  if (typeof sessionKey !== 'string') throw new Error('A session key is required');
  const normalized = sessionKey.trim();
  const parts = normalized.split(':');
  const agentId = parts[1] ?? '';
  if (parts[0] !== 'agent' || parts.length < 3 || !SAFE_AGENT_ID.test(agentId)) {
    throw new Error('Invalid session key');
  }
  return { sessionKey: normalized, agentId };
}

function parseSessionKeys(sessionKeys: unknown): Array<{ sessionKey: string; agentId: string }> {
  if (!Array.isArray(sessionKeys)) {
    throw new Error('Session keys must be an array');
  }
  if (sessionKeys.length > 500) throw new Error('Too many sessions selected');
  const unique = new Map<string, { sessionKey: string; agentId: string }>();
  for (const sessionKey of sessionKeys) {
    const parsed = parseSessionKey(sessionKey);
    unique.set(parsed.sessionKey, parsed);
  }
  return [...unique.values()];
}

class TranscriptUnavailableError extends Error {}

const MAX_EVENT_UTF8_BYTES = 4 * 1024 * 1024;
const SAFE_ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;

type ExportTranscript = {
  sessionKey: string;
  agentId: string;
  archiveFileName: string;
  path?: string;
  bytes?: Buffer;
};

type TranscriptEventRow = {
  event_json?: unknown;
  event_zstd?: unknown;
  event_utf8_bytes?: unknown;
};

type TranscriptDatabase = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
  close: () => void;
};

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function archiveNameForSession(sessionId: string, index: number): string {
  return SAFE_ARCHIVE_ID.test(sessionId) ? `${sessionId}.jsonl` : `conversation-${index + 1}.jsonl`;
}

function canonicalizeJsonlLine(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('\n') && !trimmed.includes('\r')) return trimmed;
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function decodeTranscriptEvent(row: TranscriptEventRow): string | null {
  if (row.event_json != null) {
    const text = typeof row.event_json === 'string'
      ? row.event_json
      : row.event_json instanceof Uint8Array
        ? Buffer.from(row.event_json).toString('utf8')
        : null;
    if (text == null || Buffer.byteLength(text, 'utf8') > MAX_EVENT_UTF8_BYTES) return null;
    return canonicalizeJsonlLine(text);
  }

  const rawBytes = row.event_utf8_bytes;
  const compressed = row.event_zstd instanceof Uint8Array ? row.event_zstd : null;
  if (
    !compressed
    || typeof rawBytes !== 'number'
    || !Number.isSafeInteger(rawBytes)
    || rawBytes < 1
    || rawBytes > MAX_EVENT_UTF8_BYTES
    || compressed.byteLength === 0
    || compressed.byteLength > MAX_EVENT_UTF8_BYTES
    || typeof zstdDecompressSync !== 'function'
  ) {
    return null;
  }

  try {
    const decoded = zstdDecompressSync(compressed, { maxOutputLength: rawBytes });
    if (decoded.byteLength !== rawBytes) return null;
    return canonicalizeJsonlLine(decoded.toString('utf8'));
  } catch (error) {
    logger.warn(`[issue-report] Failed to decompress a transcript event: ${String(error)}`);
    return null;
  }
}

function tableColumns(db: TranscriptDatabase, table: string): Set<string> | null {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    const names = rows
      .map((row) => (typeof row.name === 'string' ? row.name : ''))
      .filter((name) => name.length > 0);
    return names.length > 0 ? new Set(names) : null;
  } catch {
    return null;
  }
}

function listTranscriptWindows(db: TranscriptDatabase, sessionKey: string): string[] {
  const windows: string[] = [];
  const seen = new Set<string>();
  const add = (sessionId: unknown) => {
    if (typeof sessionId !== 'string') return;
    const normalized = sessionId.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    windows.push(normalized);
  };

  const windowColumns = tableColumns(db, 'session_windows');
  if (windowColumns?.has('session_id') && windowColumns.has('session_key')) {
    const order = windowColumns.has('created_at')
      ? 'ORDER BY created_at ASC, session_id ASC'
      : 'ORDER BY session_id ASC';
    const rows = db.prepare(
      `SELECT session_id FROM session_windows WHERE session_key = ? ${order}`,
    ).all(sessionKey) as Array<{ session_id?: unknown }>;
    for (const row of rows) add(row.session_id);
  }

  const nodeColumns = tableColumns(db, 'session_nodes');
  if (nodeColumns?.has('session_key') && nodeColumns.has('current_session_id')) {
    const row = db.prepare(
      'SELECT current_session_id FROM session_nodes WHERE session_key = ?',
    ).get(sessionKey) as { current_session_id?: unknown } | undefined;
    add(row?.current_session_id);
  }

  return windows;
}

function readTranscriptLines(db: TranscriptDatabase, sessionId: string): string[] | null {
  const columns = tableColumns(db, 'transcript_events');
  if (!columns?.has('session_id') || !columns.has('seq')) return null;
  if (!columns.has('event_json') && !columns.has('event_zstd')) return null;

  const selected = ['seq'];
  if (columns.has('event_json')) selected.push('event_json');
  if (columns.has('event_zstd')) selected.push('event_zstd');
  if (columns.has('event_utf8_bytes')) selected.push('event_utf8_bytes');

  const rows = db.prepare(
    `SELECT ${selected.join(', ')} FROM transcript_events WHERE session_id = ? ORDER BY seq ASC`,
  ).all(sessionId) as TranscriptEventRow[];
  const lines: string[] = [];
  for (const row of rows) {
    const line = decodeTranscriptEvent(row);
    if (line == null) {
      logger.warn('[issue-report] Skipping a conversation because a transcript event could not be decoded');
      return null;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * OpenClaw 2026.10 stops writing sessions.json and stores the conversation in
 * agents/<agent>/agent/openclaw-agent.sqlite. Older installs still have a
 * JSONL file, which the caller prefers when it is present.
 */
class AgentTranscriptReader {
  private readonly databases = new Map<string, TranscriptDatabase | null>();

  constructor(private readonly stateDir: string) {}

  async read(
    agentId: string,
    sessionKey: string,
  ): Promise<Array<{ archiveFileName: string; bytes: Buffer }> | null> {
    try {
      const db = await this.open(agentId);
      if (!db) return null;
      const windows = listTranscriptWindows(db, sessionKey);
      if (windows.length === 0) return null;

      const parts: Array<{ archiveFileName: string; bytes: Buffer }> = [];
      for (const [index, sessionId] of windows.entries()) {
        const lines = readTranscriptLines(db, sessionId);
        if (lines == null) return null;
        if (lines.length === 0) continue;
        parts.push({
          archiveFileName: archiveNameForSession(sessionId, index),
          bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
        });
      }
      return parts.length > 0 ? parts : null;
    } catch (error) {
      logger.warn(`[issue-report] Failed to read SQLite transcript for ${sessionKey}: ${String(error)}`);
      return null;
    }
  }

  close(): void {
    for (const db of this.databases.values()) {
      try {
        db?.close();
      } catch {
        // The export already finished or the handle was already closed.
      }
    }
    this.databases.clear();
  }

  private async open(agentId: string): Promise<TranscriptDatabase | null> {
    if (this.databases.has(agentId)) return this.databases.get(agentId) ?? null;
    const dbPath = join(this.stateDir, 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
    try {
      await access(dbPath);
      const sqliteSpecifier = 'node:sqlite';
      const { DatabaseSync } = await import(/* @vite-ignore */ sqliteSpecifier);
      const db = new DatabaseSync(dbPath, { readOnly: true }) as TranscriptDatabase;
      this.databases.set(agentId, db);
      return db;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && !/unable to open|SQLITE_CANTOPEN/i.test(String(error))) {
        logger.warn(`[issue-report] Failed to open transcript database for ${agentId}: ${String(error)}`);
      }
      this.databases.set(agentId, null);
      return null;
    }
  }
}

async function resolveTranscriptFile(
  stateDir: string,
  sessionKey: string,
  agentId: string,
): Promise<string> {
  const sessionsDir = join(stateDir, 'agents', agentId, 'sessions');
  let sessionsJson: Record<string, unknown>;
  try {
    sessionsJson = JSON5.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    throw new TranscriptUnavailableError('The selected conversation transcript could not be found');
  }
  const resolution = resolveSessionTranscriptPath(sessionsJson, sessionsDir, sessionKey);
  if (!resolution.ok) {
    if (resolution.failure.kind === 'path-outside-scope') {
      throw new Error('The selected conversation transcript is outside its session directory');
    }
    throw new TranscriptUnavailableError('The selected conversation transcript could not be found');
  }

  let realSessionsDir: string;
  let realTranscript: string;
  try {
    [realSessionsDir, realTranscript] = await Promise.all([
      realpath(sessionsDir),
      realpath(resolution.resolvedSrcPath),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TranscriptUnavailableError('The selected conversation transcript could not be found');
    }
    throw error;
  }
  if (!isInside(realSessionsDir, realTranscript)) {
    throw new Error('The selected conversation transcript is outside its session directory');
  }
  const stat = await lstat(realTranscript);
  if (!stat.isFile()) throw new Error('The selected conversation transcript is not a file');
  return realTranscript;
}

async function loadSelectedTranscripts(
  stateDir: string,
  selected: { sessionKey: string; agentId: string },
  reader: AgentTranscriptReader,
): Promise<ExportTranscript[]> {
  try {
    const path = await resolveTranscriptFile(stateDir, selected.sessionKey, selected.agentId);
    return [{
      ...selected,
      archiveFileName: basename(path),
      path,
    }];
  } catch (error) {
    if (!(error instanceof TranscriptUnavailableError)) throw error;
  }

  const sqliteParts = await reader.read(selected.agentId, selected.sessionKey);
  if (!sqliteParts) {
    throw new TranscriptUnavailableError('The selected conversation transcript could not be found');
  }
  return sqliteParts.map((part) => ({
    ...selected,
    archiveFileName: part.archiveFileName,
    bytes: part.bytes,
  }));
}

async function addOptionalFile(
  zip: JSZip,
  sourcePath: string,
  archivePath: string,
  manifest: IssueReportManifest,
  transform?: (content: string) => string,
): Promise<void> {
  try {
    const stat = await lstat(sourcePath);
    if (!stat.isFile()) {
      manifest.missingFiles.push(archivePath);
      return;
    }
    const content = await readFile(sourcePath);
    zip.file(archivePath, transform ? transform(content.toString('utf8')) : content);
    manifest.includedFiles.push(archivePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[issue-report] Failed to add ${archivePath}: ${String(error)}`);
    }
    manifest.missingFiles.push(archivePath);
  }
}

async function addLogDirectory(
  zip: JSZip,
  sourceDir: string | null,
  archiveDir: string,
  manifest: IssueReportManifest,
): Promise<void> {
  if (!sourceDir) {
    manifest.missingFiles.push(`${archiveDir}/`);
    return;
  }

  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[issue-report] Failed to list ${archiveDir}: ${String(error)}`);
    }
    manifest.missingFiles.push(`${archiveDir}/`);
    return;
  }

  const logFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.log'))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (logFiles.length === 0) manifest.missingFiles.push(`${archiveDir}/`);
  for (const entry of logFiles) {
    await addOptionalFile(
      zip,
      join(sourceDir, entry.name),
      `${archiveDir}/${basename(entry.name)}`,
      manifest,
      redactDiagnosticText,
    );
  }
}

function archiveTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
}

async function uniqueArchivePath(outputDir: string, timestamp: string): Promise<string> {
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const name = `clawx-issue-report-${timestamp}${suffix === 0 ? '' : `-${suffix}`}.zip`;
    const candidate = join(outputDir, name);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Could not allocate an issue report filename');
}

async function defaultDesktopDir(): Promise<string> {
  const { app } = await import('electron');
  return app.getPath('desktop');
}

let exportQueue: Promise<void> = Promise.resolve();

async function exportIssueReportInternal(
  payload: IssueReportExportPayload,
  dependencies: IssueReportDependencies,
): Promise<IssueReportExportResult> {
  const selectedSessions = parseSessionKeys(payload?.sessionKeys);
  const stateDir = resolve(dependencies.stateDir ?? resolveOpenClawStateDir());
  const reader = new AgentTranscriptReader(stateDir);
  const transcripts: ExportTranscript[] = [];
  const skippedSessionKeys: string[] = [];
  try {
    for (const selected of selectedSessions) {
      try {
        transcripts.push(...await loadSelectedTranscripts(stateDir, selected, reader));
      } catch (error) {
        if (!(error instanceof TranscriptUnavailableError)) throw error;
        skippedSessionKeys.push(selected.sessionKey);
      }
    }
    const configPath = dependencies.configPath ?? resolveOpenClawConfigPath();
    const outputDir = resolve(dependencies.outputDir ?? await defaultDesktopDir());
    const now = dependencies.now?.() ?? new Date();
    const zip = new JSZip();
    const manifest: IssueReportManifest = {
      formatVersion: 2,
      createdAt: now.toISOString(),
      sessionKeys: [...new Set(transcripts.map(({ sessionKey }) => sessionKey))],
      skippedSessionKeys,
      includedFiles: [],
      missingFiles: [],
      privacy: {
        openClawConfigRedacted: true,
        logsRedacted: true,
        transcriptRedacted: false,
      },
    };

    const usedTranscriptPaths = new Set<string>();
    for (const transcript of transcripts) {
      const fileName = transcript.archiveFileName;
      let transcriptArchivePath = `conversations/${transcript.agentId}/${fileName}`;
      for (let suffix = 2; usedTranscriptPaths.has(transcriptArchivePath); suffix += 1) {
        const stem = fileName.toLowerCase().endsWith('.jsonl') ? fileName.slice(0, -6) : fileName;
        transcriptArchivePath = `conversations/${transcript.agentId}/${stem}-${suffix}.jsonl`;
      }
      usedTranscriptPaths.add(transcriptArchivePath);
      if (!transcript.bytes && !transcript.path) {
        throw new TranscriptUnavailableError('The selected conversation transcript could not be found');
      }
      const content = transcript.bytes ?? await readFile(transcript.path!);
      zip.file(transcriptArchivePath, content);
      manifest.includedFiles.push(transcriptArchivePath);
    }

    await addOptionalFile(zip, configPath, 'config/openclaw.json', manifest, redactConfigText);
    await addLogDirectory(zip, dependencies.clawxLogDir ?? logger.getLogDir(), 'logs/clawx', manifest);
    await addLogDirectory(
      zip,
      dependencies.openClawLogDir ?? join(stateDir, 'logs'),
      'logs/openclaw',
      manifest,
    );

    manifest.includedFiles.push('manifest.json');
    zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

    await mkdir(outputDir, { recursive: true });
    const archivePath = await uniqueArchivePath(outputDir, archiveTimestamp(now));
    const temporaryPath = `${archivePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      const archive = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        platform: 'UNIX',
      });
      await writeFile(temporaryPath, archive, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, archivePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    logger.info(
      `[issue-report] Exported archive with ${manifest.sessionKeys.length} conversation(s); skipped ${skippedSessionKeys.length}`,
    );
    return {
      success: true,
      path: archivePath,
      includedFiles: manifest.includedFiles,
      skippedSessionKeys,
    };
  } finally {
    reader.close();
  }
}

export function exportIssueReport(
  payload: IssueReportExportPayload,
  dependencies: IssueReportDependencies = {},
): Promise<IssueReportExportResult> {
  const task = exportQueue.then(() => exportIssueReportInternal(payload, dependencies));
  exportQueue = task.then(() => undefined, () => undefined);
  return task;
}
