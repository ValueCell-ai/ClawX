/**
 * Gateway WebSocket Client
 * Provides a typed interface for Gateway RPC calls
 */
import { GatewayManager, GatewayStatus } from './manager';

/**
 * Channel types supported by OpenClaw
 */
export type ChannelType = 'whatsapp' | 'dingtalk' | 'telegram' | 'discord' | 'wechat';

/**
 * Channel status
 */
export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastActivity?: string;
  error?: string;
  config?: Record<string, unknown>;
}

/**
 * Skill definition
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category?: string;
  icon?: string;
  configurable?: boolean;
  version?: string;
  author?: string;
}

/**
 * Skill bundle definition
 */
export interface SkillBundle {
  id: string;
  name: string;
  description: string;
  skills: string[];
  icon?: string;
  recommended?: boolean;
}

/**
 * Chat message
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  channel?: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}

/**
 * Tool call in a message
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'completed' | 'error';
  duration?: number;
}

/**
 * Cron task definition
 */
export interface CronTask {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  status: 'idle' | 'running' | 'error';
  error?: string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
}

/**
 * Gateway Client
 * Typed wrapper around GatewayManager for making RPC calls
 */
export class GatewayClient {
  constructor(private manager: GatewayManager) { }

  /**
   * Get current gateway status
   */
  getStatus(): GatewayStatus {
    return this.manager.getStatus();
  }

  /**
   * Check if gateway is connected
   */
  isConnected(): boolean {
    return this.manager.isConnected();
  }

  // ==================== Channel Methods ====================

  /**
   * List all channels
   */
  async listChannels(): Promise<Channel[]> {
    return this.manager.rpc<Channel[]>('channels.list');
  }

  /**
   * Get channel by ID
   */
  async getChannel(channelId: string): Promise<Channel> {
    return this.manager.rpc<Channel>('channels.get', { channelId });
  }

  /**
   * Connect a channel
   */
  async connectChannel(channelId: string): Promise<void> {
    return this.manager.rpc<void>('channels.connect', { channelId });
  }

  /**
   * Disconnect a channel
   */
  async disconnectChannel(channelId: string): Promise<void> {
    return this.manager.rpc<void>('channels.disconnect', { channelId });
  }

  /**
   * Get QR code for channel connection (e.g., WhatsApp)
   */
  async getChannelQRCode(channelType: ChannelType): Promise<string> {
    return this.manager.rpc<string>('channels.getQRCode', { channelType });
  }

  // ==================== Skill Methods ====================

  /**
   * List all skills
   */
  async listSkills(): Promise<Skill[]> {
    return this.manager.rpc<Skill[]>('skills.list');
  }

  /**
   * Enable a skill
   */
  async enableSkill(skillId: string): Promise<void> {
    return this.manager.rpc<void>('skills.enable', { skillId });
  }

  /**
   * Disable a skill
   */
  async disableSkill(skillId: string): Promise<void> {
    return this.manager.rpc<void>('skills.disable', { skillId });
  }

  /**
   * Get skill configuration
   */
  async getSkillConfig(skillId: string): Promise<Record<string, unknown>> {
    return this.manager.rpc<Record<string, unknown>>('skills.getConfig', { skillId });
  }

  /**
   * Update skill configuration
   */
  async updateSkillConfig(skillId: string, config: Record<string, unknown>): Promise<void> {
    return this.manager.rpc<void>('skills.updateConfig', { skillId, config });
  }

  // ==================== Chat Methods ====================

  /**
   * Send a chat message
   */
  async sendMessage(content: string, channelId?: string): Promise<ChatMessage> {
    return this.manager.rpc<ChatMessage>('chat.send', { content, channelId });
  }

  /**
   * Get chat history
   */
  async getChatHistory(limit = 50, offset = 0): Promise<ChatMessage[]> {
    return this.manager.rpc<ChatMessage[]>('chat.history', { limit, offset });
  }

  /**
   * Clear chat history
   */
  async clearChatHistory(): Promise<void> {
    return this.manager.rpc<void>('chat.clear');
  }

  // ==================== Cron Methods ====================

  /**
   * List all cron tasks
   */
  async listCronTasks(): Promise<CronTask[]> {
    return this.manager.rpc<CronTask[]>('cron.list');
  }

  /**
   * Create a new cron task
   */
  async createCronTask(task: Omit<CronTask, 'id' | 'status'>): Promise<CronTask> {
    return this.manager.rpc<CronTask>('cron.create', task);
  }

  /**
   * Update a cron task
   */
  async updateCronTask(taskId: string, updates: Partial<CronTask>): Promise<CronTask> {
    return this.manager.rpc<CronTask>('cron.update', { taskId, ...updates });
  }

  /**
   * Delete a cron task
   */
  async deleteCronTask(taskId: string): Promise<void> {
    return this.manager.rpc<void>('cron.delete', { taskId });
  }

  /**
   * Run a cron task immediately
   */
  async runCronTask(taskId: string): Promise<void> {
    return this.manager.rpc<void>('cron.run', { taskId });
  }

  // ==================== Provider Methods ====================

  /**
   * List configured AI providers
   */
  async listProviders(): Promise<ProviderConfig[]> {
    return this.manager.rpc<ProviderConfig[]>('providers.list');
  }

  /**
   * Add or update a provider
   */
  async setProvider(provider: ProviderConfig): Promise<void> {
    return this.manager.rpc<void>('providers.set', provider);
  }

  /**
   * Remove a provider
   */
  async removeProvider(providerId: string): Promise<void> {
    return this.manager.rpc<void>('providers.remove', { providerId });
  }

  /**
   * Test provider connection
   */
  async testProvider(providerId: string): Promise<{ success: boolean; error?: string }> {
    return this.manager.rpc<{ success: boolean; error?: string }>('providers.test', { providerId });
  }

  // ==================== System Methods ====================

  /**
   * Get Gateway health status
   */
  async getHealth(): Promise<{ status: string; uptime: number; version?: string }> {
    return this.manager.rpc<{ status: string; uptime: number; version?: string }>('system.health');
  }

  /**
   * Get Gateway configuration
   */
  async getConfig(): Promise<Record<string, unknown>> {
    return this.manager.rpc<Record<string, unknown>>('system.config');
  }

  /**
   * Update Gateway configuration
   */
  async updateConfig(config: Record<string, unknown>): Promise<void> {
    return this.manager.rpc<void>('system.updateConfig', config);
  }

  /**
   * Get Gateway version info
   */
  async getVersion(): Promise<{ version: string; nodeVersion?: string; platform?: string }> {
    return this.manager.rpc<{ version: string; nodeVersion?: string; platform?: string }>('system.version');
  }

  /**
   * Get available skill bundles
   */
  async getSkillBundles(): Promise<SkillBundle[]> {
    return this.manager.rpc<SkillBundle[]>('skills.bundles');
  }

  /**
   * Install a skill bundle
   */
  async installBundle(bundleId: string): Promise<void> {
    return this.manager.rpc<void>('skills.installBundle', { bundleId });
  }
}
