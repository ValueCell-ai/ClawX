/**
 * i18n locale parity test
 *
 * Verifies that every locale under `shared/i18n/locales/` exposes the same
 * namespace files and the same set of leaf keys. Also checks that
 * `{{interpolation}}` tokens used in the reference locale (English) are
 * preserved in every other locale, so we don't silently drop variables
 * like `{{error}}` or `{{name}}` during translation.
 *
 * This test is the source-of-truth check the i18n scan script relies on
 * and runs in CI to prevent locale drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REFERENCE_LOCALE = 'en';
const LOCALES_DIR = path.resolve(__dirname, '../../shared/i18n/locales');

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

function readJson(file: string): JsonObject {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as JsonObject;
}

/**
 * Find duplicate keys within the same object scope. JSON.parse silently keeps
 * only the last value for duplicated keys, so we need to scan the raw token
 * stream to catch them. Returns a list of `path.to.duplicatedKey` entries.
 */
function findDuplicateKeys(raw: string): string[] {
  const duplicates: string[] = [];
  // Stack of Map<key, count> per object scope. Arrays push `null` to skip.
  const stack: Array<Map<string, number> | null> = [];
  // Path stack mirrors stack but uses string segments for objects.
  const pathStack: string[] = [];
  let pendingKey: string | null = null;
  let i = 0;
  const n = raw.length;

  const inObject = (): boolean => stack.length > 0 && stack[stack.length - 1] !== null;

  while (i < n) {
    const ch = raw[i];
    if (ch === '"') {
      // Read string literal (handle escapes).
      const start = ++i;
      let s = '';
      while (i < n) {
        const c = raw[i];
        if (c === '\\') {
          s += raw.slice(start, i) + raw[i + 1];
          i += 2;
          continue;
        }
        if (c === '"') break;
        i += 1;
      }
      s = raw.slice(start, i).replace(/\\(.)/g, '$1');
      i += 1;
      if (inObject()) {
        let j = i;
        while (j < n && /\s/.test(raw[j])) j += 1;
        if (raw[j] === ':') {
          const scope = stack[stack.length - 1] as Map<string, number>;
          scope.set(s, (scope.get(s) ?? 0) + 1);
          if ((scope.get(s) ?? 0) > 1) {
            duplicates.push([...pathStack, s].filter(Boolean).join('.'));
          }
          pendingKey = s;
        }
      }
      continue;
    }
    if (ch === '{') {
      stack.push(new Map<string, number>());
      pathStack.push(pendingKey ?? '');
      pendingKey = null;
    } else if (ch === '[') {
      stack.push(null);
      pathStack.push(pendingKey ?? '');
      pendingKey = null;
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      pathStack.pop();
      pendingKey = null;
    } else if (ch === ',') {
      pendingKey = null;
    }
    i += 1;
  }
  return [...new Set(duplicates)].sort();
}

function listLocales(): string[] {
  return fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listNamespaces(locale: string): string[] {
  return fs
    .readdirSync(path.join(LOCALES_DIR, locale))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

function collectLeafKeys(obj: JsonValue, prefix = '', out: Set<string> = new Set()): Set<string> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out.add(prefix);
    return out;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    out.add(prefix);
    return out;
  }
  for (const key of keys) {
    const next = prefix ? `${prefix}.${key}` : key;
    collectLeafKeys((obj as JsonObject)[key], next, out);
  }
  return out;
}

function getValueAtPath(obj: JsonValue, dottedPath: string): JsonValue | undefined {
  if (!dottedPath) return obj;
  const segments = dottedPath.split('.');
  let current: JsonValue | undefined = obj;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as JsonObject)[seg];
    if (current === undefined) return undefined;
  }
  return current;
}

/** Extract `{{var}}` interpolation tokens (i18next default style). */
function extractTokens(value: JsonValue): Set<string> {
  const tokens = new Set<string>();
  const visit = (v: JsonValue): void => {
    if (typeof v === 'string') {
      const re = /\{\{\s*([^}\s]+)\s*\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v)) !== null) tokens.add(m[1]);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(visit);
    }
  };
  visit(value);
  return tokens;
}

const locales = listLocales();
const referenceNamespaces = listNamespaces(REFERENCE_LOCALE);

describe('i18n locale parity', () => {
  it('discovers at least the four shipped locales (en, zh, ja, ru)', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'zh', 'ja', 'ru']));
  });

  it.each(locales.filter((l) => l !== REFERENCE_LOCALE))(
    'locale "%s" ships the same namespace files as the reference',
    (locale) => {
      const namespaces = listNamespaces(locale);
      expect(namespaces).toEqual(referenceNamespaces);
    },
  );

  describe.each(referenceNamespaces)('namespace "%s"', (namespace) => {
    const refData = readJson(path.join(LOCALES_DIR, REFERENCE_LOCALE, `${namespace}.json`));
    const refKeys = collectLeafKeys(refData);

    it.each(locales)(
      'locale "%s" has no duplicate keys at the same object depth',
      (locale) => {
        const raw = fs.readFileSync(path.join(LOCALES_DIR, locale, `${namespace}.json`), 'utf8');
        expect(findDuplicateKeys(raw)).toEqual([]);
      },
    );

    it.each(locales.filter((l) => l !== REFERENCE_LOCALE))(
      'locale "%s" has identical leaf keys to "%s"',
      (locale) => {
        const data = readJson(path.join(LOCALES_DIR, locale, `${namespace}.json`));
        const keys = collectLeafKeys(data);
        const missing = [...refKeys].filter((k) => !keys.has(k)).sort();
        const extra = [...keys].filter((k) => !refKeys.has(k)).sort();
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      },
    );

    it.each(locales.filter((l) => l !== REFERENCE_LOCALE))(
      'locale "%s" preserves all "{{interpolation}}" tokens',
      (locale) => {
        const data = readJson(path.join(LOCALES_DIR, locale, `${namespace}.json`));
        const mismatches: Array<{ key: string; missingTokens: string[]; extraTokens: string[] }> = [];
        for (const key of refKeys) {
          if (!collectLeafKeys(data).has(key)) continue;
          const refTokens = extractTokens(getValueAtPath(refData, key) ?? '');
          const locTokens = extractTokens(getValueAtPath(data, key) ?? '');
          const missingTokens = [...refTokens].filter((t) => !locTokens.has(t)).sort();
          const extraTokens = [...locTokens].filter((t) => !refTokens.has(t)).sort();
          if (missingTokens.length || extraTokens.length) {
            mismatches.push({ key, missingTokens, extraTokens });
          }
        }
        expect(mismatches).toEqual([]);
      },
    );
  });
});
