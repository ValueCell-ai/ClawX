import type { ProviderAccount, ProviderProfileState, ProviderProfileStatus } from '../../shared/providers/types';
import { getClawXProviderStore } from './store-instance';

const PROFILE_STATES_KEY = 'providerProfileStates';
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePriority(account: ProviderAccount): number {
  return Number.isFinite(account.priority) ? Number(account.priority) : 1000;
}

async function readStates(): Promise<Record<string, ProviderProfileState>> {
  const store = await getClawXProviderStore();
  return (store.get(PROFILE_STATES_KEY) ?? {}) as Record<string, ProviderProfileState>;
}

async function writeStates(states: Record<string, ProviderProfileState>): Promise<void> {
  const store = await getClawXProviderStore();
  store.set(PROFILE_STATES_KEY, states);
}

export async function listProviderProfileStates(accounts: ProviderAccount[]): Promise<ProviderProfileState[]> {
  const states = await readStates();
  const nowTs = Date.now();
  let changed = false;

  const profileStates = accounts.map((account) => {
    const existing = states[account.id];
    const priority = normalizePriority(account);
    const cooldownActive = existing?.status === 'cooldown' && typeof existing.cooldownUntil === 'number' && existing.cooldownUntil > nowTs;

    const status: ProviderProfileStatus = cooldownActive
      ? 'cooldown'
      : (existing?.status === 'failed' || existing?.status === 'expired')
        ? existing.status
        : 'active';

    const next: ProviderProfileState = {
      accountId: account.id,
      providerKey: account.vendorId,
      priority,
      status,
      cooldownUntil: cooldownActive ? existing?.cooldownUntil : undefined,
      failureCount: existing?.failureCount ?? 0,
      lastFailureReason: existing?.lastFailureReason,
      updatedAt: existing?.updatedAt ?? nowIso(),
    };

    if (!existing || JSON.stringify(existing) !== JSON.stringify(next)) {
      states[account.id] = next;
      changed = true;
    }

    return next;
  });

  const validIds = new Set(accounts.map((account) => account.id));
  for (const accountId of Object.keys(states)) {
    if (!validIds.has(accountId)) {
      delete states[accountId];
      changed = true;
    }
  }

  if (changed) {
    await writeStates(states);
  }

  return profileStates.sort((a, b) => a.priority - b.priority || a.accountId.localeCompare(b.accountId));
}

export async function markProviderProfileFailure(
  accountId: string,
  reason: string,
  options?: { status?: Exclude<ProviderProfileStatus, 'active'>; cooldownMs?: number },
): Promise<ProviderProfileState | null> {
  const states = await readStates();
  const existing = states[accountId];
  if (!existing) return null;

  const status = options?.status ?? 'cooldown';
  const cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const nowTs = Date.now();

  const next: ProviderProfileState = {
    ...existing,
    status,
    cooldownUntil: status === 'cooldown' ? nowTs + cooldownMs : undefined,
    failureCount: existing.failureCount + 1,
    lastFailureReason: reason,
    updatedAt: nowIso(),
  };

  states[accountId] = next;
  await writeStates(states);
  return next;
}

export async function markProviderProfileSuccess(accountId: string): Promise<ProviderProfileState | null> {
  const states = await readStates();
  const existing = states[accountId];
  if (!existing) return null;

  const next: ProviderProfileState = {
    ...existing,
    status: 'active',
    cooldownUntil: undefined,
    lastFailureReason: undefined,
    updatedAt: nowIso(),
  };

  states[accountId] = next;
  await writeStates(states);
  return next;
}

export async function reorderProviderProfiles(priorities: Array<{ accountId: string; priority: number }>): Promise<void> {
  const states = await readStates();
  let changed = false;

  for (const { accountId, priority } of priorities) {
    const existing = states[accountId];
    if (!existing) continue;
    if (existing.priority !== priority) {
      states[accountId] = { ...existing, priority, updatedAt: nowIso() };
      changed = true;
    }
  }

  if (changed) {
    await writeStates(states);
  }
}
