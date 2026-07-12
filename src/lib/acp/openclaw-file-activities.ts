import { diffLines } from 'diff';
import { groupAcpTimelineItems } from './timeline-groups';
import type { AcpTimelineSnapshot, ToolCallItem } from './timeline-types';

export type OpenClawFileToolName = 'write' | 'edit' | 'apply_patch';

export type AcpFileChangeFragment = {
  oldText: string;
  newText: string;
  sequence: number;
};

export type AcpFileActivity = {
  turnId: string;
  toolCallId: string;
  toolName: OpenClawFileToolName;
  relativePath: string;
  action: 'created' | 'modified' | 'deleted';
  fragments: AcpFileChangeFragment[];
  sequence: number;
};

export type AcpTurnFileSummary = {
  turnId: string;
  relativePath: string;
  action: 'created' | 'modified' | 'deleted';
  activities: AcpFileActivity[];
  added: number | null;
  removed: number | null;
};

export type AcpSessionFileGroup = {
  relativePath: string;
  activities: AcpFileActivity[];
};

export type AcpTurnFileChange = {
  turnId: string;
  activities: AcpFileActivity[];
  sequence: number;
  diff: Pick<AcpFileChangeFragment, 'oldText' | 'newText'> | null;
};

export type AcpFileActivityProjection = {
  activities: AcpFileActivity[];
  turnSummariesByTurnId: Record<string, AcpTurnFileSummary[]>;
  fileGroups: AcpSessionFileGroup[];
  uniqueFileCount: number;
};

type FileAction = AcpFileActivity['action'];
type PathFamily = 'posix' | 'windows';
type PathContext = {
  family: PathFamily;
  workspaceRoot: string;
  executionCwd: string;
};
type WindowsAbsolutePath = {
  root: string;
  segments: string[];
};
type ParsedFragment = Omit<AcpFileChangeFragment, 'sequence'>;
type ParsedActivity = {
  relativePath: string;
  action: FileAction;
  fragments: ParsedFragment[];
};
type PatchHunk =
  | { kind: 'add'; path: string; contents: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; movePath?: string; chunks: ParsedFragment[] };

const EMPTY_PROJECTION: AcpFileActivityProjection = {
  activities: [],
  turnSummariesByTurnId: {},
  fileGroups: [],
  uniqueFileCount: 0,
};

const BEGIN_PATCH_MARKER = '*** Begin Patch';
const END_PATCH_MARKER = '*** End Patch';
const ADD_FILE_MARKER = '*** Add File: ';
const DELETE_FILE_MARKER = '*** Delete File: ';
const UPDATE_FILE_MARKER = '*** Update File: ';
const MOVE_TO_MARKER = '*** Move to: ';
const EOF_MARKER = '*** End of File';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseToolName(title: string): OpenClawFileToolName | null {
  const colon = title.indexOf(':');
  if (colon < 0) return null;
  const name = title.slice(0, colon).trim().toLowerCase();
  return name === 'write' || name === 'edit' || name === 'apply_patch' ? name : null;
}

function pathFamily(value: string): PathFamily | null {
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value) || /^\/\/[^/]/.test(value)) {
    return 'windows';
  }
  return value.startsWith('/') ? 'posix' : null;
}

function normalizeSegments(segments: string[]): string[] {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized;
}

function resolvePosix(value: string, base?: string): string {
  const absolute = value.startsWith('/');
  const segments = absolute ? [] : base?.split('/') ?? [];
  segments.push(...value.split('/'));
  return `/${normalizeSegments(segments).join('/')}`;
}

function parseWindowsAbsolute(value: string): WindowsAbsolutePath | null {
  const normalized = value.replaceAll('/', '\\');
  if (normalized.startsWith('\\\\')) {
    const segments = normalized.slice(2).split('\\').filter(Boolean);
    if (segments.length < 2) return null;
    const [server, share, ...rest] = segments;
    return { root: `\\\\${server}\\${share}`, segments: normalizeSegments(rest) };
  }

  const drive = /^([A-Za-z]):\\/.exec(normalized);
  if (drive) {
    return {
      root: `${drive[1]?.toUpperCase()}:`,
      segments: normalizeSegments(normalized.slice(drive[0].length).split('\\')),
    };
  }
  if (normalized.startsWith('\\')) {
    return { root: '\\', segments: normalizeSegments(normalized.slice(1).split('\\')) };
  }
  return null;
}

