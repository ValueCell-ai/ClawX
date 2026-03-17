export type SkillOverride = {
  enabled?: string[];
  disabled?: string[];
};

export type SkillPolicy = {
  globalEnabled: string[];
  agentOverrides: Record<string, SkillOverride>;
};

export type SkillPolicyResponse = {
  success: boolean;
  policy: SkillPolicy;
  effective?: string[];
};
