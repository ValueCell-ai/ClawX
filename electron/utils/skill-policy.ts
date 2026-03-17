import { getSetting, setSetting } from './store';

export type SkillPolicyAgentOverride = {
  enabled?: string[];
  disabled?: string[];
};

export type SkillPolicy = {
  globalEnabled: string[];
  agentOverrides: Record<string, SkillPolicyAgentOverride>;
};

const EMPTY_POLICY: SkillPolicy = {
  globalEnabled: [],
  agentOverrides: {},
};

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function normalizeOverride(input: unknown): SkillPolicyAgentOverride {
  if (!input || typeof input !== 'object') {
    return { enabled: [], disabled: [] };
  }
  const raw = input as SkillPolicyAgentOverride;
  const enabled = normalizeStringArray(raw.enabled);
  const enabledSet = new Set(enabled);
  const disabled = normalizeStringArray(raw.disabled).filter((key) => !enabledSet.has(key));
  return { enabled, disabled };
}

function normalizePolicy(input: unknown): SkillPolicy {
  if (!input || typeof input !== 'object') {
    return { ...EMPTY_POLICY };
  }
  const raw = input as Partial<SkillPolicy>;
  const agentOverrides: Record<string, SkillPolicyAgentOverride> = {};
  if (raw.agentOverrides && typeof raw.agentOverrides === 'object') {
    for (const [agentId, value] of Object.entries(raw.agentOverrides)) {
      const key = agentId.trim();
      if (!key) continue;
      agentOverrides[key] = normalizeOverride(value);
    }
  }
  return {
    globalEnabled: normalizeStringArray(raw.globalEnabled),
    agentOverrides,
  };
}

export function computeEffectiveSkills(policy: SkillPolicy, agentId: string): string[] {
  const normalized = normalizePolicy(policy);
  const id = agentId.trim();
  if (!id) return normalized.globalEnabled;
  const override = normalized.agentOverrides[id];
  if (!override) return normalized.globalEnabled;

  const disabledSet = new Set(override.disabled || []);
  const effective = normalized.globalEnabled.filter((key) => !disabledSet.has(key));
  const included = new Set(effective);
  for (const key of override.enabled || []) {
    if (included.has(key)) continue;
    included.add(key);
    effective.push(key);
  }
  return effective;
}

function derivePolicyFromLegacySettings(current: SkillPolicy, legacyEnabled: string[], legacyDisabled: string[]): SkillPolicy {
  if (current.globalEnabled.length > 0 || Object.keys(current.agentOverrides).length > 0) {
    return current;
  }

  const disabledSet = new Set(legacyDisabled);
  return {
    ...current,
    globalEnabled: legacyEnabled.filter((key) => !disabledSet.has(key)),
  };
}

async function writePolicy(policy: SkillPolicy): Promise<SkillPolicy> {
  await setSetting('skillPolicy', policy);
  await setSetting('skillPolicyInitialized', true);
  return policy;
}

export async function readSkillPolicy(): Promise<SkillPolicy> {
  const [rawPolicy, initialized, legacyEnabledRaw, legacyDisabledRaw] = await Promise.all([
    getSetting('skillPolicy'),
    getSetting('skillPolicyInitialized'),
    getSetting('enabledSkills'),
    getSetting('disabledSkills'),
  ]);

  let policy = normalizePolicy(rawPolicy);
  if (!initialized) {
    policy = derivePolicyFromLegacySettings(
      policy,
      normalizeStringArray(legacyEnabledRaw),
      normalizeStringArray(legacyDisabledRaw),
    );
    await writePolicy(policy);
  }
  return policy;
}

export async function updateSkillPolicyGlobal(globalEnabled: string[]): Promise<SkillPolicy> {
  const policy = await readSkillPolicy();
  const next: SkillPolicy = {
    ...policy,
    globalEnabled: normalizeStringArray(globalEnabled),
  };
  return await writePolicy(next);
}

export async function updateSkillPolicyAgentOverride(
  agentId: string,
  patch: SkillPolicyAgentOverride,
): Promise<SkillPolicy> {
  const id = agentId.trim();
  if (!id) {
    throw new Error('agentId is required');
  }

  const policy = await readSkillPolicy();
  const override = normalizeOverride(patch);
  const agentOverrides = { ...policy.agentOverrides };
  const hasEnabled = (override.enabled || []).length > 0;
  const hasDisabled = (override.disabled || []).length > 0;

  if (!hasEnabled && !hasDisabled) {
    delete agentOverrides[id];
  } else {
    agentOverrides[id] = override;
  }

  return await writePolicy({
    ...policy,
    agentOverrides,
  });
}
