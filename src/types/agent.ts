export interface AgentIdentity {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

export interface AgentRow {
  id: string;
  name?: string;
  identity?: AgentIdentity;
}

export interface AgentsListResult {
  defaultId: string;
  mainKey: string;
  scope: 'per-sender' | 'global' | string;
  agents: AgentRow[];
}

export interface AgentCreateInput {
  name: string;
  workspace: string;
  emoji?: string;
  avatar?: string;
}

export interface AgentCreateResult {
  ok: true;
  agentId: string;
  name: string;
  workspace: string;
}

export interface AgentUpdateInput {
  agentId: string;
  name?: string;
  workspace?: string;
  model?: string;
}

export interface AgentDeleteInput {
  agentId: string;
  deleteFiles?: boolean;
}

export interface AgentFileEntry {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

export interface AgentsFilesListResult {
  agentId: string;
  workspace: string;
  files: AgentFileEntry[];
}

export interface AgentsFilesGetResult {
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
}

export interface AgentsFilesSetResult {
  ok: true;
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
}

export interface ModelChoice {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface ModelsListResult {
  models: ModelChoice[];
}
