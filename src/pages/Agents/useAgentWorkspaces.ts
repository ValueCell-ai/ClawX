import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary } from '@/types/agent';
import { loadAgentWorkspace, type AgentWorkspaceSnapshot } from '@/lib/agent-workspace';

export function useAgentWorkspaces(agents: AgentSummary[]) {
  const [snapshots, setSnapshots] = useState<Record<string, AgentWorkspaceSnapshot>>({});
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Keep file reads bounded even for a large configured roster.
      for (let offset = 0; offset < agents.length; offset += 4) {
        const batch = await Promise.all(agents.slice(offset, offset + 4).map(async agent => {
          try { return [agent.id, await loadAgentWorkspace(agent.workspace)] as const; }
          catch { return [agent.id, { workspace: agent.workspace, instructions: null, readOnly: true, files: [], error: 'unavailable' }] as const; }
        }));
        if (cancelled) return;
        setSnapshots(current => ({ ...current, ...Object.fromEntries(batch) }));
      }
    })();
    return () => { cancelled = true; };
  }, [agents, revision]);
  return { snapshots, refresh };
}
