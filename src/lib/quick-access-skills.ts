import { hostApi } from '@/lib/host-api';
import type { QuickAccessSkill } from '@/types/skill';

export async function fetchQuickAccessSkills(input: {
  workspace?: string;
  agentDir?: string;
}): Promise<{ success: boolean; skills?: QuickAccessSkill[]; error?: string }> {
  return hostApi.skills.quickAccess(input);
}
