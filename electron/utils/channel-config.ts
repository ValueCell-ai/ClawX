/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');

export interface ChannelConfigData {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface OpenClawConfig {
    channels?: Record<string, ChannelConfigData>;
    [key: string]: unknown;
}

/**
 * Ensure OpenClaw config directory exists
 */
function ensureConfigDir(): void {
    if (!existsSync(OPENCLAW_DIR)) {
        mkdirSync(OPENCLAW_DIR, { recursive: true });
    }
}

/**
 * Read OpenClaw configuration
 */
export function readOpenClawConfig(): OpenClawConfig {
    ensureConfigDir();

    if (!existsSync(CONFIG_FILE)) {
        return {};
    }

    try {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as OpenClawConfig;
    } catch (error) {
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}

/**
 * Write OpenClaw configuration
 */
export function writeOpenClawConfig(config: OpenClawConfig): void {
    ensureConfigDir();

    try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

/**
 * Save channel configuration
 * @param channelType - The channel type (e.g., 'telegram', 'discord')
 * @param config - The channel configuration object
 */
export function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData
): void {
    const currentConfig = readOpenClawConfig();

    if (!currentConfig.channels) {
        currentConfig.channels = {};
    }

    // Merge with existing config
    currentConfig.channels[channelType] = {
        ...currentConfig.channels[channelType],
        ...config,
        enabled: config.enabled ?? true,
    };

    writeOpenClawConfig(currentConfig);
    console.log(`Saved channel config for ${channelType}`);
}

/**
 * Get channel configuration
 * @param channelType - The channel type
 */
export function getChannelConfig(channelType: string): ChannelConfigData | undefined {
    const config = readOpenClawConfig();
    return config.channels?.[channelType];
}

/**
 * Delete channel configuration
 * @param channelType - The channel type
 */
export function deleteChannelConfig(channelType: string): void {
    const currentConfig = readOpenClawConfig();

    if (currentConfig.channels?.[channelType]) {
        delete currentConfig.channels[channelType];
        writeOpenClawConfig(currentConfig);
        console.log(`Deleted channel config for ${channelType}`);
    }
}

/**
 * List all configured channels
 */
export function listConfiguredChannels(): string[] {
    const config = readOpenClawConfig();
    if (!config.channels) {
        return [];
    }

    return Object.keys(config.channels).filter(
        (channelType) => config.channels![channelType]?.enabled !== false
    );
}

/**
 * Enable or disable a channel
 */
export function setChannelEnabled(channelType: string, enabled: boolean): void {
    const currentConfig = readOpenClawConfig();

    if (!currentConfig.channels) {
        currentConfig.channels = {};
    }

    if (!currentConfig.channels[channelType]) {
        currentConfig.channels[channelType] = {};
    }

    currentConfig.channels[channelType].enabled = enabled;
    writeOpenClawConfig(currentConfig);
    console.log(`Set channel ${channelType} enabled: ${enabled}`);
}
