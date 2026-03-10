import { access, copyFile, mkdir, readdir } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { expandPath, getOpenClawConfigDir } from './paths';
import * as logger from './logger';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
}

function formatModelLabel(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    const trimmed = model.trim();
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      const parts = primary.trim().split('/');
      return parts[parts.length - 1] || primary.trim();
    }
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function slugifyAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isSimpleChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  const keys = Object.keys(candidate.match);
  return keys.length === 1 && typeof candidate.match.channel === 'string' && Boolean(candidate.match.channel);
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function getSimpleChannelBindingMap(bindings: unknown): Map<string, string> {
  const owners = new Map<string, string>();
  if (!Array.isArray(bindings)) return owners;

  for (const binding of bindings) {
    if (!isSimpleChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    if (agentId) owners.set(binding.match.channel!, agentId);
  }

  return owners;
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
): BindingConfig[] | undefined {
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => !(
      isSimpleChannelBinding(binding) && binding.match.channel === channelType
    ))
    : [];

  if (agentId) {
    nextBindings.push({
      agentId,
      match: { channel: channelType },
    });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(config: AgentConfigDocument, agent: AgentListEntry): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  if (targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

async function buildSnapshotFromConfig(config: AgentConfigDocument): Promise<AgentsSnapshot> {
  const { entries, defaultAgentId } = normalizeAgentsConfig(config);
  const configuredChannels = await listConfiguredChannels();
  const explicitOwners = getSimpleChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const channelOwners: Record<string, string> = {};

  for (const channelType of configuredChannels) {
    channelOwners[channelType] = explicitOwners.get(channelType) || defaultAgentIdNorm;
  }

  const defaultModelLabel = formatModelLabel((config.agents as AgentsConfig | undefined)?.defaults?.model);
  const agents: AgentSummary[] = entries.map((entry) => {
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !formatModelLabel(entry.model) && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    return {
      id: entry.id,
      name: entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      inheritedModel,
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      channelTypes: configuredChannels.filter((channelType) => channelOwners[channelType] === entryIdNorm),
    };
  });

  return {
    agents,
    defaultAgentId,
    configuredChannelTypes: configuredChannels,
    channelOwners,
  };
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  return buildSnapshotFromConfig(config);
}

export async function createAgent(name: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
  const normalizedName = normalizeAgentName(name);
  const existingIds = new Set(entries.map((entry) => entry.id));
  const diskIds = await listExistingAgentIdsOnDisk();
  let nextId = slugifyAgentId(normalizedName);
  let suffix = 2;

  while (existingIds.has(nextId) || diskIds.has(nextId)) {
    nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
    suffix += 1;
  }

  const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((entry, index) => index > 0)] : [...entries];
  const newAgent: AgentListEntry = {
    id: nextId,
    name: normalizedName,
    workspace: `~/.openclaw/workspace-${nextId}`,
    agentDir: getDefaultAgentDirPath(nextId),
  };

  if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
    nextEntries.unshift(createImplicitMainEntry(config));
  }
  nextEntries.push(newAgent);

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };

  await provisionAgentFilesystem(config, newAgent);
  await writeOpenClawConfig(config);
  logger.info('Created agent config entry', { agentId: nextId });
  return buildSnapshotFromConfig(config);
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries } = normalizeAgentsConfig(config);
  const normalizedName = normalizeAgentName(name);
  const index = entries.findIndex((entry) => entry.id === agentId);
  if (index === -1) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  entries[index] = {
    ...entries[index],
    name: normalizedName,
  };

  config.agents = {
    ...agentsConfig,
    list: entries,
  };

  await writeOpenClawConfig(config);
  logger.info('Updated agent name', { agentId, name: normalizedName });
  return buildSnapshotFromConfig(config);
}

export async function deleteAgentConfig(agentId: string): Promise<AgentsSnapshot> {
  if (agentId === MAIN_AGENT_ID) {
    throw new Error('The main agent cannot be deleted');
  }

  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
  const nextEntries = entries.filter((entry) => entry.id !== agentId);
  if (nextEntries.length === entries.length) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };
  config.bindings = Array.isArray(config.bindings)
    ? config.bindings.filter((binding) => !(isSimpleChannelBinding(binding) && binding.agentId === agentId))
    : undefined;

  if (defaultAgentId === agentId && nextEntries.length > 0) {
    nextEntries[0] = {
      ...nextEntries[0],
      default: true,
    };
  }

  await writeOpenClawConfig(config);
  logger.info('Deleted agent config entry', { agentId });
  return buildSnapshotFromConfig(config);
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  if (!entries.some((entry) => entry.id === agentId)) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId);
  await writeOpenClawConfig(config);
  logger.info('Assigned channel to agent', { agentId, channelType });
  return buildSnapshotFromConfig(config);
}

export async function clearChannelBinding(channelType: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  config.bindings = upsertBindingsForChannel(config.bindings, channelType, null);
  await writeOpenClawConfig(config);
  logger.info('Cleared simplified channel binding', { channelType });
  return buildSnapshotFromConfig(config);
}
