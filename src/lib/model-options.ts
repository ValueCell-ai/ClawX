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
    if (account.vendorId === 'openai') return 'openai';
  }

  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const prefix = `${account.vendorId}-`;
    if (account.id.startsWith(prefix)) {
      const tail = account.id.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return account.id;
      }
    }

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

export function formatProviderDisplayName(
  account: ProviderAccount,
  vendorMap: Map<string, ProviderVendorInfo>,
): string {
  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    return account.label.trim() || account.vendorId;
  }

  const vendor = vendorMap.get(account.vendorId);
  return vendor?.name || account.label.trim() || account.vendorId;
}

export function formatConfiguredModelLabel(
  modelId: string,
  account: ProviderAccount,
  vendorMap: Map<string, ProviderVendorInfo>,
): string {
  const providerName = formatProviderDisplayName(account, vendorMap);
  return `${modelId} (${providerName})`;
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
  const safeAccounts = Array.isArray(providerAccounts) ? providerAccounts : [];
  const safeStatuses = Array.isArray(providerStatuses) ? providerStatuses : [];
  const safeVendors = Array.isArray(providerVendors) ? providerVendors : [];
  const vendorMap = new Map<string, ProviderVendorInfo>(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusById = new Map<string, ProviderWithKeyInfo>(safeStatuses.map((status) => [status.id, status]));
  const entries = safeAccounts
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
  providerVendors: ProviderVendorInfo[],
  providerDefaultAccountId: string | null,
): ConfiguredModelOption[] {
  const safeAccounts = Array.isArray(providerAccounts) ? providerAccounts : [];
  const safeStatuses = Array.isArray(providerStatuses) ? providerStatuses : [];
  const safeVendors = Array.isArray(providerVendors) ? providerVendors : [];
  const vendorMap = new Map<string, ProviderVendorInfo>(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusById = new Map<string, ProviderWithKeyInfo>(safeStatuses.map((status) => [status.id, status]));
  const entries = safeAccounts
    .filter((account) => {
      const hasModel = Boolean(account.model?.trim())
        || Boolean(account.metadata?.customModels?.some((modelId) => modelId.trim()));
      return account.enabled && hasModel && hasConfiguredProviderCredentials(account, statusById);
    })
    .sort((left, right) => {
      if (left.id === providerDefaultAccountId) return -1;
      if (right.id === providerDefaultAccountId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const deduped = new Map<string, ConfiguredModelOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    const modelIds = (() => {
      const configured = (account.metadata?.customModels ?? [])
        .map((modelId) => modelId.trim())
        .filter(Boolean);
      if (configured.length > 0) return configured;
      if (!account.model?.trim()) return [];
      return [
        account.model.startsWith(`${runtimeProviderKey}/`)
          ? account.model.slice(runtimeProviderKey.length + 1)
          : account.model.trim(),
      ].filter(Boolean);
    })();
    for (const modelId of modelIds) {
      const modelRef = `${runtimeProviderKey}/${modelId}`;
      if (deduped.has(modelRef)) continue;
      deduped.set(modelRef, {
        modelRef,
        label: formatConfiguredModelLabel(modelId, account, vendorMap),
        runtimeProviderKey,
        accountId: account.id,
      });
    }
  }

  return [...deduped.values()];
}

export function isConfiguredModelRefAvailable(
  modelRef: string | null | undefined,
  modelOptions: ConfiguredModelOption[],
): boolean {
  const value = (modelRef || '').trim();
  if (!value) return false;
  return modelOptions.some((option) => option.modelRef === value);
}

export function resolveConfiguredModelRef(
  preferredModelRef: string | null | undefined,
  defaultModelRef: string | null | undefined,
  modelOptions: ConfiguredModelOption[],
): string | null {
  const preferred = (preferredModelRef || '').trim();
  if (preferred && isConfiguredModelRefAvailable(preferred, modelOptions)) {
    return preferred;
  }

  const fallbackDefault = (defaultModelRef || '').trim();
  if (fallbackDefault && isConfiguredModelRefAvailable(fallbackDefault, modelOptions)) {
    return fallbackDefault;
  }

  return modelOptions[0]?.modelRef ?? null;
}
