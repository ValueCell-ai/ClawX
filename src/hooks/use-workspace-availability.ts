import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hostApi } from '@/lib/host-api';
import { isDefaultWorkspacePath } from '@/lib/workspace-context';

export type WorkspaceAvailability = 'checking' | 'available' | 'unavailable';

const MAX_CONCURRENT_CHECKS = 4;

export function useWorkspaceAvailability(paths: readonly string[]): Record<string, WorkspaceAvailability> {
  const pathsKey = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
    .filter((path) => !isDefaultWorkspacePath(path))
    .sort()
    .join('\0');
  const uniquePaths = useMemo(() => (pathsKey ? pathsKey.split('\0') : []), [pathsKey]);
  const [availability, setAvailability] = useState<Record<string, WorkspaceAvailability>>({});
  const generationRef = useRef(0);

  const validate = useCallback(async () => {
    const generation = ++generationRef.current;
    setAvailability((current) => {
      const next: Record<string, WorkspaceAvailability> = {};
      for (const path of uniquePaths) next[path] = current[path] ?? 'checking';
      return next;
    });

    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_CHECKS, uniquePaths.length) },
      async () => {
        while (nextIndex < uniquePaths.length) {
          const path = uniquePaths[nextIndex++];
          if (!path) continue;
          const result = await hostApi.files.resolveWorkspaceContext({
            workspaceRoot: path,
            executionCwd: path,
          }).catch(() => ({ ok: false }));
          if (generationRef.current !== generation) return;
          const status: WorkspaceAvailability = result.ok ? 'available' : 'unavailable';
          setAvailability((current) => (
            current[path] === status ? current : { ...current, [path]: status }
          ));
        }
      },
    );
    await Promise.all(workers);
  }, [uniquePaths]);

  useEffect(() => {
    void validate();
    const handleFocus = () => void validate();
    window.addEventListener('focus', handleFocus);
    return () => {
      generationRef.current += 1;
      window.removeEventListener('focus', handleFocus);
    };
  }, [validate]);

  return availability;
}
