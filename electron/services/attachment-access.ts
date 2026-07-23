import { shell as electronShell } from 'electron';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AttachmentAccessError,
  AttachmentFileRef,
  AttachmentOpenHandlersResult,
  AttachmentSourceRef,
  OpenAttachmentResult,
  OpenAttachmentWithPayload,
  ReadAttachmentBinaryPayload,
  ReadAttachmentBinaryResult,
  ReadAttachmentTextResult,
  ResolveAttachmentPayload,
  ResolveAttachmentResult,
} from '@shared/host-api/contract';
import {
  FILE_PREVIEW_MAX_BINARY_BYTES,
  FILE_PREVIEW_MAX_TEXT_BYTES,
} from '@shared/file-preview/limits';
import type { AcpSessionAccessRegistry } from './acp-session-access-registry';
import { recordAttachmentOpenTrace } from './acp-trace';
import {
  HANDLER_ID_MAX_LENGTH,
  type AttachmentOpenWithService,
} from './attachment-open-with';
import {
  expandPath,
  resolveOpenClawConfigDir,
  resolveOpenClawStateDir,
} from '../utils/paths';

const MAX_REFERENCE_LENGTH = 4096;
const MAX_DISPLAY_NAME_LENGTH = 160;
const MAX_OUTGOING_RECORD_BYTES = 64 * 1024;
const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9._-]+$/;

const EXT_MIME_MAP: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

type AttachmentFs = {
  lstat: (path: string) => Promise<Stats>;
  open: (path: string, flags: number) => Promise<FileHandle>;
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<Stats>;
};

type AttachmentShell = {
  openPath: (path: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (path: string) => void;
};

export type AttachmentAccess = {
  resolveAttachment: (payload: ResolveAttachmentPayload) => Promise<ResolveAttachmentResult>;
  readAttachmentText: (ref: AttachmentFileRef) => Promise<ReadAttachmentTextResult>;
  readAttachmentBinary: (payload: ReadAttachmentBinaryPayload) => Promise<ReadAttachmentBinaryResult>;
  openAttachment: (ref: AttachmentSourceRef) => Promise<OpenAttachmentResult>;
  listAttachmentOpenHandlers: (ref: AttachmentFileRef) => Promise<AttachmentOpenHandlersResult>;
  openAttachmentWith: (payload: OpenAttachmentWithPayload) => Promise<OpenAttachmentResult>;
  revealAttachment: (ref: AttachmentFileRef) => Promise<OpenAttachmentResult>;
};

type AttachmentAccessDependencies = {
  sessionAccessRegistry: AcpSessionAccessRegistry;
  stagedAttachments: StagedAttachmentRegistry;
  stateDir?: string;
  configDir?: string;
  fs?: AttachmentFs;
  shell?: AttachmentShell;
  openWith: AttachmentOpenWithService;
};

type LocalScope = 'workspace' | 'openclaw-media' | 'staging';

type ResolvedLocal = {
  kind: 'local';
  canonicalPath: string;
  scope: LocalScope;
  mimeType: string;
  size: number;
  authorizationRoot?: string;
};

type ResolvedRemote = {
  kind: 'remote';
  normalizedUrl: string;
  mimeType: string;
  size: number;
};

type ResolvedTarget = ResolvedLocal | ResolvedRemote;

type PinnedDirectory = {
  canonicalPath: string;
  dev: number;
  ino: number;
};

type ManagedAuthoritySlot = {
  lexicalParent: string;
  parent?: PinnedDirectory;
  media?: PinnedDirectory;
  pinning?: Promise<void>;
  mediaPinning?: Promise<void>;
};

class AttachmentFailure extends Error {
  constructor(readonly code: AttachmentAccessError) {
    super(code);
  }
}

export class StagedAttachmentRegistry {
  private readonly files = new Map<string, { canonicalPath: string; displayPath?: string }>();

  register(id: string, canonicalPath: string, displayPath?: string): void {
    if (id && canonicalPath) this.files.set(id, {
      canonicalPath,
      ...(displayPath ? { displayPath } : {}),
    });
  }

  get(id: string): string | null {
    return this.files.get(id)?.canonicalPath ?? null;
  }

  getDisplayPath(id: string): string | null {
    return this.files.get(id)?.displayPath ?? null;
  }

  hasPath(canonicalPath: string): boolean {
    return Array.from(this.files.values()).some((file) => isSamePath(file.canonicalPath, canonicalPath));
  }
}

export function resolveClawXStagingDir(stateDir = resolveOpenClawStateDir()): string {
  return join(resolve(stateDir), 'media', 'outbound', 'clawx-staging');
}

function attachmentFailure(error: unknown): AttachmentAccessError {
  if (error instanceof AttachmentFailure) return error.code;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return 'unavailable';
  return 'operationFailed';
}

function opaqueIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeDisplayName(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim() ? value : fallback;
  const filename = posix.basename(raw.replace(/\\/gu, '/'));
  const withoutControls = Array.from(filename.slice(0, MAX_DISPLAY_NAME_LENGTH * 4), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    const isBidiFormatting = codePoint === 0x061c
      || codePoint === 0x200e
      || codePoint === 0x200f
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
    return isControl || isBidiFormatting ? ' ' : character;
  }).join('');
  const cleaned = withoutControls
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned || 'attachment';
}

