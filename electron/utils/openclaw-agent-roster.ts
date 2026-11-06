/**
 * OpenClaw 2026.10 stores the agent roster as keyed `agents.entries`; the
 * legacy `agents.list` array is still read until doctor migrates it. Returned
 * entries are the live config objects so callers can edit them in place.
 */

import { homedir } from 'os';
import { join, resolve } from 'path';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface OpenClawAgentRosterEntry {
  id: string;
  entry: Record<string, unknown>;
}

export function listOpenClawAgentRosterEntries(agents: unknown): OpenClawAgentRosterEntry[] {
  if (!isRecord(agents)) return [];
  if (Object.hasOwn(agents, 'entries') && agents.entries !== undefined) {
    if (!isRecord(agents.entries)) return [];
    return Object.entries(agents.entries)
      .filter((pair): pair is [string, Record<string, unknown>] => isRecord(pair[1]))
      .map(([id, entry]) => ({ id, entry }));
  }
  if (Array.isArray(agents.list)) {
    return agents.list
      .filter(isRecord)
      .map((entry) => ({ id: typeof entry.id === 'string' ? entry.id : '', entry }));
  }
  return [];
}

export function listOpenClawAgentEntryRecords(agents: unknown): Record<string, unknown>[] {
  return listOpenClawAgentRosterEntries(agents).map(({ entry }) => entry);
}

function normalizeAgentId(id: string): string {
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id.trim())) return id.trim().toLowerCase();
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '').replace(/-+$/, '').slice(0, 64) || 'main';
}

function hasRoster(agents: Record<string, unknown>): boolean {
  return (Object.hasOwn(agents, 'entries') && agents.entries !== undefined)
    || (Object.hasOwn(agents, 'list') && agents.list !== undefined);
}

/** Current runtime data ownership is independent of defaults.systemAgent. */
export function resolveOpenClawLegacyDataOwnerAgentId(agents: unknown): string | undefined {
  const entries = listOpenClawAgentRosterEntries(agents);
  if (isRecord(agents) && agents.ownership !== 'explicit') {
    const marked = entries.filter(({ entry }) => entry.default === true);
    if (marked.length === 1) return normalizeAgentId(marked[0].id);
  }
  if (entries.length === 1) return normalizeAgentId(entries[0].id);
  if (entries.length === 0 && (!isRecord(agents) || !hasRoster(agents))) return 'main';
  return undefined;
}

export interface OpenClawWorkspacePathOptions {
  /** Explicit effective home for callers operating on an isolated profile. */
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveWorkspacePaths(options: OpenClawWorkspacePathOptions) {
  const env = options.env ?? process.env;
  const homeValue = (value: unknown) => {
    const text = nonempty(value);
    return text !== 'undefined' && text !== 'null' ? text : undefined;
  };
  const osHome = homeValue(env.HOME) ?? homeValue(env.USERPROFILE) ?? homedir();
  const configuredHome = homeValue(env.OPENCLAW_HOME);
  const home = resolve(options.homeDir ?? (configuredHome
    ? configuredHome.replace(/^~(?=$|[\\/])/, () => osHome)
    : osHome));
  const userPath = (value: string) => resolve(value.trim().replace(/^~(?=$|[\\/])/, () => home));
  const stateDir = nonempty(env.OPENCLAW_STATE_DIR)
    ? userPath(env.OPENCLAW_STATE_DIR!) : join(home, '.openclaw');
  return { env, home, userPath, stateDir };
}

/**
 * Mirrors the lightweight workspace/data-owner rules in OpenClaw 2026.10.5.
 * Its public agent-runtime SDK pulls in model/auth runtime code, so keep this
 * synchronous path-only helper independent of that startup dependency tree.
 * Already-current entries always use current ownership; never infer old paths
 * from names, the system Agent, or directories that happen to exist on disk.
 */
export function resolveOpenClawAgentWorkspaceDir(
  agents: unknown,
  agentId: string,
  options: OpenClawWorkspacePathOptions = {},
): string {
  return resolveWorkspaceDir(agents, agentId, options, false);
}

/** Resolve the shipped 0.6.1 roster before migration materializes its paths. */
export function resolveLegacyOpenClawAgentWorkspaceDir(
  agents: unknown,
  agentId: string,
  options: OpenClawWorkspacePathOptions = {},
): string {
  return resolveWorkspaceDir(agents, agentId, options, true);
}

function resolveWorkspaceDir(
  agents: unknown,
  agentId: string,
  options: OpenClawWorkspacePathOptions,
  legacy: boolean,
): string {
  const id = normalizeAgentId(agentId);
  const roster = listOpenClawAgentRosterEntries(agents);
  const entry = roster.find((candidate) => normalizeAgentId(candidate.id) === id)?.entry;
  const { env, home, userPath, stateDir } = resolveWorkspacePaths(options);
  const clean = (value: string) => value.replaceAll('\0', '');
  const explicit = nonempty(entry?.workspace);
  if (explicit) return clean(userPath(explicit));
  const defaults = isRecord(agents) && isRecord(agents.defaults) ? agents.defaults : undefined;
  const base = nonempty(defaults?.workspace);
  const legacyOwner = legacy
    ? normalizeAgentId((roster.find(({ entry }) => entry.default) ?? roster[0])?.id ?? 'main')
    : resolveOpenClawLegacyDataOwnerAgentId(agents);
  if (legacyOwner !== id) return clean(base ? join(userPath(base), id) : join(stateDir, `workspace-${id}`));
  if (base) return clean(userPath(base));
  const override = nonempty(env.OPENCLAW_WORKSPACE_DIR);
  if (override) return clean(resolve(override));
  if (!legacy && nonempty(env.OPENCLAW_STATE_DIR)) return clean(join(stateDir, 'workspace'));
  const profile = nonempty(env.OPENCLAW_PROFILE);
  if (profile && profile.toLowerCase() !== 'default') {
    if (!legacy && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) {
      throw new Error(`Invalid profile name: ${JSON.stringify(profile)}`);
    }
    return clean(legacy ? join(home, '.openclaw', `workspace-${profile}`) : join(home, `.openclaw-${profile}`, 'workspace'));
  }
  return clean(join(home, '.openclaw', 'workspace'));
}
