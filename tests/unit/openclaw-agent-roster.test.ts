import { describe, expect, it } from 'vitest';
import {
  listOpenClawAgentEntryRecords,
  listOpenClawAgentRosterEntries,
} from '@electron/utils/openclaw-agent-roster';

describe('openclaw agent roster', () => {
  it('reads keyed agents.entries with ids from their keys', () => {
    const agents = {
      entries: {
        main: { name: 'Main' },
        coder: { name: 'Coder' },
        broken: 'not-an-entry',
      },
    };

    expect(listOpenClawAgentRosterEntries(agents)).toEqual([
      { id: 'main', entry: { name: 'Main' } },
      { id: 'coder', entry: { name: 'Coder' } },
    ]);
  });

  it('falls back to the legacy agents.list array', () => {
    const agents = { list: [{ id: 'main', default: true }, null, { id: 'coder' }] };

    expect(listOpenClawAgentRosterEntries(agents)).toEqual([
      { id: 'main', entry: { id: 'main', default: true } },
      { id: 'coder', entry: { id: 'coder' } },
    ]);
  });

  it('returns the live entry objects so callers can edit them in place', () => {
    const config = { agents: { entries: { main: { model: { primary: 'stale/model' } } } } };

    for (const entry of listOpenClawAgentEntryRecords(config.agents)) delete entry.model;

    expect(config.agents.entries.main).toEqual({});
  });

  it('treats missing or malformed rosters as empty', () => {
    expect(listOpenClawAgentEntryRecords(undefined)).toEqual([]);
    expect(listOpenClawAgentEntryRecords({ entries: [] })).toEqual([]);
  });
});
