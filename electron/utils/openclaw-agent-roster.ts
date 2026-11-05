/**
 * OpenClaw 2026.10 stores the agent roster as keyed `agents.entries`; the
 * legacy `agents.list` array is still read until doctor migrates it. Returned
 * entries are the live config objects so callers can edit them in place.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface OpenClawAgentRosterEntry {
  id: string;
  entry: Record<string, unknown>;
}

export function listOpenClawAgentRosterEntries(agents: unknown): OpenClawAgentRosterEntry[] {
  if (!isRecord(agents)) return [];
  if (isRecord(agents.entries)) {
    return Object.entries(agents.entries)
      .filter((pair): pair is [string, Record<string, unknown>] => isRecord(pair[1]))
      .map(([id, entry]) => ({ id, entry }));
  }
  if (Array.isArray(agents.list)) {
    return agents.list
      .filter(isRecord)
      .map((entry) => ({ id: typeof entry.id === 'string' ? entry.id : '', entry }));
  }
  return [];
}

export function listOpenClawAgentEntryRecords(agents: unknown): Record<string, unknown>[] {
  return listOpenClawAgentRosterEntries(agents).map(({ entry }) => entry);
}
