// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildExternalGateHandoff,
  parseArgs,
  toJson,
  toJsonPayload,
  toMarkdown,
  writeHandoff,
} from '../../scripts/cc-connect-real-gate-handoff.mjs';

const partialReport = {
  generatedAt: '2026-06-27T23:54:28.368Z',
  status: 'partial',
  runtimeMatrixStatus: 'partial',
  replacementReadiness: {
    replacementReady: false,
  },
  missingPreconditions: [
    { id: 'openai-api-key-env' },
    { id: 'feishu-env' },
    { id: 'feishu-inbound-fixture' },
  ],
  checks: [
    {
      id: 'codex-oauth-auth-json',
      status: 'pass',
      details: {
        tokenPath: '/tmp/fixture/auth.json',
        access_token: 'must-not-leak',
        refresh_token: 'must-not-leak',
      },
    },
  ],
  coverage: [
    {
      id: 'openai-api-key-provider-model-chat',
      status: 'skipped',
      reason: 'OPENAI_API_KEY is not configured.',
    },
    {
      id: 'feishu-live-channel-lifecycle',
      status: 'skipped',
      reason: 'Feishu/Lark credentials are not configured.',
    },
    {
      id: 'feishu-live-inbound-delivery',
      status: 'skipped',
      reason: 'Feishu/Lark inbound fixture is not enabled.',
    },
  ],
};

describe('cc-connect real gate handoff', () => {
  it('parses default and explicit report/output paths', () => {
    expect(parseArgs([])).toMatchObject({
      reportPath: expect.stringContaining('artifacts/cc-connect/local-real-validation-report.json'),
      outputPath: expect.stringContaining('artifacts/cc-connect/local-real-external-gates.md'),
      jsonOutputPath: expect.stringContaining('artifacts/cc-connect/local-real-external-gates.json'),
    });
    expect(parseArgs(['--report=/tmp/report.json', '--output=/tmp/handoff.md'])).toMatchObject({
      reportPath: '/tmp/report.json',
      outputPath: '/tmp/handoff.md',
      jsonOutputPath: '/tmp/handoff.json',
    });
    expect(parseArgs(['--output=/tmp/handoff.md', '--json-output=/tmp/machine.json'])).toMatchObject({
      outputPath: '/tmp/handoff.md',
      jsonOutputPath: '/tmp/machine.json',
    });
    expect(parseArgs(['--json-output=/tmp/machine.json', '--output=/tmp/handoff.md'])).toMatchObject({
      outputPath: '/tmp/handoff.md',
      jsonOutputPath: '/tmp/machine.json',
    });
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
  });

  it('builds external gate handoff rows from a partial report', () => {
    expect(buildExternalGateHandoff(partialReport)).toEqual([
      expect.objectContaining({
        id: 'openai-api-key-provider-model-chat',
        currentStatus: 'skipped',
        missingPreconditions: ['openai-api-key-env'],
        command: 'pnpm run verify:cc-connect:local-real:api-key',
      }),
      expect.objectContaining({
        id: 'feishu-live-channel-lifecycle',
        currentStatus: 'skipped',
        missingPreconditions: ['feishu-env'],
        command: 'pnpm run verify:cc-connect:local-real:feishu',
      }),
      expect.objectContaining({
        id: 'feishu-live-inbound-delivery',
        currentStatus: 'skipped',
        missingPreconditions: ['feishu-env', 'feishu-inbound-fixture'],
        command: 'pnpm run verify:cc-connect:local-real:feishu-inbound',
      }),
    ]);
  });

  it('renders a credential-free markdown handoff', () => {
    const markdown = toMarkdown(partialReport);

    expect(markdown).toContain('# cc-connect External Gate Handoff');
    expect(markdown).toContain('pnpm run verify:cc-connect:local-real:external-gates:check');
    expect(markdown).toContain('pnpm run verify:cc-connect:local-real:external-gates');
    expect(markdown).toContain('| Gate | Current Status | Missing Preconditions | Command | Required Inputs | Optional Inputs |');
    expect(markdown).toContain('CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY');
    expect(markdown).toContain('CLAWX_REAL_FEISHU_APP_SECRET');
    expect(markdown).toContain('artifacts/cc-connect/feishu-inbound-marker.json');
    expect(markdown).toContain('Do not add real API keys, OAuth tokens, app secrets');
    expect(markdown).not.toContain('must-not-leak');
    expect(markdown).not.toContain('access_token');
    expect(markdown).not.toContain('refresh_token');
  });

  it('renders a credential-free machine-readable JSON handoff', () => {
    const payload = toJsonPayload(partialReport);
    const serialized = toJson(partialReport);

    expect(payload).toMatchObject({
      schemaVersion: 1,
      sourceReport: {
        generatedAt: '2026-06-27T23:54:28.368Z',
        status: 'partial',
        runtimeMatrixStatus: 'partial',
        replacementReady: false,
      },
      commands: {
        nonDestructiveCheck: 'pnpm run verify:cc-connect:local-real:external-gates:check',
        reportWritingRerun: 'pnpm run verify:cc-connect:local-real:external-gates',
      },
      requiredExternalGates: [
        expect.objectContaining({
          id: 'openai-api-key-provider-model-chat',
          requiredInputs: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
        }),
        expect.objectContaining({
          id: 'feishu-live-channel-lifecycle',
          missingPreconditions: ['feishu-env'],
        }),
        expect.objectContaining({
          id: 'feishu-live-inbound-delivery',
          missingPreconditions: ['feishu-env', 'feishu-inbound-fixture'],
        }),
      ],
      safety: {
        sanitized: true,
      },
    });
    expect(serialized).toContain('verify:cc-connect:local-real:external-gates:check');
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
  });

  it('writes the handoff artifact next to the sanitized validation report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-cc-connect-handoff-'));
    try {
      const reportPath = join(root, 'report.json');
      const outputPath = join(root, 'handoff.md');
      const jsonOutputPath = join(root, 'handoff.json');
      await writeFile(reportPath, JSON.stringify(partialReport), 'utf8');

      const result = await writeHandoff(reportPath, outputPath);
      const written = await readFile(outputPath, 'utf8');
      const writtenJson = await readFile(jsonOutputPath, 'utf8');

      expect(result.outputPath).toBe(outputPath);
      expect(result.jsonOutputPath).toBe(jsonOutputPath);
      expect(written).toBe(result.markdown);
      expect(writtenJson).toBe(result.json);
      expect(written).toContain('Replacement ready: no');
      expect(written).not.toContain('must-not-leak');
      expect(writtenJson).toContain('"schemaVersion": 1');
      expect(writtenJson).not.toContain('must-not-leak');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