function decodedBasename(uri: string): string {
  try {
    if (/^https?:/i.test(uri)) {
      const url = new URL(uri);
      return decodeURIComponent(posix.basename(url.pathname)) || url.hostname;
    }
    if (/^file:/i.test(uri)) return basename(fileURLToPath(uri));
  } catch {
    // A safe generic label is returned below for malformed input.
  }
  return basename(uri.replace(/[?#].*$/u, '')) || 'attachment';
}

function mimeTypeForPath(path: string): string {
  return EXT_MIME_MAP[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]+/u).includes('..');
}

function validateReferenceSyntax(uri: unknown): asserts uri is string {
  if (typeof uri !== 'string' || !uri.trim() || uri.length > MAX_REFERENCE_LENGTH || uri.includes('\0')) {
    throw new AttachmentFailure('invalidReference');
  }
  if (uri.startsWith('\\\\') || uri.startsWith('//')) throw new AttachmentFailure('invalidReference');
  if (hasTraversal(uri)) throw new AttachmentFailure('invalidReference');
  if (uri.includes('%')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(uri);
    } catch {
      throw new AttachmentFailure('invalidReference');
    }
    if (decoded.includes('\0') || hasTraversal(decoded)) throw new AttachmentFailure('invalidReference');
  }
}

function isInside(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === ''
    || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function isSamePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function localPathFromUri(uri: string, executionCwd: string): string {
  if (/^file:/i.test(uri)) {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new AttachmentFailure('invalidReference');
    }
    if (url.username || url.password || (url.hostname && url.hostname.toLowerCase() !== 'localhost')) {
      throw new AttachmentFailure('invalidReference');
    }
    try {
      return fileURLToPath(url);
    } catch {
      throw new AttachmentFailure('invalidReference');
    }
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri) && !win32.isAbsolute(uri)) {
    throw new AttachmentFailure('invalidReference');
  }
  if (uri.startsWith('~')) return resolve(expandPath(uri));
  if (isAbsolute(uri) || win32.isAbsolute(uri)) return resolve(uri);
  return resolve(executionCwd, uri);
}

function parseOutgoingUrl(uri: string): { attachmentId: string; sessionKey: string } | null {
  let url: URL;
  try {
    url = uri.startsWith('/') ? new URL(uri, 'http://clawx.local') : new URL(uri);
  } catch {
    return null;
  }
  const isRelativeGatewayUrl = uri.startsWith('/');
  const isLocalGatewayUrl = (url.protocol === 'http:' || url.protocol === 'https:')
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (!isRelativeGatewayUrl && !isLocalGatewayUrl) return null;
  if (url.username || url.password) throw new AttachmentFailure('unsafeUrl');
  const segments = url.pathname.split('/');
  if (segments.length !== 8
    || segments[1] !== 'api'
    || segments[2] !== 'chat'
    || segments[3] !== 'media'
    || segments[4] !== 'outgoing'
    || segments[7] !== 'full') {
    return null;
  }
  let sessionKey: string;
  let attachmentId: string;
  try {
    sessionKey = decodeURIComponent(segments[5]);
    attachmentId = decodeURIComponent(segments[6]);
  } catch {
    throw new AttachmentFailure('invalidReference');
  }
  if (!sessionKey || !SAFE_ATTACHMENT_ID.test(attachmentId)) {
    throw new AttachmentFailure('invalidReference');
  }
  return { attachmentId, sessionKey };
}

