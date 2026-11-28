import { useMemo } from 'react';
import { buildConfiguredModelOptions } from '@/lib/model-options';
import { useProviderStore } from '@/stores/providers';

export function useAgentModels() {
  const accounts = useProviderStore(state => state.accounts);
  const statuses = useProviderStore(state => state.statuses);
  const vendors = useProviderStore(state => state.vendors);
  const defaultAccountId = useProviderStore(state => state.defaultAccountId);
  return useMemo(
    () => buildConfiguredModelOptions(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );
}
