/*
 * Vendored from OpenClaw Web UI on 2026-06-19.
 * Local ClawX changes must stay adapter-oriented and must not add Renderer
 * direct Gateway access.
 */

import type { ChatCoreClient } from './types';

export type ChatModelOverride = {
  kind: 'model' | 'qualified';
  value: string;
};

export type SlashCommandResult = {
  content: string;
  action?: 'refresh' | 'export' | 'new-session' | 'reset' | 'stop' | 'clear' | 'navigate-usage';
  sessionPatch?: {
    modelOverride?: ChatModelOverride | null;
  };
  trackRunId?: string;
  pendingCurrentRun?: boolean;
};

export type SlashCommandContext = {
  chatModelCatalog?: Array<{ id: string }>;
  modelCatalog?: Array<{ id: string }>;
  skills?: Array<{ name?: string; description?: string }>;
  sessionsResult?: {
    sessions?: Array<{ key?: string; model?: string; modelProvider?: string }>;
    defaults?: { model?: string };
  } | null;
  agentId?: string;
};

type SessionPatchResult = {
  resolved?: {
    model?: string;
    modelProvider?: string;
  };
};

const LOCAL_COMMANDS = [
  { name: 'help', description: 'Show available commands', args: '', category: 'general' },
  { name: 'new', description: 'Start a new session', args: '', category: 'session' },
  { name: 'reset', description: 'Reset this session', args: '', category: 'session' },
  { name: 'stop', description: 'Stop the current run', args: '', category: 'session' },
  { name: 'clear', description: 'Clear local chat view', args: '', category: 'session' },
  { name: 'compact', description: 'Compact session context', args: '', category: 'agent' },
  { name: 'model', description: 'Show or set model', args: '[model]', category: 'agent' },
  { name: 'usage', description: 'Open usage view', args: '', category: 'general' },
  { name: 'agents', description: 'List agents', args: '', category: 'agent' },
  { name: 'export-session', description: 'Export session', args: '', category: 'session' },
];

function createChatModelOverride(value: string): ChatModelOverride | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { kind: trimmed.includes('/') ? 'qualified' : 'model', value: trimmed };
}

function selectedGlobalScope(
  sessionKey: string,
  context: SlashCommandContext,
): Record<string, unknown> {
  return context.agentId ? { agentId: context.agentId, sessionKey } : { sessionKey };
}

function executeHelp(): SlashCommandResult {
  const lines = ['**Available Commands**\n'];
  let currentCategory = '';
  for (const command of LOCAL_COMMANDS) {
    if (command.category !== currentCategory) {
      currentCategory = command.category;
      lines.push(`**${currentCategory.charAt(0).toUpperCase()}${currentCategory.slice(1)}**`);
    }
    const args = command.args ? ` ${command.args}` : '';
    lines.push(`\`/${command.name}${args}\` - ${command.description}`);
  }
  return { content: lines.join('\n') };
}

async function executeCompact(
  client: ChatCoreClient,
  sessionKey: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  try {
    const result = await client.request<{
      compacted?: boolean;
      reason?: string;
      result?: { tokensBefore?: number; tokensAfter?: number };
    }>('sessions.compact', { key: sessionKey, ...selectedGlobalScope(sessionKey, context) });
    if (result?.compacted) {
      const before = result.result?.tokensBefore;
      const after = result.result?.tokensAfter;
      const tokenSummary = typeof before === 'number' && typeof after === 'number'
        ? ` (${before.toLocaleString()} -> ${after.toLocaleString()} tokens)`
        : '';
      return { content: `Context compacted successfully${tokenSummary}.`, action: 'refresh' };
    }
    if (typeof result?.reason === 'string' && result.reason.trim()) {
      return { content: `Compaction skipped: ${result.reason}`, action: 'refresh' };
    }
    return { content: 'Compaction skipped.', action: 'refresh' };
  } catch (error) {
    return { content: `Compaction failed: ${String(error)}` };
  }
}