function formatWindowsPath(path: WindowsAbsolutePath): string {
  const suffix = path.segments.join('\\');
  if (path.root === '\\') return `\\${suffix}`;
  return `${path.root}\\${suffix}`;
}

function resolveWindows(value: string, base?: string): string {
  const absolute = parseWindowsAbsolute(value);
  if (absolute) {
    if (absolute.root !== '\\') return formatWindowsPath(absolute);
    const basePath = base ? parseWindowsAbsolute(base) : null;
    return formatWindowsPath({ root: basePath?.root ?? absolute.root, segments: absolute.segments });
  }

  const basePath = base ? parseWindowsAbsolute(base) : null;
  if (!basePath) return value.replaceAll('/', '\\');
  const segments = value.replaceAll('/', '\\').split('\\');
  return formatWindowsPath({ root: basePath.root, segments: normalizeSegments([...basePath.segments, ...segments]) });
}

function relativeSegments(from: string[], to: string[], caseInsensitive: boolean): string[] {
  let common = 0;
  while (common < from.length && common < to.length) {
    const fromSegment = caseInsensitive ? from[common]?.toLowerCase() : from[common];
    const toSegment = caseInsensitive ? to[common]?.toLowerCase() : to[common];
    if (fromSegment !== toSegment) break;
    common += 1;
  }
  return [...Array.from({ length: from.length - common }, () => '..'), ...to.slice(common)];
}

function relativePath(from: string, to: string, family: PathFamily): string {
  if (family === 'posix') {
    return relativeSegments(from.split('/').filter(Boolean), to.split('/').filter(Boolean), false).join('/');
  }

  const fromPath = parseWindowsAbsolute(from);
  const toPath = parseWindowsAbsolute(to);
  if (!fromPath || !toPath || fromPath.root.toLowerCase() !== toPath.root.toLowerCase()) return to;
  return relativeSegments(fromPath.segments, toPath.segments, true).join('\\');
}

function isAbsolutePath(value: string, family: PathFamily): boolean {
  return family === 'posix' ? value.startsWith('/') : parseWindowsAbsolute(value) !== null;
}

function resolvePath(value: string, family: PathFamily, base?: string): string {
  return family === 'posix' ? resolvePosix(value, base) : resolveWindows(value, base);
}

function escapesRoot(relativePath: string, family: PathFamily): boolean {
  const separator = family === 'posix' ? '/' : '\\';
  return relativePath === '..'
    || relativePath.startsWith(`..${separator}`)
    || isAbsolutePath(relativePath, family);
}

function createPathContext(workspaceRoot: string, executionCwd: string): PathContext | null {
  const rootFamily = pathFamily(workspaceRoot);
  const cwdFamily = pathFamily(executionCwd);
  if (!rootFamily || rootFamily !== cwdFamily) return null;

  if (!isAbsolutePath(workspaceRoot, rootFamily) || !isAbsolutePath(executionCwd, rootFamily)) return null;

  const normalizedRoot = resolvePath(workspaceRoot, rootFamily);
  const normalizedCwd = resolvePath(executionCwd, rootFamily);
  const cwdRelative = relativePath(normalizedRoot, normalizedCwd, rootFamily);
  if (escapesRoot(cwdRelative, rootFamily)) return null;

  return {
    family: rootFamily,
    workspaceRoot: normalizedRoot,
    executionCwd: normalizedCwd,
  };
}

function resolveToolPath(candidate: string, context: PathContext): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  let input = trimmed;
  if (context.family === 'posix') {
    if (pathFamily(input) === 'windows' || /^[A-Za-z]:/.test(input)) return null;
    input = input.replaceAll('\\', '/');
  } else {
    if (input.startsWith('/') && !input.startsWith('//')) return null;
    if (/^[A-Za-z]:/.test(input) && !isAbsolutePath(input, 'windows')) return null;
  }

  const resolved = isAbsolutePath(input, context.family)
    ? resolvePath(input, context.family)
    : resolvePath(input, context.family, context.executionCwd);
  const relative = relativePath(context.workspaceRoot, resolved, context.family);
  if (!relative || escapesRoot(relative, context.family)) return null;
  return relative.replaceAll('\\', '/');
}

