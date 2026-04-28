import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '@/lib/providers';

export interface ConfiguredModelOption {
  modelRef: string;
  label: string;
  runtimeProviderKey: string;
  accountId: string;
}

export interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string;
  configuredModelId?: string;
}

export function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }

  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

  return account.vendorId;
}

export function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const value = (modelRef || '').trim();
  if (!value) return null;
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null;
  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

export function formatModelRefLabel(modelRef: string | null | undefined): string {
  const parsed = splitModelRef(modelRef);
  return parsed?.modelId || (modelRef || '').trim() || 'Model';
}

export function toModelOptionTestId(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

export function buildRuntimeProviderOptions(
  providerAccounts: ProviderAccount[],
  providerStatuses: ProviderWithKeyInfo[],
  providerVendors: ProviderVendorInfo[],
  providerDefaultAccountId: string | null,
): RuntimeProviderOption[] {
  const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
  const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
  const entries = providerAccounts
    .filter((account) => account.enabled && hasConfiguredProviderCredentials(account, statusById))
    .sort((left, right) => {
      if (left.id === providerDefaultAccountId) return -1;
      if (right.id === providerDefaultAccountId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const deduped = new Map<string, RuntimeProviderOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
    const vendor = vendorMap.get(account.vendorId);
    const label = `${account.label} (${vendor?.name || account.vendorId})`;
    const configuredModelId = account.model
      ? (account.model.startsWith(`${runtimeProviderKey}/`)
        ? account.model.slice(runtimeProviderKey.length + 1)
        : account.model)
      : undefined;

    deduped.set(runtimeProviderKey, {
      runtimeProviderKey,
      accountId: account.id,
      label,
      modelIdPlaceholder: vendor?.modelIdPlaceholder,
      configuredModelId,
    });
  }

  return [...deduped.values()];
}

export function buildConfiguredModelOptions(
  providerAccounts: ProviderAccount[],
  providerStatuses: ProviderWithKeyInfo[],
  providerDefaultAccountId: string | null,
): ConfiguredModelOption[] {
  const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
  const entries = providerAccounts
    .filter((account) => account.enabled && account.model?.trim() && hasConfiguredProviderCredentials(account, statusById))
    .sort((left, right) => {
      if (left.id === providerDefaultAccountId) return -1;
      if (right.id === providerDefaultAccountId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const deduped = new Map<string, ConfiguredModelOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    const modelId = account.model!.startsWith(`${runtimeProviderKey}/`)
      ? account.model!.slice(runtimeProviderKey.length + 1)
      : account.model!.trim();
    if (!modelId) continue;
    const modelRef = `${runtimeProviderKey}/${modelId}`;
    if (deduped.has(modelRef)) continue;
    deduped.set(modelRef, {
      modelRef,
      label: modelId,
      runtimeProviderKey,
      accountId: account.id,
    });
  }

  return [...deduped.values()];
}
