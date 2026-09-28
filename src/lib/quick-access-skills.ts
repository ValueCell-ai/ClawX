import { hostApi } from '@/lib/host-api';
import type { QuickAccessSkill } from '@/types/skill';

type SkillContext = { workspace?: string; agentDir?: string };
type SkillResult = { success: boolean; skills?: QuickAccessSkill[]; error?: string };
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { skills: QuickAccessSkill[]; expiresAt: number }>();
const pending = new Map<string, Promise<SkillResult>>();
let revision = 0;
const contextKey = (input: SkillContext) => JSON.stringify([input.workspace ?? '', input.agentDir ?? '']);

export function invalidateQuickAccessSkills(): void {
  revision += 1;
  cache.clear();
  pending.clear();
}

export function getCachedQuickAccessSkills(input: SkillContext): QuickAccessSkill[] | undefined {
  const entry = cache.get(contextKey(input));
  return entry && entry.expiresAt > Date.now() ? entry.skills : undefined;
}

export async function fetchQuickAccessSkills(
  input: SkillContext,
  { preferCache = false }: { preferCache?: boolean } = {},
): Promise<SkillResult> {
  const key = contextKey(input);
  const cached = preferCache ? getCachedQuickAccessSkills(input) : undefined;
  if (cached) return { success: true, skills: cached };
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const requestRevision = revision;
  const request = hostApi.skills.quickAccess(input);
  pending.set(key, request);
  try {
    const result = await request;
    if (revision === requestRevision) {
      if (result.success) {
        for (const [entryKey, entry] of cache) {
          if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
        }
        cache.set(key, { skills: result.skills ?? [], expiresAt: Date.now() + CACHE_TTL_MS });
      } else {
        cache.delete(key);
      }
    }
    return result;
  } catch (error) {
    if (revision === requestRevision) cache.delete(key);
    throw error;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}
