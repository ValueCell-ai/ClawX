/**
 * Skill Config Utilities
 * Direct read/write access to skill configuration in ~/.openclaw/openclaw.json
 * This bypasses the Gateway RPC for faster and more reliable config updates
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

interface SkillEntry {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

interface OpenClawConfig {
    skills?: {
        entries?: Record<string, SkillEntry>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Read the current OpenClaw config
 */
function readConfig(): OpenClawConfig {
    if (!existsSync(OPENCLAW_CONFIG_PATH)) {
        return {};
    }
    try {
        const raw = readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8');
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
    const json = JSON.stringify(config, null, 2);
    writeFileSync(OPENCLAW_CONFIG_PATH, json, 'utf-8');
}

/**
 * Get skill config
 */
export function getSkillConfig(skillKey: string): SkillEntry | undefined {
    const config = readConfig();
    return config.skills?.entries?.[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
export function updateSkillConfig(
    skillKey: string,
    updates: { apiKey?: string; env?: Record<string, string> }
): { success: boolean; error?: string } {
    try {
        const config = readConfig();

        // Ensure skills.entries exists
        if (!config.skills) {
            config.skills = {};
        }
        if (!config.skills.entries) {
            config.skills.entries = {};
        }

        // Get or create skill entry
        const entry = config.skills.entries[skillKey] || {};

        // Update apiKey
        if (updates.apiKey !== undefined) {
            const trimmed = updates.apiKey.trim();
            if (trimmed) {
                entry.apiKey = trimmed;
            } else {
                delete entry.apiKey;
            }
        }

        // Update env
        if (updates.env !== undefined) {
            const newEnv: Record<string, string> = {};

            // Process all keys from the update
            for (const [key, value] of Object.entries(updates.env)) {
                const trimmedKey = key.trim();
                if (!trimmedKey) continue;

                const trimmedVal = value.trim();
                if (trimmedVal) {
                    newEnv[trimmedKey] = trimmedVal;
                }
                // Empty value = don't include (delete)
            }

            // Only set env if there are values, otherwise delete
            if (Object.keys(newEnv).length > 0) {
                entry.env = newEnv;
            } else {
                delete entry.env;
            }
        }

        // Save entry back
        config.skills.entries[skillKey] = entry;

        writeConfig(config);
        return { success: true };
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export function getAllSkillConfigs(): Record<string, SkillEntry> {
    const config = readConfig();
    return config.skills?.entries || {};
}