function readPath(input: Record<string, unknown>): string | null {
  for (const key of ['path', 'file_path', 'filePath', 'file']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function parseWrite(input: Record<string, unknown>, context: PathContext): ParsedActivity[] {
  const candidate = readPath(input);
  if (!candidate) return [];
  const relativePath = resolveToolPath(candidate, context);
  if (!relativePath) return [];
  const fragments = typeof input.content === 'string'
    ? [{ oldText: '', newText: input.content }]
    : [];
  return [{ relativePath, action: 'created', fragments }];
}

function validEditFragment(value: unknown): ParsedFragment | null {
  const edit = asRecord(value);
  if (!edit || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') return null;
  return { oldText: edit.oldText, newText: edit.newText };
}

function parseEdit(input: Record<string, unknown>, context: PathContext): ParsedActivity[] {
  const candidate = readPath(input);
  if (!candidate) return [];
  const relativePath = resolveToolPath(candidate, context);
  if (!relativePath) return [];

  let fragments: ParsedFragment[] = [];
  if (Array.isArray(input.edits)) {
    fragments = input.edits.flatMap((edit) => {
      const fragment = validEditFragment(edit);
      return fragment ? [fragment] : [];
    });
  }
  const legacyFragment = validEditFragment(input);
  if (legacyFragment) fragments.push(legacyFragment);
  return [{ relativePath, action: 'modified', fragments }];
}

function unwrapAndValidatePatch(input: string): string[] {
  const lines = input.trim().split(/\r?\n/);
  let patchLines = lines;
  const first = lines[0];
  const last = lines.at(-1);
  if (first === '<<EOF' || first === '<<\'EOF\'' || first === '<<"EOF"') {
    if (!last?.endsWith('EOF')) throw new Error('Invalid apply-patch wrapper');
    patchLines = lines.slice(1, -1);
  }
  if (patchLines[0]?.trim() !== BEGIN_PATCH_MARKER || patchLines.at(-1)?.trim() !== END_PATCH_MARKER) {
    throw new Error('Invalid apply-patch envelope');
  }
  return patchLines;
}

function parseUpdateChunk(lines: string[], allowMissingContext: boolean): { fragment: ParsedFragment; consumed: number } {
  let start = 0;
  if (lines[0] === '@@' || lines[0]?.startsWith('@@ ')) start = 1;
  else if (!allowMissingContext) throw new Error('Missing apply-patch context marker');
  if (start >= lines.length) throw new Error('Empty apply-patch update chunk');

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let parsed = 0;
  for (const line of lines.slice(start)) {
    if (line === EOF_MARKER) {
      if (parsed === 0) throw new Error('Empty apply-patch update chunk');
      parsed += 1;
      break;
    }
    const marker = line[0];
    if (!marker) {
      oldLines.push('');
      newLines.push('');
    } else if (marker === ' ') {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else if (marker === '+') {
      newLines.push(line.slice(1));
    } else if (marker === '-') {
      oldLines.push(line.slice(1));
    } else {
      if (parsed === 0) throw new Error('Invalid apply-patch update line');
      break;
    }
    parsed += 1;
  }
  if (parsed === 0) throw new Error('Empty apply-patch update chunk');
  return {
    fragment: { oldText: oldLines.join('\n'), newText: newLines.join('\n') },
    consumed: start + parsed,
  };
}

function parsePatchHunk(lines: string[]): { hunk: PatchHunk; consumed: number } {
  const header = lines[0]?.trim() ?? '';
  if (header.startsWith(ADD_FILE_MARKER)) {
    let contents = '';
    let consumed = 1;
    for (const line of lines.slice(1)) {
      if (!line.startsWith('+')) break;
      contents += `${line.slice(1)}\n`;
      consumed += 1;
    }
    return { hunk: { kind: 'add', path: header.slice(ADD_FILE_MARKER.length), contents }, consumed };
  }
  if (header.startsWith(DELETE_FILE_MARKER)) {
    return { hunk: { kind: 'delete', path: header.slice(DELETE_FILE_MARKER.length) }, consumed: 1 };
  }
  if (!header.startsWith(UPDATE_FILE_MARKER)) throw new Error('Invalid apply-patch hunk header');

  const sourcePath = header.slice(UPDATE_FILE_MARKER.length);
  let remaining = lines.slice(1);
  let consumed = 1;
  let movePath: string | undefined;
  const moveCandidate = remaining[0]?.trim();
  if (moveCandidate?.startsWith(MOVE_TO_MARKER)) {
    movePath = moveCandidate.slice(MOVE_TO_MARKER.length);
    remaining = remaining.slice(1);
    consumed += 1;
  }

  const chunks: ParsedFragment[] = [];
  while (remaining.length > 0) {
    if (remaining[0]?.trim() === '') {
      remaining = remaining.slice(1);
      consumed += 1;
      continue;
    }
    if (remaining[0]?.startsWith('***')) break;
    const parsed = parseUpdateChunk(remaining, chunks.length === 0);
    chunks.push(parsed.fragment);
    remaining = remaining.slice(parsed.consumed);
    consumed += parsed.consumed;
  }
  if (chunks.length === 0) throw new Error('Empty apply-patch update hunk');
  return { hunk: { kind: 'update', path: sourcePath, movePath, chunks }, consumed };
}

function parsePatch(input: string): PatchHunk[] | null {
  try {
    const lines = unwrapAndValidatePatch(input);
    let remaining = lines.slice(1, -1);
    const hunks: PatchHunk[] = [];
    while (remaining.length > 0) {
      const parsed = parsePatchHunk(remaining);
      hunks.push(parsed.hunk);
      remaining = remaining.slice(parsed.consumed);
    }
    if (hunks.length === 0) throw new Error('Empty apply-patch payload');
    return hunks;
  } catch {
    return null;
  }
}

function parseApplyPatch(input: Record<string, unknown>, context: PathContext): ParsedActivity[] {
  if (typeof input.input !== 'string') return [];
  const hunks = parsePatch(input.input);
  if (!hunks) return [];

  const activities: ParsedActivity[] = [];
  for (const hunk of hunks) {
    const source = resolveToolPath(hunk.path, context);
    if (!source) continue;
    if (hunk.kind === 'add') {
      activities.push({
        relativePath: source,
        action: 'created',
        fragments: [{ oldText: '', newText: hunk.contents }],
      });
    } else if (hunk.kind === 'delete') {
      activities.push({ relativePath: source, action: 'deleted', fragments: [] });
    } else if (!hunk.movePath) {
      activities.push({ relativePath: source, action: 'modified', fragments: hunk.chunks });
    } else {
      const destination = resolveToolPath(hunk.movePath, context);
      if (!destination) continue;
      if (destination === source) {
        activities.push({ relativePath: source, action: 'modified', fragments: hunk.chunks });
      } else {
        activities.push({ relativePath: source, action: 'deleted', fragments: [] });
        activities.push({ relativePath: destination, action: 'created', fragments: hunk.chunks });
      }
    }
  }
  return activities;
}

function parseTool(item: ToolCallItem, toolName: OpenClawFileToolName, context: PathContext): ParsedActivity[] {
  const input = asRecord(item.input);
  if (!input) return [];
  if (toolName === 'write') return parseWrite(input, context);
  if (toolName === 'edit') return parseEdit(input, context);
  return parseApplyPatch(input, context);
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

type MergeSegment = {
  oldText: string;
  newText: string;
  fullDocument: boolean;
};

function replaceUnique(source: string, oldText: string, newText: string): string | null {
  if (!oldText) return null;
  const index = source.indexOf(oldText);
  if (index < 0 || source.indexOf(oldText, index + 1) >= 0) return null;
  return `${source.slice(0, index)}${newText}${source.slice(index + oldText.length)}`;
}

function mergeActivityFragments(activities: AcpFileActivity[]): AcpTurnFileChange['diff'] {
  const segments: MergeSegment[] = [];
  const seen = new Set<string>();

  for (const activity of activities) {
    for (const fragment of activity.fragments) {
      const { oldText, newText } = fragment;
      const identity = JSON.stringify([oldText, newText]);
      if (seen.has(identity)) continue;
      seen.add(identity);

      const fullDocument = activity.action === 'created' && oldText === '';
      if (fullDocument) {
        const existingIndex = segments.findIndex((segment) => segment.fullDocument);
        if (existingIndex >= 0) {
          const [existing] = segments.splice(existingIndex, 1);
          if (existing) segments.push({ ...existing, newText });
        } else {
          segments.push({ oldText, newText, fullDocument: true });
        }
        continue;
      }

      let merged = false;
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (!segment?.fullDocument) continue;
        const replayed = segment.newText === oldText
          ? newText
          : replaceUnique(segment.newText, oldText, newText);
        if (replayed === null) continue;
        segment.newText = replayed;
        if (index < segments.length - 1) {
          segments.splice(index, 1);
          segments.push(segment);
        }
        merged = true;
        break;
      }
      if (merged) continue;

      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (!segment) continue;
        if (segment.newText === oldText) {
          segment.newText = newText;
          merged = true;
          break;
        }
      }
      if (!merged) segments.push({ oldText, newText, fullDocument: false });
    }
  }

  if (segments.length === 0) return null;
  return {
    oldText: segments.map((segment) => segment.oldText).join('\n\n'),
    newText: segments.map((segment) => segment.newText).join('\n\n'),
  };
}

export function buildAcpTurnFileChanges(activities: AcpFileActivity[]): AcpTurnFileChange[] {
  const changes: AcpTurnFileChange[] = [];
  const byTurn = new Map<string, AcpTurnFileChange>();
  for (const activity of activities) {
    let change = byTurn.get(activity.turnId);
    if (!change) {
      change = {
        turnId: activity.turnId,
        activities: [],
        sequence: activity.sequence,
        diff: null,
      };
      changes.push(change);
      byTurn.set(activity.turnId, change);
    }
    change.activities.push(activity);
  }
  for (const change of changes) change.diff = mergeActivityFragments(change.activities);
  return changes;
}

function fragmentStats(fragment: AcpFileChangeFragment): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(normalizeEol(fragment.oldText), normalizeEol(fragment.newText))) {
    if (part.added) added += part.count ?? 0;
    if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

function foldAction(current: FileAction, next: FileAction): FileAction {
  if (next === 'deleted') return 'deleted';
  if (next === 'created') return 'created';
  return current === 'created' ? 'created' : 'modified';
}

function buildSummaries(activities: AcpFileActivity[]): Record<string, AcpTurnFileSummary[]> {
  const byTurn: Record<string, AcpTurnFileSummary[]> = {};
  const summaryMaps = new Map<string, Map<string, AcpTurnFileSummary>>();
  for (const activity of activities) {
    let summaries = byTurn[activity.turnId];
    let summaryMap = summaryMaps.get(activity.turnId);
    if (!summaries || !summaryMap) {
      summaries = [];
      summaryMap = new Map();
      byTurn[activity.turnId] = summaries;
      summaryMaps.set(activity.turnId, summaryMap);
    }

    let summary = summaryMap.get(activity.relativePath);
    if (!summary) {
      summary = {
        turnId: activity.turnId,
        relativePath: activity.relativePath,
        action: activity.action,
        activities: [],
        added: null,
        removed: null,
      };
      summaries.push(summary);
      summaryMap.set(activity.relativePath, summary);
    } else {
      summary.action = foldAction(summary.action, activity.action);
    }
    summary.activities.push(activity);
    for (const fragment of activity.fragments) {
      const stats = fragmentStats(fragment);
      summary.added = (summary.added ?? 0) + stats.added;
      summary.removed = (summary.removed ?? 0) + stats.removed;
    }
  }
  return byTurn;
}

function buildFileGroups(activities: AcpFileActivity[]): AcpSessionFileGroup[] {
  const groups: AcpSessionFileGroup[] = [];
  const byPath = new Map<string, AcpSessionFileGroup>();
  for (const activity of activities) {
    let group = byPath.get(activity.relativePath);
    if (!group) {
      group = { relativePath: activity.relativePath, activities: [] };
      groups.push(group);
      byPath.set(activity.relativePath, group);
    }
    group.activities.push(activity);
  }
  return groups;
}

export function projectOpenClawFileActivities(input: {
  timeline: AcpTimelineSnapshot;
  workspaceRoot: string;
  executionCwd: string;
}): AcpFileActivityProjection {
  const context = createPathContext(input.workspaceRoot, input.executionCwd);
  if (!context) return { ...EMPTY_PROJECTION };

  const activities: AcpFileActivity[] = [];
  const seenToolCalls = new Set<string>();
  let fragmentSequence = 0;
  for (const group of groupAcpTimelineItems(input.timeline)) {
    if (group.kind !== 'assistant-turn') continue;
    for (const item of group.items) {
      if (item.kind !== 'tool-call' || item.status !== 'completed' || seenToolCalls.has(item.toolCallId)) continue;
      seenToolCalls.add(item.toolCallId);
      const toolName = parseToolName(item.title);
      if (!toolName) continue;
      for (const parsed of parseTool(item, toolName, context)) {
        activities.push({
          ...parsed,
          turnId: group.id,
          toolCallId: item.toolCallId,
          toolName,
          sequence: activities.length,
          fragments: parsed.fragments.map((fragment) => ({ ...fragment, sequence: fragmentSequence++ })),
        });
      }
    }
  }

  const fileGroups = buildFileGroups(activities);
  return {
    activities,
    turnSummariesByTurnId: buildSummaries(activities),
    fileGroups,
    uniqueFileCount: fileGroups.length,
  };
}
