/**
 * i18n static key coverage test
 *
 * Scans renderer sources for `t('literal.key')` calls and verifies that each
 * key resolves in the English reference locale for one of the namespaces the
 * file loads through `useTranslation(...)` (or the namespace given explicitly
 * as `ns:key`). A key that resolves nowhere silently renders its English
 * `defaultValue` (or the raw key) in every locale, so zh / ja / ru users see
 * untranslated text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { I18N_RESOURCES } from '@shared/i18n/resources';

const SRC_DIR = path.resolve(__dirname, '../../src');
const REFERENCE = I18N_RESOURCES.en as Record<string, unknown>;
const PLURAL_SUFFIXES = ['', '_zero', '_one', '_two', '_few', '_many', '_other'];

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function lookup(namespace: string, key: string): boolean {
  const resource = REFERENCE[namespace];
  if (!resource || typeof resource !== 'object') return false;
  return PLURAL_SUFFIXES.some((suffix) => {
    let node: unknown = resource;
    for (const segment of `${key}${suffix}`.split('.')) {
      if (!node || typeof node !== 'object') return false;
      node = (node as Record<string, unknown>)[segment];
    }
    return node !== undefined;
  });
}

function collectNamespaces(source: string): string[] {
  const namespaces = new Set<string>();
  for (const match of source.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*')/g)) {
    for (const ns of match[1].matchAll(/'([^']+)'/g)) namespaces.add(ns[1]);
  }
  return [...namespaces];
}

describe('i18n static keys', () => {
  it('resolves every literal t() key used by components', () => {
    const unresolved: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      const source = fs.readFileSync(file, 'utf8');
      const namespaces = collectNamespaces(source);
      if (namespaces.length === 0) continue;
      for (const match of source.matchAll(/\bt\(\s*'([^'$]+)'/g)) {
        const rawKey = match[1];
        const separator = rawKey.indexOf(':');
        const resolved = separator > 0
          ? lookup(rawKey.slice(0, separator), rawKey.slice(separator + 1))
          : namespaces.some((ns) => lookup(ns, rawKey));
        if (!resolved) {
          unresolved.push(`${path.relative(SRC_DIR, file)}: ${rawKey}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });
});