async function canonicalManagedMediaRoots(
  stateDir: string,
  configDir: string,
  fs: AttachmentFs,
): Promise<string[]> {
  // OpenClaw 2026.6.10 exposes only resolveStateDir()/media and resolveConfigDir()/media.
  // Keep this list exact until the distributed runtime adds a real media-root setting.
  const managedRoots = await Promise.all([stateDir, configDir].map(async (parentPath) => {
    try {
      const parent = await fs.realpath(parentPath);
      if (!(await fs.stat(parent)).isDirectory()) return null;
      const mediaPath = join(parentPath, 'media');
      if ((await fs.lstat(mediaPath)).isSymbolicLink()) return null;
      const media = await fs.realpath(mediaPath);
      return (await fs.stat(media)).isDirectory() && isInside(media, parent) ? media : null;
    } catch {
      return null;
    }
  }));
  return Array.from(new Set([
    ...managedRoots.filter((root): root is string => root !== null),
  ]));
}

function pinnedDirectory(path: string, stat: Stats): PinnedDirectory {
  return { canonicalPath: path, dev: stat.dev, ino: stat.ino };
}

async function ensureManagedAuthority(
  slot: ManagedAuthoritySlot,
  fs: AttachmentFs,
): Promise<{ parent: PinnedDirectory; media: PinnedDirectory | null } | null> {
  if (!slot.parent) {
    if (!slot.pinning) {
      slot.pinning = (async () => {
        try {
          const parentPath = await fs.realpath(slot.lexicalParent);
          const parentStat = await fs.stat(parentPath);
          if (!parentStat.isDirectory()) return;
          slot.parent = pinnedDirectory(parentPath, parentStat);
        } catch {
          // A configured parent that does not exist yet is retried on a later operation.
        }
      })().finally(() => {
        slot.pinning = undefined;
      });
    }
    await slot.pinning;
  }
  if (!slot.parent) return null;

  const mediaPath = join(slot.lexicalParent, 'media');
  if (!slot.media) {
    if (!slot.mediaPinning) {
      slot.mediaPinning = (async () => {
        try {
          if ((await fs.lstat(mediaPath)).isSymbolicLink()) return;
          const canonicalMedia = await fs.realpath(mediaPath);
          const mediaStat = await fs.stat(canonicalMedia);
          if (!mediaStat.isDirectory() || !isInside(canonicalMedia, slot.parent!.canonicalPath)) return;
          slot.media = pinnedDirectory(canonicalMedia, mediaStat);
        } catch {
          // Media dir not available yet.
        }
      })().finally(() => {
        slot.mediaPinning = undefined;
      });
    }
    try {
      await slot.mediaPinning;
    } catch {
      return { parent: slot.parent, media: null };
    }
  }
  return { parent: slot.parent, media: slot.media ?? null };
}

async function frozenCanonicalDirectory(path: string, fs: AttachmentFs): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch {
    return path;
  }
}

async function readOpenedFile(handle: FileHandle, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const length = Math.min(64 * 1024, maxBytes + 1 - total);
    const chunk = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(chunk, 0, length, total);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  return total > maxBytes ? null : Buffer.concat(chunks, total);
}

function looksLikeBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8192);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

async function openRevalidatedLocal(local: ResolvedLocal, fs: AttachmentFs): Promise<{
  handle: FileHandle;
  stat: Stats;
}> {
  let handle: FileHandle | undefined;
  try {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    handle = await fs.open(local.canonicalPath, constants.O_RDONLY | noFollow);
    const handleStat = await handle.stat();
    if (!handleStat.isFile()) {
      throw new AttachmentFailure('notFile');
    }
    return { handle, stat: handleStat };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw error;
  }
}

function normalizeRemote(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new AttachmentFailure('unsafeUrl');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
    throw new AttachmentFailure('unsafeUrl');
  }
  return url.href;
}

