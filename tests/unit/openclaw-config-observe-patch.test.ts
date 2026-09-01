// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

interface ConfigObserveHelpers {
  resolveCanonicalConfigBytes: (raw: string, parsed: object) => number;
  resolveConfigObserveSuspiciousReasons: (params: {
    bytes: number;
    canonicalBytes: number;
    hasMeta: boolean;
    gatewayMode: string | null;
    parsed: object;
    lastKnownGood: {
      bytes: number;
      canonicalBytes: number;
      hasMeta: boolean;
      gatewayMode: string | null;
    };
  }) => string[];
}

function extractFunction(source: string, name: string): string {
  const match = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(source);
  if (!match) throw new Error(`Missing patched function: ${name}`);
  return match[0];
}

async function loadPatchedSizeHelpers(): Promise<ConfigObserveHelpers> {
  const source = await readFile(
    path.join(root, 'node_modules/openclaw/dist/io-By0s-a_s.js'),
    'utf8',
  );
  const context = { Buffer } as Record<string, unknown>;

  runInNewContext(
    `
      const isRecord$1 = (value) =>
        value !== null && typeof value === "object" && !Array.isArray(value);
      ${extractFunction(source, 'resolveCanonicalConfigBytes')}
      ${extractFunction(source, 'resolveConfigObserveSuspiciousReasons')}
      globalThis.helpers = {
        resolveCanonicalConfigBytes,
        resolveConfigObserveSuspiciousReasons,
      };
    `,
    context,
  );

  return context.helpers as ConfigObserveHelpers;
}

describe('OpenClaw config observe patch', () => {
  it('records the canonical-size comparison in the pinned runtime patch', async () => {
    const patch = await readFile(
      path.join(root, 'patches/openclaw@2026.7.1-2.patch'),
      'utf8',
    );

    expect(patch).toContain(
      'const baselineBytes = baseline.canonicalBytes ?? baseline.bytes',
    );
    expect(patch).toContain(
      'canonicalBytes: resolveCanonicalConfigBytes(snapshot.raw, snapshot.parsed)',
    );
    expect(patch).toContain(
      "backupFingerprint?.hash === entry.lastKnownGood?.hash",
    );
    expect(patch).toContain(
      'left.canonicalBytes === right.canonicalBytes',
    );
  });

  it('ignores formatting-only shrinkage but detects canonical truncation', async () => {
    const {
      resolveCanonicalConfigBytes,
      resolveConfigObserveSuspiciousReasons,
    } = await loadPatchedSizeHelpers();
    const fullConfig = {
      meta: { lastTouchedVersion: '2026.7.1-2' },
      gateway: { mode: 'local' },
      agents: {
        list: Array.from({ length: 30 }, (_, index) => ({
          id: `agent-${index}`,
          name: `Agent ${index}`,
          model: `provider/model-${index}`,
        })),
      },
    };
    const canonicalRaw = `${JSON.stringify(fullConfig, null, 2)}\n`;
    const formattedRaw = `// retained user comments\n${' '.repeat(12_000)}${canonicalRaw}`;
    const baseline = {
      bytes: Buffer.byteLength(formattedRaw),
      canonicalBytes: resolveCanonicalConfigBytes(formattedRaw, fullConfig),
      hasMeta: true,
      gatewayMode: null,
    };

    expect(
      resolveConfigObserveSuspiciousReasons({
        bytes: Buffer.byteLength(canonicalRaw),
        canonicalBytes: resolveCanonicalConfigBytes(canonicalRaw, fullConfig),
        hasMeta: true,
        gatewayMode: null,
        parsed: fullConfig,
        lastKnownGood: baseline,
      }),
    ).toEqual([]);

    const truncated = {
      meta: fullConfig.meta,
      gateway: fullConfig.gateway,
    };
    const truncatedRaw = `${JSON.stringify(truncated, null, 2)}\n`;
    expect(
      resolveConfigObserveSuspiciousReasons({
        bytes: Buffer.byteLength(truncatedRaw),
        canonicalBytes: resolveCanonicalConfigBytes(truncatedRaw, truncated),
        hasMeta: true,
        gatewayMode: null,
        parsed: truncated,
        lastKnownGood: baseline,
      }),
    ).toContain(
      `size-drop-vs-last-good:${baseline.bytes}->${Buffer.byteLength(truncatedRaw)}`,
    );
  });
});
