/**
 * The bundled runtime owns persistence contracts. Resolve from extraResources in
 * packaged builds, never from the asar's dependencies. Private schema helpers
 * are isolated here and checked by real-runtime tests whenever OpenClaw changes.
 */
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getOpenClawResolvedDir } from './paths';

function loadSchemaHelper<T>(name: string): T {
  const root = getOpenClawResolvedDir();
  const requireRuntime = createRequire(join(root, 'package.json'));
  const candidates = readdirSync(join(root, 'dist'))
    .filter(file => /^openclaw-agent-db-schema-helpers-.*\.mjs$/.test(file));
  for (const file of candidates) {
    const module = requireRuntime(join(root, 'dist', file)) as Record<string, unknown>;
    const fn = Object.values(module).find(value => typeof value === 'function' && value.name === name);
    if (fn) return fn as T;
  }
  throw new Error(`Bundled OpenClaw persistence contract missing: ${name}`);
}

/** Public SDK initializer; only called for a fresh, unpublished database. */
export function initializeBundledAgentDatabase(db: DatabaseSync, pathname: string, agentId: string): void {
  const root = getOpenClawResolvedDir();
  const requireRuntime = createRequire(join(root, 'package.json'));
  const sdk = requireRuntime('openclaw/plugin-sdk/sqlite-runtime') as {
    ensureOpenClawAgentDatabaseSchema: (db: DatabaseSync, options: Record<string, unknown>) => void;
  };
  sdk.ensureOpenClawAgentDatabaseSchema(db, {
    agentId, path: pathname, register: false,
    env: { ...process.env, OPENCLAW_STATE_DIR: resolve(pathname, '../../../..') },
  });
}

export function getBundledAgentSchema(version: number): string {
  return loadSchemaHelper<(version: number) => string>('getOpenClawAgentMigrationSchema')(version);
}

/** Structural validation only: does not relabel, migrate, or repair indexes. */
export function assertBundledAgentStructure(db: DatabaseSync, pathname: string, version: number): void {
  loadSchemaHelper<(db: DatabaseSync, pathname: string, schema: string) => void>(
    'assertOpenClawAgentSchemaContains',
  )(db, pathname, getBundledAgentSchema(version));
}