function boundedBinaryCap(value: unknown): number {
  const requested = typeof value === 'number' && Number.isFinite(value) ? value : FILE_PREVIEW_MAX_BINARY_BYTES;
  return Math.max(1, Math.min(requested, FILE_PREVIEW_MAX_BINARY_BYTES));
}

export async function resolveOutgoingMediaAttachment(input: {
  uri: string;
  expectedSessionKey?: string;
  transcriptMessageId?: string;
  stateDir?: string;
  configDir?: string;
  managedMediaRoots?: string[];
  fs?: AttachmentFs;
}): Promise<{ path: string; mimeType: string; size: number; authorizationRoot: string } | null> {
  try {
    validateReferenceSyntax(input.uri);
    const outgoing = parseOutgoingUrl(input.uri);
    if (!outgoing || (input.expectedSessionKey && outgoing.sessionKey !== input.expectedSessionKey)) return null;
    const fs = input.fs ?? await import('node:fs/promises');
    const stateDir = resolve(input.stateDir ?? resolveOpenClawStateDir());
    const configDir = resolve(input.configDir ?? resolveOpenClawConfigDir());
    const recordPath = join(stateDir, 'media', 'outgoing', 'records', `${outgoing.attachmentId}.json`);
    let handle: FileHandle | undefined;
    let raw: Buffer | null;
    try {
      const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
      handle = await fs.open(recordPath, constants.O_RDONLY | noFollow);
      if (!(await handle.stat()).isFile()) return null;
      raw = await readOpenedFile(handle, MAX_OUTGOING_RECORD_BYTES);
    } finally {
      await handle?.close().catch(() => undefined);
    }
    if (!raw) return null;

    const record = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    const original = record.original && typeof record.original === 'object'
      ? record.original as Record<string, unknown>
      : null;
    const recordId = typeof record.attachmentId === 'string' ? record.attachmentId : undefined;
    if (recordId !== outgoing.attachmentId
      || record.sessionKey !== outgoing.sessionKey
      || (input.transcriptMessageId && typeof record.messageId === 'string'
        && record.messageId !== input.transcriptMessageId)
      || !original
      || typeof original.path !== 'string') {
      return null;
    }
    validateReferenceSyntax(original.path);
    const originalPath = localPathFromUri(original.path, stateDir);
    const roots = input.managedMediaRoots ?? await canonicalManagedMediaRoots(stateDir, configDir, fs);
    const canonicalPath = await fs.realpath(originalPath);
    const authorizationRoot = roots.find((root) => isInside(canonicalPath, root));
    if (!authorizationRoot) return null;
    const fileStat = await fs.stat(canonicalPath);
    if (!fileStat.isFile()) return null;
    return {
      path: canonicalPath,
      mimeType: typeof original.contentType === 'string' && original.contentType
        ? original.contentType
        : mimeTypeForPath(canonicalPath),
      size: fileStat.size,
      authorizationRoot,
    };
  } catch {
    return null;
  }
}

