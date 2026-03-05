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
  scope: string;
  agents: AgentRow[];
}

export interface AgentCreateInput {
  name: string;
  workspace: string;
  emoji?: string;
}
