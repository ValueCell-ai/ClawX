import { hostApiFetch } from '@/lib/host-api';
import type {
  ProviderAccount,
  ProviderType,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';

export interface ProviderSnapshot {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
}

export interface ProviderListItem {
  account: ProviderAccount;
  vendor?: ProviderVendorInfo;
  status?: ProviderWithKeyInfo;
}

export interface ProviderAccountKeyInfo {
  accountId: string;
  hasKey: boolean;
  keyMasked: string | null;
}

/**
 * Build the legacy `ProviderWithKeyInfo` shape (`ProviderConfig & { hasKey, keyMasked }`)
 * from a `ProviderAccount` and its associated key metadata.
 *
 * The renderer keeps emitting this shape via `useProviderStore.statuses` for
 * backward compatibility with consumers (e.g. `pages/Agents/index.tsx`,
 * `buildProviderListItems`) that look up a status entry by accountId.
 *
 * Equivalent to the backend's `providerAccountToConfig` + `hasKey/keyMasked`
 * augmentation, kept in lockstep so renderer-side derivation matches the
 * legacy `/api/providers` payload.
 */
export function accountToProviderWithKeyInfo(
  account: ProviderAccount,
  keyInfo: { hasKey: boolean; keyMasked: string | null } | undefined,
): ProviderWithKeyInfo {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    hasKey: keyInfo?.hasKey ?? false,
    keyMasked: keyInfo?.keyMasked ?? null,
  };
}

/**
 * Backward-compat helper for older fixtures and any external callers still
 * publishing `ProviderWithKeyInfo[]` payloads via the legacy `/api/providers`
 * route.
 */
function fallbackStatusToAccount(status: ProviderWithKeyInfo): ProviderAccount {
  return {
    id: status.id,
    vendorId: status.type,
    label: status.name,
    authMode: status.type === 'ollama' ? 'local' : 'api_key',
    baseUrl: status.baseUrl,
    apiProtocol: status.apiProtocol,
    headers: status.headers,
    model: status.model,
    fallbackModels: status.fallbackModels,
    fallbackAccountIds: status.fallbackProviderIds,
    enabled: status.enabled,
    isDefault: false,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
  };
}

/**
 * `hostApiFetch` returns the response body even on non-2xx HTTP status, so
 * a 404 from the Host API surfaces as `{ success: false, error: "No route
 * for GET ..." }` rather than a thrown error. Detect that shape so we can
 * trigger the legacy fallback path when an older Host API build is missing
 * the new account-companion routes (key-info, validate, oauth, api-key).
 */
function isRouteNotFoundBody(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.success !== false) return false;
  const error = record.error;
  return typeof error === 'string' && /no\s+route\s+for/i.test(error);
}

export function isHostApiRouteMissing(value: unknown): boolean {
  return isRouteNotFoundBody(value);
}

export async function fetchProviderSnapshot(): Promise<ProviderSnapshot> {
  // Primary path: read everything from the new /api/provider-accounts surface.
  const [accountsResult, keyInfoResult, vendors, defaultInfo] = await Promise.all([
    hostApiFetch<ProviderAccount[]>('/api/provider-accounts'),
    hostApiFetch<ProviderAccountKeyInfo[] | { success: false; error: string }>('/api/provider-accounts/key-info').catch(() => null),
    hostApiFetch<ProviderVendorInfo[]>('/api/provider-vendors'),
    hostApiFetch<{ accountId: string | null }>('/api/provider-accounts/default'),
  ]);

  let accounts = accountsResult ?? [];
  let statuses: ProviderWithKeyInfo[];

  // Treat a missing-route response body the same as a thrown error so
  // older Host API builds without the key-info endpoint still degrade
  // gracefully via the legacy /api/providers fallback below.
  const newKeyInfoAvailable = Array.isArray(keyInfoResult);

  if (newKeyInfoAvailable) {
    const keyInfoMap = new Map(
      keyInfoResult.map((entry) => [entry.accountId, entry] as const),
    );
    statuses = accounts.map((account) => accountToProviderWithKeyInfo(account, keyInfoMap.get(account.id)));
  } else {
    // ── Backward-compat fallback ────────────────────────────────────
    // Talking to an older Host API (no /api/provider-accounts/key-info
    // route). Use the legacy /api/providers payload as the status source
    // and synthesise accounts from it when the accounts list is empty
    // (e.g. pre-migration installs).
    const legacyStatusesRaw = await hostApiFetch<ProviderWithKeyInfo[] | { success: false; error: string }>('/api/providers').catch(() => null);
    const legacyStatuses = Array.isArray(legacyStatusesRaw) ? legacyStatusesRaw : [];
    statuses = legacyStatuses;
    if (accounts.length === 0 && legacyStatuses.length > 0) {
      accounts = legacyStatuses.map(fallbackStatusToAccount);
    }
  }

  return {
    accounts,
    statuses,
    vendors,
    defaultAccountId: defaultInfo.accountId,
  };
}

export function hasConfiguredCredentials(
  account: ProviderAccount,
  status?: ProviderWithKeyInfo,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return status?.hasKey ?? false;
}

export function pickPreferredAccount(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
  vendorId: ProviderType | string,
  statusMap: Map<string, ProviderWithKeyInfo>,
): ProviderAccount | null {
  const sameVendor = accounts.filter((account) => account.vendorId === vendorId);
  if (sameVendor.length === 0) return null;

  return (
    (defaultAccountId ? sameVendor.find((account) => account.id === defaultAccountId) : undefined)
    || sameVendor.find((account) => hasConfiguredCredentials(account, statusMap.get(account.id)))
    || sameVendor[0]
  );
}

export function buildProviderAccountId(
  vendorId: ProviderType,
  existingAccountId: string | null,
  vendors: ProviderVendorInfo[],
): string {
  if (existingAccountId) {
    return existingAccountId;
  }

  const vendor = vendors.find((candidate) => candidate.id === vendorId);
  return vendor?.supportsMultipleAccounts ? `${vendorId}-${crypto.randomUUID()}` : vendorId;
}

export function legacyProviderToAccount(provider: ProviderWithKeyInfo): ProviderAccount {
  return {
    id: provider.id,
    vendorId: provider.type,
    label: provider.name,
    authMode: provider.type === 'ollama' ? 'local' : 'api_key',
    baseUrl: provider.baseUrl,
    headers: provider.headers,
    model: provider.model,
    fallbackModels: provider.fallbackModels,
    fallbackAccountIds: provider.fallbackProviderIds,
    enabled: provider.enabled,
    isDefault: false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function buildProviderListItems(
  accounts: ProviderAccount[],
  statuses: ProviderWithKeyInfo[],
  vendors: ProviderVendorInfo[],
  defaultAccountId: string | null,
): ProviderListItem[] {
  const safeAccounts = accounts ?? [];
  const safeStatuses = statuses ?? [];
  const safeVendors = vendors ?? [];
  const vendorMap = new Map(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusMap = new Map(safeStatuses.map((status) => [status.id, status]));

  if (safeAccounts.length > 0) {
    return safeAccounts
      .map((account) => ({
        account,
        vendor: vendorMap.get(account.vendorId),
        status: statusMap.get(account.id),
      }))
      .sort((left, right) => {
        if (left.account.id === defaultAccountId) return -1;
        if (right.account.id === defaultAccountId) return 1;
        return right.account.updatedAt.localeCompare(left.account.updatedAt);
      });
  }

  return safeStatuses.map((status) => ({
    account: legacyProviderToAccount(status),
    vendor: vendorMap.get(status.type),
    status,
  }));
}
