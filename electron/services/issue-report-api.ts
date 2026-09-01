import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import JSON5 from 'json5';
import type {
  IssueReportExportPayload,
  IssueReportExportResult,
} from '@shared/host-api/contract';
import { logger } from '../utils/logger';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from '../utils/paths';
import { resolveSessionTranscriptPath } from '../utils/session-files';
import type { GatewayManager } from '../gateway/manager';

const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REDACTED = '[REDACTED]';

type IssueReportDependencies = {
  stateDir?: string;
  configPath?: string;
  clawxLogDir?: string | null;
  openClawLogDir?: string;
  outputDir?: string;
  now?: () => Date;
  gatewayManager?: Pick<GatewayManager, 'rpc'>;
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
  if (!Array.isArray(sessionKeys) || sessionKeys.length === 0) {
    throw new Error('At least one session key is required');
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

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function resolveTranscript(
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
  const transcripts: Array<{
    sessionKey: string;
    agentId: string;
    path?: string;
    content?: string;
  }> = [];
  const skippedSessionKeys: string[] = [];
  for (const selected of selectedSessions) {
    try {
      if (dependencies.gatewayManager) {
        try {
          const history = await dependencies.gatewayManager.rpc('chat.history', {
            sessionKey: selected.sessionKey,
            limit: 1_000,
          }) as { messages?: unknown };
          if (Array.isArray(history?.messages)) {
            transcripts.push({
              ...selected,
              content: history.messages.map((message) => JSON.stringify({
                type: 'message',
                timestamp: (
                  message && typeof message === 'object'
                    ? (message as Record<string, unknown>).timestamp
                    : undefined
                ) ?? new Date(0).toISOString(),
                message,
              })).join('\n') + '\n',
            });
            continue;
          }
        } catch {
          // Compatibility fallback for archived legacy transcripts.
        }
      }
      transcripts.push({
        ...selected,
        path: await resolveTranscript(stateDir, selected.sessionKey, selected.agentId),
      });
    } catch (error) {
      if (!(error instanceof TranscriptUnavailableError)) throw error;
      skippedSessionKeys.push(selected.sessionKey);
    }
  }
  if (transcripts.length === 0) {
    throw new Error('None of the selected conversation transcripts could be found');
  }
  const configPath = dependencies.configPath ?? resolveOpenClawConfigPath();
  const outputDir = resolve(dependencies.outputDir ?? await defaultDesktopDir());
  const now = dependencies.now?.() ?? new Date();
  const zip = new JSZip();
  const manifest: IssueReportManifest = {
    formatVersion: 2,
    createdAt: now.toISOString(),
    sessionKeys: transcripts.map(({ sessionKey }) => sessionKey),
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
    const fileName = transcript.path
      ? basename(transcript.path)
      : `${transcript.sessionKey.replace(/[^A-Za-z0-9_-]+/g, '-')}.jsonl`;
    let transcriptArchivePath = `conversations/${transcript.agentId}/${fileName}`;
    for (let suffix = 2; usedTranscriptPaths.has(transcriptArchivePath); suffix += 1) {
      const stem = fileName.toLowerCase().endsWith('.jsonl') ? fileName.slice(0, -6) : fileName;
      transcriptArchivePath = `conversations/${transcript.agentId}/${stem}-${suffix}.jsonl`;
    }
    usedTranscriptPaths.add(transcriptArchivePath);
    zip.file(
      transcriptArchivePath,
      transcript.content ?? await readFile(transcript.path!),
    );
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
    `[issue-report] Exported archive with ${transcripts.length} conversation(s); skipped ${skippedSessionKeys.length}`,
  );
  return {
    success: true,
    path: archivePath,
    includedFiles: manifest.includedFiles,
    skippedSessionKeys,
  };
}

export function exportIssueReport(
  payload: IssueReportExportPayload,
  dependencies: IssueReportDependencies = {},
): Promise<IssueReportExportResult> {
  const task = exportQueue.then(() => exportIssueReportInternal(payload, dependencies));
  exportQueue = task.then(() => undefined, () => undefined);
  return task;
}