export function createAttachmentAccess(dependencies: AttachmentAccessDependencies): AttachmentAccess {
  const stateDir = resolve(dependencies.stateDir ?? resolveOpenClawStateDir());
  const configDir = resolve(dependencies.configDir ?? resolveOpenClawConfigDir());
  const shell = dependencies.shell ?? electronShell;
  const getFs = async (): Promise<AttachmentFs> => dependencies.fs ?? await import('node:fs/promises');
  const stateAuthority: ManagedAuthoritySlot = { lexicalParent: stateDir };
  const configAuthority: ManagedAuthoritySlot = { lexicalParent: configDir };
  const initializeAuthorities = async () => {
    const fs = await getFs();
    await Promise.all([
      ensureManagedAuthority(stateAuthority, fs),
      ensureManagedAuthority(configAuthority, fs),
    ]);
  };
  void initializeAuthorities().catch(() => undefined);

  const verifyManagedAuthorities = async (fs: AttachmentFs) => {
    const [state, config] = await Promise.all([
      ensureManagedAuthority(stateAuthority, fs),
      ensureManagedAuthority(configAuthority, fs),
    ]);
    return {
      stateParent: state?.parent ?? null,
      mediaRoots: Array.from(new Set([
        ...(state?.media ? [state.media.canonicalPath] : []),
        ...(config?.media ? [config.media.canonicalPath] : []),
      ])),
    };
  };

  const resolveLocalCandidate = async (
    ref: AttachmentSourceRef,
    candidateInput: string,
    mimeTypeHint?: string,
    mediaOnly = false,
  ): Promise<ResolvedLocal> => {
    const context = dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation);
    if (!context) throw new AttachmentFailure('staleSession');
    const fs = await getFs();
    const candidate = resolve(candidateInput);

    if (ref.stagingId) {
      const stagedPath = dependencies.stagedAttachments.get(ref.stagingId);
      if (stagedPath) {
        let canonicalCandidate: string;
        try {
          canonicalCandidate = await fs.realpath(candidate);
        } catch (error) {
          throw new AttachmentFailure(attachmentFailure(error));
        }
        if (!isSamePath(canonicalCandidate, stagedPath)) throw new AttachmentFailure('invalidReference');
        const stagedStat = await fs.stat(canonicalCandidate);
        if (!stagedStat.isFile()) throw new AttachmentFailure('notFile');
        return {
          kind: 'local',
          canonicalPath: canonicalCandidate,
          scope: 'staging',
          mimeType: mimeTypeHint || mimeTypeForPath(canonicalCandidate),
          size: stagedStat.size,
        };
      }
    }

    let canonicalCandidate: string;
    try {
      canonicalCandidate = await fs.realpath(candidate);
    } catch (error) {
      throw new AttachmentFailure(attachmentFailure(error));
    }
    const targetStat = await fs.stat(canonicalCandidate);
    if (!targetStat.isFile()) throw new AttachmentFailure('notFile');

    const workspaceRoot = mediaOnly ? null : await frozenCanonicalDirectory(context.workspaceRoot, fs);
    const scope: LocalScope = workspaceRoot && isInside(canonicalCandidate, workspaceRoot)
      ? 'workspace'
      : 'openclaw-media';

    return {
      kind: 'local',
      canonicalPath: canonicalCandidate,
      scope,
      mimeType: mimeTypeHint || mimeTypeForPath(canonicalCandidate),
      size: targetStat.size,
    };
  };

  const resolveOutgoing = async (
    ref: AttachmentSourceRef,
    outgoing: { attachmentId: string; sessionKey: string },
  ): Promise<ResolvedLocal> => {
    if (outgoing.sessionKey !== ref.sessionKey) throw new AttachmentFailure('invalidReference');
    const fs = await getFs();
    const { mediaRoots } = await verifyManagedAuthorities(fs);
    const resolved = await resolveOutgoingMediaAttachment({
      uri: ref.uri,
      expectedSessionKey: ref.sessionKey,
      transcriptMessageId: ref.transcriptMessageId,
      stateDir,
      configDir,
      managedMediaRoots: mediaRoots,
      fs,
    });
    if (!resolved) throw new AttachmentFailure('invalidReference');
    return {
      kind: 'local',
      canonicalPath: resolved.path,
      scope: 'openclaw-media',
      mimeType: resolved.mimeType,
      size: resolved.size,
      authorizationRoot: resolved.authorizationRoot,
    };
  };

  const resolveTarget = async (
    ref: AttachmentSourceRef,
    metadata: Pick<ResolveAttachmentPayload, 'mimeType' | 'size'> = {},
  ): Promise<ResolvedTarget> => {
    if (!ref || typeof ref.sessionKey !== 'string' || !Number.isFinite(ref.generation)) {
      throw new AttachmentFailure('invalidReference');
    }
    validateReferenceSyntax(ref.uri);
    const context = dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation);
    if (!context) throw new AttachmentFailure('staleSession');

    const outgoing = parseOutgoingUrl(ref.uri);
    if (outgoing) return resolveOutgoing(ref, outgoing);
    if (/^https?:/i.test(ref.uri)) {
      return {
        kind: 'remote',
        normalizedUrl: normalizeRemote(ref.uri),
        mimeType: metadata.mimeType || mimeTypeForPath(new URL(ref.uri).pathname),
        size: typeof metadata.size === 'number' && Number.isFinite(metadata.size) && metadata.size >= 0
          ? metadata.size
          : 0,
      };
    }
    const localPath = localPathFromUri(ref.uri, context.executionCwd);
    return resolveLocalCandidate(ref, localPath, metadata.mimeType);
  };

  const resolveAttachment = async (payload: ResolveAttachmentPayload): Promise<ResolveAttachmentResult> => {
    const ref = payload?.ref;
    const fallbackName = decodedBasename(typeof ref?.uri === 'string' ? ref.uri : 'attachment');
    const displayName = safeDisplayName(payload?.name, fallbackName);
    try {
      const target = await resolveTarget(ref, payload);
      const localName = target.kind === 'local' ? basename(target.canonicalPath) : fallbackName;
      const finalDisplayName = safeDisplayName(payload?.name, localName);
      if (target.kind === 'remote') {
        return {
          ok: true,
          identity: opaqueIdentity(target.normalizedUrl),
          displayName: finalDisplayName,
          mimeType: target.mimeType,
          size: target.size,
          target: { kind: 'remote', ref, url: target.normalizedUrl },
        };
      }
      const displayPath = ref.stagingId
        ? dependencies.stagedAttachments.getDisplayPath(ref.stagingId)
        : null;
      return {
        ok: true,
        identity: opaqueIdentity(target.canonicalPath),
        displayName: finalDisplayName,
        ...(displayPath ? { displayPath } : {}),
        mimeType: target.mimeType,
        size: target.size,
        target: { kind: 'local', scope: target.scope, ref },
      };
    } catch (error) {
      return { ok: false, displayName, error: attachmentFailure(error) };
    }
  };

  const readAttachmentText = async (ref: AttachmentFileRef): Promise<ReadAttachmentTextResult> => {
    let opened: { handle: FileHandle; stat: Stats } | undefined;
    try {
      const target = await resolveTarget(ref);
      if (target.kind !== 'local') throw new AttachmentFailure('invalidReference');
      opened = await openRevalidatedLocal(target, await getFs());
      if (!dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation)) {
        throw new AttachmentFailure('staleSession');
      }
      if (opened.stat.size > FILE_PREVIEW_MAX_TEXT_BYTES) {
        return { ok: false, error: 'tooLarge', size: opened.stat.size };
      }
      const buffer = await readOpenedFile(opened.handle, FILE_PREVIEW_MAX_TEXT_BYTES);
      if (!buffer) return { ok: false, error: 'tooLarge', size: FILE_PREVIEW_MAX_TEXT_BYTES + 1 };
      if (looksLikeBinary(buffer)) return { ok: false, error: 'binary', size: buffer.length };
      return {
        ok: true,
        content: buffer.toString('utf8'),
        mimeType: target.mimeType,
        size: buffer.length,
        readOnly: true,
      };
    } catch (error) {
      return { ok: false, error: attachmentFailure(error) };
    } finally {
      await opened?.handle.close().catch(() => undefined);
    }
  };

  const readAttachmentBinary = async (
    payload: ReadAttachmentBinaryPayload,
  ): Promise<ReadAttachmentBinaryResult> => {
    let opened: { handle: FileHandle; stat: Stats } | undefined;
    try {
      const target = await resolveTarget(payload?.ref);
      if (target.kind !== 'local') throw new AttachmentFailure('invalidReference');
      opened = await openRevalidatedLocal(target, await getFs());
      if (!dependencies.sessionAccessRegistry.get(payload.ref.sessionKey, payload.ref.generation)) {
        throw new AttachmentFailure('staleSession');
      }
      const cap = boundedBinaryCap(payload.maxBytes);
      if (opened.stat.size > cap) return { ok: false, error: 'tooLarge', size: opened.stat.size };
      const buffer = await readOpenedFile(opened.handle, cap);
      if (!buffer) return { ok: false, error: 'tooLarge', size: cap + 1 };
      return {
        ok: true,
        data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        mimeType: target.mimeType,
        size: buffer.length,
        readOnly: true,
      };
    } catch (error) {
      return { ok: false, error: attachmentFailure(error) };
    } finally {
      await opened?.handle.close().catch(() => undefined);
    }
  };

  const openAttachment = async (ref: AttachmentSourceRef): Promise<OpenAttachmentResult> => {
    let identity = opaqueIdentity(typeof ref?.uri === 'string' ? ref.uri : 'invalid');
    let sourceKind: 'local' | 'remote' | 'invalid' = typeof ref?.uri === 'string'
      ? (/^https?:/i.test(ref.uri) ? 'remote' : 'local')
      : 'invalid';
    try {
      const target = await resolveTarget(ref);
      if (target.kind === 'remote') {
        sourceKind = 'remote';
        identity = opaqueIdentity(target.normalizedUrl);
        if (!dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation)) {
          throw new AttachmentFailure('staleSession');
        }
        await shell.openExternal(target.normalizedUrl);
      } else {
        sourceKind = 'local';
        identity = opaqueIdentity(target.canonicalPath);
        const revalidated = await resolveTarget(ref);
        if (revalidated.kind !== 'local') throw new AttachmentFailure('invalidReference');
        identity = opaqueIdentity(revalidated.canonicalPath);
        if (!dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation)) {
          throw new AttachmentFailure('staleSession');
        }
        const error = await shell.openPath(revalidated.canonicalPath);
        if (error) throw new AttachmentFailure('operationFailed');
      }
      recordAttachmentOpenTrace({
        ok: true,
        reason: 'success',
        sourceKind,
        sessionKey: ref.sessionKey,
        generation: ref.generation,
        identity,
      });
      return { ok: true };
    } catch (error) {
      const reason = attachmentFailure(error);
      recordAttachmentOpenTrace({
        ok: false,
        reason,
        sourceKind,
        sessionKey: typeof ref?.sessionKey === 'string' ? ref.sessionKey : '',
        generation: typeof ref?.generation === 'number' ? ref.generation : -1,
        identity,
      });
      return { ok: false, error: reason };
    }
  };

  const requireCurrentLocalTarget = async (ref: AttachmentFileRef): Promise<ResolvedLocal> => {
    const target = await resolveTarget(ref);
    if (target.kind !== 'local') throw new AttachmentFailure('invalidReference');
    if (!dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation)) {
      throw new AttachmentFailure('staleSession');
    }
    return target;
  };

  const listAttachmentOpenHandlers = async (
    ref: AttachmentFileRef,
  ): Promise<AttachmentOpenHandlersResult> => {
    try {
      const target = await requireCurrentLocalTarget(ref);
      if (dependencies.openWith.platform === 'linux') {
        return { ok: true, platform: 'linux', handlers: [] };
      }
      const handlers = await dependencies.openWith.list(target.canonicalPath);
      if (!dependencies.sessionAccessRegistry.get(ref.sessionKey, ref.generation)) {
        throw new AttachmentFailure('staleSession');
      }
      return {
        ok: true,
        platform: dependencies.openWith.platform,
        handlers: handlers.map(({ id, name, iconDataUrl, isDefault }) => ({
          handlerId: id,
          name,
          ...(iconDataUrl ? { iconDataUrl } : {}),
          isDefault,
        })),
      };
    } catch (error) {
      return { ok: false, error: attachmentFailure(error) };
    }
  };

  const openAttachmentWith = async (
    payload: OpenAttachmentWithPayload,
  ): Promise<OpenAttachmentResult> => {
    try {
      const target = await requireCurrentLocalTarget(payload?.ref);
      if (typeof payload?.handlerId !== 'string'
        || !payload.handlerId.trim()
        || payload.handlerId.length > HANDLER_ID_MAX_LENGTH) {
        throw new AttachmentFailure('invalidReference');
      }
      await dependencies.openWith.open(
        target.canonicalPath,
        payload.handlerId,
        async () => (await requireCurrentLocalTarget(payload.ref)).canonicalPath,
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: attachmentFailure(error) };
    }
  };

  const revealAttachment = async (ref: AttachmentFileRef): Promise<OpenAttachmentResult> => {
    try {
      await requireCurrentLocalTarget(ref);
      const revalidated = await requireCurrentLocalTarget(ref);
      shell.showItemInFolder(revalidated.canonicalPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: attachmentFailure(error) };
    }
  };

  return {
    resolveAttachment,
    readAttachmentText,
    readAttachmentBinary,
    openAttachment,
    listAttachmentOpenHandlers,
    openAttachmentWith,
    revealAttachment,
  };
}
