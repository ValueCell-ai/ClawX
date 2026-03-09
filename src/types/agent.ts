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
