// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Producer {
  role: string;
  agent_id: string;
  schema_version: number;
  app_version: string | null;
  created_at: number;
  updated_at: number;
}

const stableProducer: Producer = {
  role: 'agent', agent_id: 'main', schema_version: 25,
  app_version: '2026.10.5', created_at: 1794210937057, updated_at: 1794210937057,
};
const bundle = readFileSync(path.resolve(import.meta.dirname,
  '../../node_modules/openclaw/dist/doctor-agent-deletion-journal-m5o6mZHM.mjs'), 'utf8');
const start = bundle.indexOf('const AFFECTED_AGENT_SCHEMAS =');
const end = bundle.indexOf('function inspectProducer(', start);

function readProducer(row: Producer, userVersion = row.schema_version): unknown {
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  // Execute the actual bundled eligibility helper. The database adapter only
  // supplies the schema_meta row and the independently read PRAGMA user_version.
  const query = { selectAll: () => query, where: () => query };
  const context = {
    getNodeSqliteKysely: () => ({ selectFrom: () => query }),
    executeSqliteQueryTakeFirstSync: () => row,
    readSqliteUserVersion: () => userVersion,
    isReservedSystemAgentId: () => false,
    readProducer: undefined as undefined | ((database: unknown, agentId: string) => unknown),
  };
  runInNewContext(`${bundle.slice(start, end)}\nglobalThis.readProducer = readAffectedProducer;`, context);
  return context.readProducer!({}, 'main');
}

describe('OpenClaw missing-journal producer eligibility', () => {
  it.each(['2026.10.5', '2026.10.5-beta.4'])('accepts untouched schema 25 from %s', (version) => {
    const row = { ...stableProducer, app_version: version };
    expect(readProducer(row)).toBe(row);
  });

  it.each([
    ['unrecognized version', { app_version: '2026.10.6' }],
    ['missing version', { app_version: null }],
    ['wrong schema', { schema_version: 24 }],
    ['global ownership', { role: 'global' }],
    ['another agent', { agent_id: 'another' }],
    ['changed producer metadata', { updated_at: stableProducer.updated_at + 1 }],
    ['invalid creation timestamp', { created_at: 0, updated_at: 0 }],
  ] satisfies [string, Partial<Producer>][])('rejects %s', (_label, change) => {
    expect(readProducer({ ...stableProducer, ...change })).toBeUndefined();
  });

  it('rejects a PRAGMA version that disagrees with producer metadata', () => {
    expect(readProducer(stableProducer, 24)).toBeUndefined();
  });
});
