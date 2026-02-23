/**
 * Agent Config Utilities
 * Direct read/write access to agent configuration in ~/.openclaw/openclaw.json
 * Manages agent definitions and their directories under ~/.openclaw/agents/
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');
const AGENTS_DIR = join(OPENCLAW_DIR, 'agents');

/**
 * Agent definition stored in openclaw.json
 */
export interface AgentDefinition {
  name?: string;
  description?: string;
  instructions?: string;
  model?: { primary: string };
  skills?: string[];
  enabled?: boolean;
}

/**
 * Full agent info returned to the frontend
 */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills: string[];
  enabled: boolean;
  isDefault: boolean;
}

interface OpenClawConfig {
  agents?: {
    definitions?: Record<string, AgentDefinition>;
    defaults?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Read the current OpenClaw config
 */
function readConfig(): OpenClawConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read openclaw config:', err);
    return {};
  }
}

/**
 * Write the OpenClaw config
 */
function writeConfig(config: OpenClawConfig): void {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true });
  }
  const json = JSON.stringify(config, null, 2);
  writeFileSync(CONFIG_FILE, json, 'utf-8');
}

/**
 * Ensure agent directory structure exists
 */
function ensureAgentDir(agentId: string): void {
  const agentDir = join(AGENTS_DIR, agentId, 'agent');
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }
}

/**
 * Convert an AgentDefinition to AgentInfo for the frontend
 */
function toAgentInfo(id: string, def: AgentDefinition): AgentInfo {
  return {
    id,
    name: def.name || id,
    description: def.description || '',
    instructions: def.instructions || '',
    model: def.model?.primary || '',
    skills: def.skills || [],
    enabled: def.enabled !== false,
    isDefault: id === 'main',
  };
}

/**
 * List all agents by merging config definitions with agents/ directories
 */
export function listAgents(): AgentInfo[] {
  const config = readConfig();
  const definitions = config.agents?.definitions || {};

  // Collect agents from config definitions
  const agentMap = new Map<string, AgentInfo>();

  for (const [id, def] of Object.entries(definitions)) {
    agentMap.set(id, toAgentInfo(id, def));
  }

  // Scan agents directory for any agents not in config
  if (existsSync(AGENTS_DIR)) {
    try {
      const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory() && !agentMap.has(dir.name)) {
          agentMap.set(dir.name, toAgentInfo(dir.name, {}));
        }
      }
    } catch {
      // Ignore scan errors
    }
  }

  // Ensure 'main' agent always exists
  if (!agentMap.has('main')) {
    agentMap.set('main', toAgentInfo('main', { name: 'Main Agent' }));
  }

  // Sort: default first, then alphabetical
  return Array.from(agentMap.values()).sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get single agent config
 */
export function getAgentConfig(agentId: string): AgentInfo | undefined {
  const config = readConfig();
  const def = config.agents?.definitions?.[agentId];

  if (!def) {
    // Check if directory exists
    const agentDir = join(AGENTS_DIR, agentId);
    if (existsSync(agentDir) || agentId === 'main') {
      return toAgentInfo(agentId, {});
    }
    return undefined;
  }

  return toAgentInfo(agentId, def);
}

/**
 * Save agent config (create or update)
 */
export function saveAgentConfig(
  agentId: string,
  updates: { name?: string; description?: string; instructions?: string; model?: string; skills?: string[]; enabled?: boolean }
): { success: boolean; error?: string } {
  try {
    const config = readConfig();

    // Ensure agents.definitions exists
    if (!config.agents) {
      config.agents = {};
    }
    if (!config.agents.definitions) {
      config.agents.definitions = {};
    }

    // Get or create entry
    const entry: AgentDefinition = config.agents.definitions[agentId] || {};

    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.description !== undefined) entry.description = updates.description;
    if (updates.instructions !== undefined) entry.instructions = updates.instructions;
    if (updates.model !== undefined) {
      if (updates.model) {
        entry.model = { primary: updates.model };
      } else {
        delete entry.model;
      }
    }
    if (updates.skills !== undefined) entry.skills = updates.skills;
    if (updates.enabled !== undefined) entry.enabled = updates.enabled;

    config.agents.definitions[agentId] = entry;
    writeConfig(config);

    // Ensure agent directory exists
    ensureAgentDir(agentId);

    return { success: true };
  } catch (err) {
    console.error('Failed to save agent config:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Delete agent config (cannot delete 'main')
 */
export function deleteAgentConfig(agentId: string): { success: boolean; error?: string } {
  if (agentId === 'main') {
    return { success: false, error: 'Cannot delete the main agent' };
  }

  try {
    const config = readConfig();

    // Remove from definitions
    if (config.agents?.definitions?.[agentId]) {
      delete config.agents.definitions[agentId];
      writeConfig(config);
    }

    // Remove agent directory
    const agentDir = join(AGENTS_DIR, agentId);
    if (existsSync(agentDir)) {
      rmSync(agentDir, { recursive: true, force: true });
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to delete agent config:', err);
    return { success: false, error: String(err) };
  }
}
