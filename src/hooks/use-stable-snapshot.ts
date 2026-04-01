import { useEffect, useState } from 'react';

type UseStableSnapshotOptions = {
  shouldPersist: boolean;
  shouldUseStable?: boolean;
};

export function useStableSnapshot<T>(
  value: T,
  { shouldPersist, shouldUseStable = false }: UseStableSnapshotOptions,
): {
  value: T;
  stableValue: T;
  hasStableValue: boolean;
  isUsingStableValue: boolean;
} {
  const [stableValue, setStableValue] = useState(value);
  const [hasStableValue, setHasStableValue] = useState(shouldPersist);

  useEffect(() => {
    if (!shouldPersist) return;
    setStableValue(value);
    setHasStableValue(true);
  }, [shouldPersist, value]);

  const isUsingStableValue = shouldUseStable && hasStableValue;

  return {
    value: isUsingStableValue ? stableValue : value,
    stableValue,
    hasStableValue,
    isUsingStableValue,
  };
}