async function executeModel(
  client: ChatCoreClient,
  sessionKey: string,
  args: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  const requestedModel = args.trim();
  if (!requestedModel) {
    const sessions = context.sessionsResult
      ?? await client.request<NonNullable<SlashCommandContext['sessionsResult']>>(
        'sessions.list',
        {},
      );
    const session = sessions?.sessions?.find((row) => row.key === sessionKey);
    const model = session?.model || sessions?.defaults?.model || 'default';
    const catalog = context.chatModelCatalog ?? context.modelCatalog ?? [];
    const lines = [`**Current model:** \`${model}\``];
    if (catalog.length > 0) {
      lines.push(`**Available:** ${catalog.slice(0, 10).map((entry) => `\`${entry.id}\``).join(', ')}`);
    }
    return { content: lines.join('\n') };
  }

  try {
    const patched = await client.request<SessionPatchResult>('sessions.patch', {
      key: sessionKey,
      ...selectedGlobalScope(sessionKey, context),
      model: requestedModel,
    });
    const resolvedModel = patched.resolved?.model ?? requestedModel;
    const resolvedProvider = patched.resolved?.modelProvider?.trim();
    const resolvedValue = resolvedProvider && !resolvedModel.includes('/')
      ? `${resolvedProvider}/${resolvedModel}`
      : resolvedModel;
    return {
      content: `Model set to \`${requestedModel}\`.`,
      action: 'refresh',
      sessionPatch: { modelOverride: createChatModelOverride(resolvedValue) },
    };
  } catch (error) {
    return { content: `Failed to set model: ${String(error)}` };
  }
}

async function executeAgents(client: ChatCoreClient): Promise<SlashCommandResult> {
  try {
    const result = await client.request<{ agents?: Array<{ id?: string; name?: string }> }>(
      'agents.list',
      {},
    );
    const agents = result.agents ?? [];
    if (agents.length === 0) return { content: 'No agents found.' };
    return {
      content: agents
        .map((agent) => `- ${agent.name ?? agent.id ?? 'agent'}${agent.id ? ` (\`${agent.id}\`)` : ''}`)
        .join('\n'),
    };
  } catch (error) {
    return { content: `Failed to list agents: ${String(error)}` };
  }
}

function executeSkills(context: SlashCommandContext): SlashCommandResult {
  const skills = context.skills ?? [];
  if (skills.length === 0) return { content: 'No skills found.' };
  return {
    content: skills
      .map((skill) => {
        const name = skill.name ?? 'skill';
        return `- \`/skill ${name}\`${skill.description ? ` - ${skill.description}` : ''}`;
      })
      .join('\n'),
  };
}

function executeSkill(args: string, context: SlashCommandContext): SlashCommandResult {
  const skillName = args.trim();
  if (!skillName) return executeSkills(context);
  const skill = (context.skills ?? []).find((item) => item.name === skillName);
  if (!skill) return { content: `Skill not found: \`${skillName}\`` };
  return {
    content: `/skill ${skillName}${skill.description ? ` - ${skill.description}` : ''}`,
  };
}

async function executeUsage(client: ChatCoreClient): Promise<SlashCommandResult> {
  try {
    const result = await client.request<Record<string, unknown>>('usage.summary', {});
    return { content: `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``, action: 'navigate-usage' };
  } catch {
    return { content: 'Opening usage view...', action: 'navigate-usage' };
  }
}

export async function executeSlashCommand(
  client: ChatCoreClient,
  sessionKey: string,
  commandName: string,
  args: string,
  context: SlashCommandContext = {},
): Promise<SlashCommandResult> {
  switch (commandName) {
    case 'help':
      return executeHelp();
    case 'new':
      return { content: 'Starting new session...', action: 'new-session' };
    case 'reset':
      return { content: 'Resetting session...', action: 'reset' };
    case 'stop':
      return { content: 'Stopping current run...', action: 'stop' };
    case 'clear':
      return { content: 'Chat history cleared.', action: 'clear' };
    case 'compact':
      return executeCompact(client, sessionKey, context);
    case 'model':
      return executeModel(client, sessionKey, args, context);
    case 'export-session':
      return { content: 'Exporting session...', action: 'export' };
    case 'usage':
      return executeUsage(client);
    case 'agents':
      return executeAgents(client);
    case 'skills':
      return executeSkills(context);
    case 'skill':
      return executeSkill(args, context);
    default:
      return { content: `Unknown command: \`/${commandName}\`` };
  }
}
