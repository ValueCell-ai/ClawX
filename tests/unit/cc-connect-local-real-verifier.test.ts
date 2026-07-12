// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_IDS,
  REPLACEMENT_CONTRACT_ITEMS,
  REPLACEMENT_REQUIRED_COVERAGE_IDS,
  RESIDUAL_VALIDATION_GAPS,
  analyzeCcConnectCliSurface,
  buildCoverage,
  buildNextActions,
  buildReplacementContract,
  buildReplacementReadiness,
  buildValidationGaps,
  classifyCommandExit,
  codexAuthExpirySummary,
  coverageRecords,
  extraLocalRealEnvFiles,
  isPathInsideRoot,
  localEnvFileSafety,
  loadLocalEnvFiles,
  missingPreconditions,
  openAiApiKeyCandidateSummary,
  openAiApiKeyPreconditionMessage,
  parseArgs,
  replacementReadinessCheck,
  requiredCoverageCheck,
  requiredCoverageIds,
  resolveOpenAiApiKeyEnv,
  runtimeMatrixStatus,
  shouldWriteHandoff,
  shouldWriteReport,
  summarizeCommandAttempts,
  toConsoleSummaryLines,
  toMarkdown,
} from '../../scripts/verify-cc-connect-local-real.mjs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

function coverageRows(statusById: Record<string, string>) {
  return COVERAGE_IDS.map((id) => ({
    id,
    status: statusById[id] || 'pass',
    covers: [],
    evidence: `${id} evidence`,
    reason: statusById[id] === 'skipped' ? `${id} skipped` : '',
  }));
}

describe('cc-connect local real verifier', () => {
  it('does not treat an all-skipped Playwright command as real passing evidence', () => {
    expect(classifyCommandExit(0, '  2 skipped\n')).toEqual({
      status: 'skipped',
      reason: 'Test command exited successfully but executed no passing tests (2 skipped).',
    });
    expect(classifyCommandExit(0, '  3 passed\n  1 skipped\n')).toEqual({
      status: 'pass',
      reason: '',
    });
    expect(classifyCommandExit(1, '  2 skipped\n')).toEqual({
      status: 'fail',
      reason: '',
    });
    expect(classifyCommandExit(0, '\u001B[33m  2 skipped\u001B[39m\n')).toEqual({
      status: 'skipped',
      reason: 'Test command exited successfully but executed no passing tests (2 skipped).',
    });
  });

  it('parses required coverage ids from CLI flags', () => {
    expect(parseArgs(['--run', '--external-gates-only', '--include-feishu-inbound', '--require-coverage=all', '--require-replacement-ready', '--write-handoff', '--no-write'])).toMatchObject({
      run: true,
      externalGatesOnly: true,
      includeFeishuInbound: true,
      requireCoverage: ['all'],
      requireReplacementReady: true,
      writeHandoff: true,
      noWrite: true,
    });
    expect(parseArgs(['--require-coverage=oauth-core-runtime-parity,feishu-live-channel-lifecycle'])).toMatchObject({
      requireCoverage: ['oauth-core-runtime-parity', 'feishu-live-channel-lifecycle'],
    });
  });

  it('can evaluate replacement-readiness gates without overwriting saved reports', () => {
    expect(shouldWriteReport(parseArgs([]))).toBe(true);
    expect(shouldWriteReport(parseArgs(['--require-replacement-ready', '--no-write']))).toBe(false);
    expect(shouldWriteHandoff(parseArgs(['--write-handoff']))).toBe(true);
    expect(shouldWriteHandoff(parseArgs(['--write-handoff', '--no-write']))).toBe(false);
  });

  it('keeps package-level external gate scripts focused and non-destructive by default', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
    const scripts = packageJson.scripts ?? {};

    expect(scripts['verify:cc-connect:local-real:external-gates:check']).toBe([
      'node scripts/verify-cc-connect-local-real.mjs',
      '--run',
      '--external-gates-only',
      '--include-openai-api-key',
      '--include-feishu',
      '--include-feishu-inbound',
      '--require-coverage=openai-api-key-provider-model-chat,feishu-live-channel-lifecycle,feishu-live-inbound-delivery',
      '--no-write',
    ].join(' '));
    expect(scripts['verify:cc-connect:local-real:external-gates']).toBe([
      'node scripts/verify-cc-connect-local-real.mjs',
      '--run',
      '--external-gates-only',
      '--include-openai-api-key',
      '--include-feishu',
      '--include-feishu-inbound',
      '--require-coverage=openai-api-key-provider-model-chat,feishu-live-channel-lifecycle,feishu-live-inbound-delivery',
      '--write-handoff',
    ].join(' '));
    expect(scripts['verify:cc-connect:local-real:handoff']).toBe('node scripts/cc-connect-real-gate-handoff.mjs');
  });

  it('prints sanitized console summary lines for no-write gate checks', () => {
    const lines = toConsoleSummaryLines({
      missingPreconditions: [
        {
          id: 'openai-api-key-env',
          required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
          optional: ['CLAWX_REAL_OPENAI_MODEL'],
          nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
          note: 'Set key without exposing redacted-secret-value-that-must-not-leak',
        },
      ],
      replacementReadiness: {
        missingCoverage: [
          {
            id: 'openai-api-key-provider-model-chat',
            status: 'skipped',
            nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
            reason: 'CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY is not configured.',
          },
        ],
      },
      nextActions: [
        {
          id: 'configure-openai-api-key-env',
          command: 'pnpm run verify:cc-connect:local-real:api-key',
          reason: 'secret value should not be printed',
        },
      ],
    });

    expect(lines).toEqual(expect.arrayContaining([
      'Missing preconditions:',
      'Missing replacement coverage:',
      'Next actions:',
      expect.stringContaining('openai-api-key-env'),
      expect.stringContaining('CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'),
      expect.stringContaining('pnpm run verify:cc-connect:local-real:api-key'),
    ]));
    expect(lines.join('\n')).not.toContain('redacted-secret-value-that-must-not-leak');
    expect(lines.join('\n')).not.toContain('access_token');
    expect(lines.join('\n')).not.toContain('refresh_token');
  });

  it('can focus console summary coverage on selected external gates', () => {
    const lines = toConsoleSummaryLines({
      missingPreconditions: [],
      replacementReadiness: {
        missingCoverage: [
          {
            id: 'codex-oauth-host-api-lifecycle-local',
            status: 'not-run',
            nextCommand: 'pnpm run verify:cc-connect:local-real:all-strict',
            reason: 'Command was not requested.',
          },
          {
            id: 'openai-api-key-provider-model-chat',
            status: 'skipped',
            nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
            reason: 'CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY is not configured.',
          },
        ],
      },
      nextActions: [
        {
          id: 'verify-codex-oauth-host-api-lifecycle-local',
          type: 'coverage',
          command: 'pnpm run verify:cc-connect:local-real:all-strict',
        },
        {
          id: 'verify-openai-api-key-provider-model-chat',
          type: 'coverage',
          command: 'pnpm run verify:cc-connect:local-real:api-key',
        },
        {
          id: 'configure-openai-api-key-env',
          type: 'precondition',
          command: 'pnpm run verify:cc-connect:local-real:api-key',
        },
        {
          id: 'upstream-documented-per-platform-channel-connect-disconnect',
          type: 'upstream-gap',
          command: 'Track upstream cc-connect support.',
        },
      ],
    }, {
      focusCoverageIds: ['openai-api-key-provider-model-chat'],
    });

    expect(lines.join('\n')).toContain('openai-api-key-provider-model-chat');
    expect(lines.join('\n')).toContain('configure-openai-api-key-env');
    expect(lines.join('\n')).not.toContain('codex-oauth-host-api-lifecycle-local');
    expect(lines.join('\n')).not.toContain('upstream-documented-per-platform-channel-connect-disconnect');
  });

  it('ignores pnpm-style bare argument separators', () => {
    expect(parseArgs(['--', '--run', '--include-oauth', '--include-scheduled-cron'])).toMatchObject({
      run: true,
      includeOAuth: true,
      includeScheduledCron: true,
    });
  });

  it('expands all required coverage ids deterministically', () => {
    expect(requiredCoverageIds(['all'])).toEqual(COVERAGE_IDS);
    expect(requiredCoverageIds(['oauth-core-runtime-parity', 'oauth-core-runtime-parity,packaged-oauth-runtime-smoke']))
      .toEqual(['oauth-core-runtime-parity', 'packaged-oauth-runtime-smoke']);
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('provider-model-profile-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('token-usage-contract-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('runtime-management-bundle-local-diagnostics');
    expect(COVERAGE_IDS).toContain('bridge-media-packets-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('bridge-media-packets-local-diagnostics');
    expect(COVERAGE_IDS).toContain('bridge-media-send-real-bundle');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('bridge-media-send-real-bundle');
    expect(COVERAGE_IDS).toContain('bridge-rich-packets-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('bridge-rich-packets-local-diagnostics');
    expect(COVERAGE_IDS).toContain('bridge-rich-progress-real-bundle');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('bridge-rich-progress-real-bundle');
    expect(COVERAGE_IDS).toContain('bridge-rich-card-action-real-bundle');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('bridge-rich-card-action-real-bundle');
    expect(COVERAGE_IDS).toContain('bridge-runtime-choice-real-bundle');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('bridge-runtime-choice-real-bundle');
    expect(COVERAGE_IDS).toContain('session-history-parity-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('session-history-parity-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('channel-lifecycle-local-bundle');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('channel-cron-command-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('cron-lifecycle-local-bundle');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('local-openai-compatible-api-key-chat');
    expect(COVERAGE_IDS).toContain('generated-file-card-real-oauth');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).not.toContain('generated-file-card-real-oauth');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('chat-abort-local-openai-compatible');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('codex-oauth-lifecycle-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('codex-oauth-host-api-lifecycle-local');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('operation-capabilities-local-diagnostics');
    expect(REPLACEMENT_REQUIRED_COVERAGE_IDS).toContain('feishu-live-inbound-delivery');
  });

  it('passes only when every requested coverage row is pass', () => {
    expect(requiredCoverageCheck(coverageRows({}), ['all'])).toMatchObject({
      id: 'required-coverage',
      status: 'pass',
    });

    expect(requiredCoverageCheck(coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
    }), ['all'])).toMatchObject({
      id: 'required-coverage',
      status: 'fail',
      details: {
        missing: [
          expect.objectContaining({
            id: 'openai-api-key-provider-model-chat',
            status: 'skipped',
            reason: 'openai-api-key-provider-model-chat skipped',
          }),
        ],
      },
    });
  });

  it('summarizes retried command attempts without hiding the failed attempt', () => {
    const result = summarizeCommandAttempts('pnpm', ['run', 'test:e2e:cc-connect:real-comprehensive'], [
      {
        command: 'pnpm run test:e2e:cc-connect:real-comprehensive',
        status: 'fail',
        exitCode: 1,
        durationMs: 100,
      },
      {
        command: 'pnpm run test:e2e:cc-connect:real-comprehensive',
        status: 'pass',
        exitCode: 0,
        durationMs: 200,
      },
    ]);

    expect(result).toMatchObject({
      command: 'pnpm run test:e2e:cc-connect:real-comprehensive',
      status: 'pass',
      exitCode: 0,
      durationMs: 300,
      reason: 'Passed after 2 attempts; 1 previous attempt(s) failed.',
      attempts: [
        expect.objectContaining({ status: 'fail', exitCode: 1 }),
        expect.objectContaining({ status: 'pass', exitCode: 0 }),
      ],
    });
  });

  it('fails unknown requested coverage ids instead of silently accepting them', () => {
    expect(requiredCoverageCheck(coverageRows({}), ['not-a-real-coverage-id'])).toMatchObject({
      id: 'required-coverage',
      status: 'fail',
      details: {
        unknown: ['not-a-real-coverage-id'],
        missing: [
          expect.objectContaining({
            id: 'not-a-real-coverage-id',
            status: 'not-run',
          }),
        ],
      },
    });
  });

  it('maps command records into runtime parity coverage rows', () => {
    const report = {
      checks: [
        {
          id: 'current-runtime-bundles',
          status: 'pass',
          message: 'bundles ready',
        },
      {
        id: 'local-validation-commands',
          status: 'pass',
          details: {
            commands: [
              {
                command: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-openai-api-key.spec.ts tests/e2e/cc-connect-real-feishu-channel.spec.ts',
                status: 'pass',
              },
              {
                command: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
                status: 'pass',
              },
              {
                command: 'pnpm exec vitest run tests/unit/runtime-rpc-contract.test.ts tests/unit/runtime-operation-capabilities.test.ts tests/unit/channel-store-operation-capabilities.test.ts',
                status: 'pass',
              },
              {
                command: 'pnpm run test:e2e:cc-connect:codex-oauth-lifecycle',
                status: 'pass',
              },
              {
                command: 'pnpm exec vitest run tests/unit/cc-connect-local-real-verifier.test.ts tests/unit/e2e-local-real-env.test.ts',
                status: 'pass',
              },
              {
                command: 'pnpm exec vitest run tests/unit/token-usage-scan.test.ts',
                status: 'pass',
              },
              {
                command: 'pnpm run test:e2e -- tests/e2e/token-usage.spec.ts',
                status: 'pass',
              },
              {
                command: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
                status: 'pass',
              },
              {
                command: 'pnpm run test:e2e:cc-connect:real-comprehensive',
                status: 'pass',
              },
              {
                command: 'pnpm run test:e2e:cc-connect:real-scheduled-cron',
                status: 'pass',
                coverageAliases: ['test:e2e:cc-connect:real-scheduled-prompt-cron'],
              },
              {
                command: 'pnpm run test:e2e:cc-connect:real-openai-api-key',
                status: 'skipped',
                reason: 'OPENAI_API_KEY is not configured.',
              },
              {
                command: 'pnpm run smoke:cc-connect:packaged -- --app=/tmp/ClawX.app --real-oauth=1',
                status: 'pass',
              },
            ],
          },
        },
      ],
    };

    expect(buildCoverage(report)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'runtime-bundles-current-platform',
        status: 'pass',
        evidence: 'bundles ready',
      }),
      expect.objectContaining({
        id: 'provider-model-profile-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
        covers: expect.arrayContaining([
          'browser OAuth re-login secret precedence over stale same-account managed auth',
          'Codex-refreshed managed auth precedence during ordinary runtime start',
        ]),
      }),
      expect.objectContaining({
        id: 'runtime-boundary-bridgeplatform-only',
        covers: expect.arrayContaining([
          'Electron Host API provider sync replaces stale same-account managed OAuth after browser re-login',
          'ordinary runtime start preserves Codex-refreshed managed OAuth over an older vault snapshot',
        ]),
      }),
      expect.objectContaining({
        id: 'codex-oauth-lifecycle-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/cc-connect-local-real-verifier.test.ts tests/unit/e2e-local-real-env.test.ts',
        covers: expect.arrayContaining([
          'explicit auth import requirement',
          'complete Codex token field requirement',
          'expired access-token refresh through isolated real execution',
        ]),
      }),
      expect.objectContaining({
        id: 'codex-oauth-host-api-lifecycle-local',
        status: 'pass',
        evidence: 'pnpm run test:e2e:cc-connect:codex-oauth-lifecycle',
        covers: expect.arrayContaining([
          'Electron Host API providers.importCodexOAuth',
          'provider OAuth secret cleanup',
          'token redaction in Host API responses and public provider profile',
        ]),
      }),
      expect.objectContaining({
        id: 'operation-capabilities-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/runtime-rpc-contract.test.ts tests/unit/runtime-operation-capabilities.test.ts tests/unit/channel-store-operation-capabilities.test.ts && pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'renderer fail-closed behavior for undeclared operations after status publication',
          'channel add and QR entry points stop before runtime RPC when explicitly unsupported',
          'real bundled cc-connect operation capabilities exposed through runtime status',
        ]),
      }),
      expect.objectContaining({
        id: 'token-usage-contract-local-diagnostics',
        status: 'partial',
        evidence: 'pnpm exec vitest run tests/unit/token-usage-scan.test.ts && pnpm run test:e2e -- tests/e2e/token-usage.spec.ts',
        covers: expect.arrayContaining([
          'cc-connect private session-store exclusion',
          'managed and user-global Codex transcript exclusion',
          'runtimeKind filtering without OpenClaw data leakage',
        ]),
      }),
      expect.objectContaining({
        id: 'runtime-management-bundle-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'Management API sessions/providers/models across managed projects',
          'read-only Host API provider/model profiles without runtime restart',
          'provider/model Management response field allowlist without secret pass-through',
          'managed cc-connect user-isolation plus Codex doctor JSON audit',
        ]),
      }),
      expect.objectContaining({
        id: 'bridge-media-packets-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
        covers: expect.arrayContaining([
          'BridgePlatform image packet to renderer attached file',
          'BridgePlatform file packet to renderer attached file',
          'BridgePlatform audio packet to renderer attached file',
          'BridgePlatform video packet to renderer attached file',
          'cc-connect managed media directory writes',
        ]),
      }),
      expect.objectContaining({
        id: 'bridge-media-send-real-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-openai-api-key.spec.ts tests/e2e/cc-connect-real-feishu-channel.spec.ts',
        covers: expect.arrayContaining([
          'real bundled cc-connect send CLI against an active managed session',
          'public Bridge image/file/audio/video packets',
          'Host API session history attachment merge',
          'GUI image preview plus PDF/audio/video file cards',
        ]),
      }),
      expect.objectContaining({
        id: 'bridge-rich-packets-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
        covers: expect.arrayContaining([
          'BridgePlatform card packet to shared assistant message',
          'BridgePlatform buttons packet to shared assistant message',
          'BridgePlatform preview_start acknowledgement',
          'BridgePlatform update_message assistant delta',
          'BridgePlatform text preview delete clears transient assistant content',
        ]),
      }),
      expect.objectContaining({
        id: 'bridge-rich-progress-real-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'real bundled cc-connect v1.4.1 engine process',
          'public Bridge preview_start and update_message packets observed in runtime diagnostics',
          'GUI execution graph and final assistant reply',
        ]),
      }),
      expect.objectContaining({
        id: 'bridge-rich-card-action-real-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'real bundled cc-connect Bridge card packet from /cron list',
          'real card action values emitted by cc-connect',
          'card_action disable callback observed through Host API',
          'card_action enable callback observed through Host API',
          'card_action delete callback observed through Host API',
        ]),
      }),
      expect.objectContaining({
        id: 'bridge-runtime-choice-real-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'real bundled cc-connect /lang card rendered as a shared runtime choice',
          'GUI action returned through the public card_action packet',
          'live language state verified through the public Management project API',
        ]),
      }),
      expect.objectContaining({
        id: 'channel-lifecycle-local-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'Host API channels.connect through cc-connect runtime',
          'Host API channels.disconnect through cc-connect runtime',
          'Feishu/Lark local config projection',
          'Feishu/Lark agent binding and workspace projection',
          'real user channel credential removal',
        ]),
      }),
      expect.objectContaining({
        id: 'channel-cron-command-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'managed admin identity for Channel Cron mutation commands',
          'Channel /cron add observed through Host API Cron list',
          'GUI announce Cron observed through Channel /cron list for the same Feishu target',
          'Channel /cron disable and enable observed through Host API',
          'Channel /cron delete observed through Host API',
          'single native cc-connect scheduler and unchanged runtime PID',
          'real cc-connect /cron card packet and actionable disable/enable/delete callbacks',
          'usable text fallback for the /cron add acknowledgement',
        ]),
      }),
      expect.objectContaining({
        id: 'cron-lifecycle-local-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
        covers: expect.arrayContaining([
          'Management API cron create/list/update/toggle/delete',
          'non-main agent project routing',
          'exec cron field mapping',
          'non-cron schedule unsupported/error semantics',
          'manual exec run unsupported/error semantics',
        ]),
      }),
      expect.objectContaining({
        id: 'oauth-core-runtime-parity',
        status: 'pass',
      }),
      expect.objectContaining({
        id: 'generated-file-card-real-oauth',
        status: 'pass',
        evidence: 'pnpm run test:e2e:cc-connect:real-comprehensive',
        covers: expect.arrayContaining([
          'real Codex apply_patch tool turn',
          'run-correlated cc-connect Bridge tool lifecycle',
          'generated-file card rendered in GUI chat',
        ]),
      }),
      expect.objectContaining({
        id: 'scheduled-cron-delivery-local-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e:cc-connect:real-scheduled-cron',
        covers: expect.arrayContaining([
          'real cc-connect scheduler tick',
          'enabled exec cron delivery',
        ]),
      }),
      expect.objectContaining({
        id: 'scheduled-prompt-cron-delivery-local-bundle',
        status: 'pass',
        evidence: 'pnpm run test:e2e:cc-connect:real-scheduled-cron',
        covers: expect.arrayContaining([
          'real cc-connect prompt cron creation',
          'ClawX fallback delivery through cc-connect BridgePlatform',
          'cc-connect session history after scheduled prompt delivery',
        ]),
      }),
      expect.objectContaining({
        id: 'local-openai-compatible-api-key-chat',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-openai-api-key.spec.ts tests/e2e/cc-connect-real-feishu-channel.spec.ts',
        covers: expect.arrayContaining([
          'OpenAI API-key provider with custom baseUrl',
          'chat through real cc-connect and bundled Codex',
        ]),
      }),
      expect.objectContaining({
        id: 'chat-abort-local-openai-compatible',
        status: 'pass',
        evidence: 'pnpm run test:e2e -- tests/e2e/cc-connect-real-openai-api-key.spec.ts tests/e2e/cc-connect-real-feishu-channel.spec.ts',
        covers: expect.arrayContaining([
          'GUI Stop button through Host API chat.abort',
          'session-scoped cc-connect BridgePlatform /stop cancellation',
          'upstream stream closure before completion release',
          'late assistant output suppression',
          'unchanged cc-connect PID and runtime recovery to running state',
        ]),
      }),
      expect.objectContaining({
        id: 'openai-api-key-provider-model-chat',
        status: 'skipped',
        reason: 'OPENAI_API_KEY is not configured.',
      }),
      expect.objectContaining({
        id: 'feishu-live-channel-lifecycle',
        status: 'not-run',
        reason: 'Command was not requested.',
      }),
      expect.objectContaining({
        id: 'feishu-live-inbound-delivery',
        status: 'not-run',
        reason: 'Command was not requested.',
        covers: expect.arrayContaining([
          'sanitized Feishu/Lark inbound marker handoff artifact',
          'real Feishu/Lark tenant message sent by a sandbox chat',
        ]),
      }),
      expect.objectContaining({
        id: 'packaged-oauth-runtime-smoke',
        status: 'pass',
        evidence: 'pnpm run smoke:cc-connect:packaged -- --app=/tmp/ClawX.app --real-oauth=1',
        covers: expect.arrayContaining([
          'packaged cc-connect manifest and source sha256 integrity',
          'packaged Codex manifest and source sha256 integrity',
          'packaged signed executable version checks',
          'packaged Codex ripgrep helper executable',
          'packaged GUI Chat through cc-connect and the managed Codex OAuth launcher',
        ]),
      }),
    ]));
  });

  it('backfills newly inferred coverage rows when reading older reports', () => {
    const report = {
      coverage: [
        {
          id: 'oauth-core-runtime-parity',
          status: 'pass',
          covers: ['chat'],
          evidence: 'previous report evidence',
          reason: '',
        },
      ],
      checks: [
        {
          id: 'local-validation-commands',
          status: 'pass',
          details: {
            commands: [
              {
                command: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
                status: 'pass',
              },
              {
                command: 'pnpm run test:e2e:cc-connect:real-comprehensive',
                status: 'pass',
              },
            ],
          },
        },
      ],
    };

    expect(coverageRecords(report)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'oauth-core-runtime-parity',
        evidence: 'previous report evidence',
      }),
      expect.objectContaining({
        id: 'generated-file-card-real-oauth',
        status: 'pass',
        evidence: 'pnpm run test:e2e:cc-connect:real-comprehensive',
      }),
      expect.objectContaining({
        id: 'bridge-media-packets-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
      }),
      expect.objectContaining({
        id: 'bridge-media-send-real-bundle',
        status: 'not-run',
        evidence: 'Command was not requested.',
      }),
      expect.objectContaining({
        id: 'bridge-rich-packets-local-diagnostics',
        status: 'pass',
        evidence: 'pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts',
      }),
      expect.objectContaining({
        id: 'bridge-rich-progress-real-bundle',
        status: 'not-run',
        evidence: 'Command was not requested.',
      }),
    ]));
  });

  it('marks credential-gated coverage skipped when preconditions are missing even if commands were not requested', () => {
    const report = {
      checks: [
        {
          id: 'current-runtime-bundles',
          status: 'pass',
          message: 'bundles ready',
        },
      ],
      missingPreconditions: [
        {
          id: 'openai-api-key-env',
          note: 'Set CLAWX_REAL_OPENAI_API_KEY before running the real OpenAI API-key smoke.',
        },
        {
          id: 'feishu-env',
          note: 'Set Feishu/Lark credentials before running the real channel smoke.',
        },
        {
          id: 'feishu-inbound-fixture',
          note: 'Set CLAWX_REAL_FEISHU_INBOUND_E2E=1 before running the real inbound smoke.',
        },
      ],
    };

    expect(buildCoverage(report)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-api-key-provider-model-chat',
        status: 'skipped',
        reason: 'Set CLAWX_REAL_OPENAI_API_KEY before running the real OpenAI API-key smoke.',
      }),
      expect.objectContaining({
        id: 'feishu-live-channel-lifecycle',
        status: 'skipped',
        reason: 'Set Feishu/Lark credentials before running the real channel smoke.',
      }),
      expect.objectContaining({
        id: 'feishu-live-inbound-delivery',
        status: 'skipped',
        reason: 'Set Feishu/Lark credentials before running the real channel smoke.',
        covers: expect.arrayContaining([
          'sanitized Feishu/Lark inbound marker handoff artifact',
          'managed cc-connect session store records the inbound marker',
        ]),
      }),
    ]));
  });

  it('keeps credential-gated coverage not-run when credentials are present but the command was not requested', () => {
    expect(buildCoverage({
      checks: [
        {
          id: 'current-runtime-bundles',
          status: 'pass',
          message: 'bundles ready',
        },
      ],
      missingPreconditions: [],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-api-key-provider-model-chat',
        status: 'not-run',
        reason: 'Command was not requested.',
      }),
      expect.objectContaining({
        id: 'feishu-live-channel-lifecycle',
        status: 'not-run',
        reason: 'Command was not requested.',
      }),
      expect.objectContaining({
        id: 'feishu-live-inbound-delivery',
        status: 'not-run',
        reason: 'Command was not requested.',
      }),
    ]));
  });

  it('classifies local verifier env files without exposing absolute paths', async () => {
    expect(isPathInsideRoot(resolve('.env.cc-connect.local'))).toBe(true);
    expect(isPathInsideRoot(join(tmpdir(), 'clawx-real-env.local'))).toBe(false);

    await expect(localEnvFileSafety(resolve('.env.cc-connect.local'))).resolves.toEqual({
      location: 'repo',
      gitignored: true,
      tracked: false,
      safe: true,
    });
    await expect(localEnvFileSafety(resolve('package.json'))).resolves.toEqual({
      location: 'repo',
      gitignored: false,
      tracked: true,
      safe: false,
    });
    await expect(localEnvFileSafety(join(tmpdir(), 'clawx-real-env.local'))).resolves.toEqual({
      location: 'outside-repo',
      gitignored: true,
      tracked: false,
      safe: true,
    });
  });

  it('loads explicit verifier env files from CLAWX_REAL_ENV_FILE variables without overriding process env', async () => {
    const firstDir = await mkdtemp(join(tmpdir(), 'clawx-verifier-env-first-'));
    const secondDir = await mkdtemp(join(tmpdir(), 'clawx-verifier-env-second-'));
    const originalSingle = process.env.CLAWX_REAL_ENV_FILE;
    const originalMultiple = process.env.CLAWX_REAL_ENV_FILES;
    const originalKey = process.env.CLAWX_REAL_OPENAI_API_KEY;
    const originalFeishuDomain = process.env.CLAWX_REAL_FEISHU_DOMAIN;
    const originalFeishuAppId = process.env.CLAWX_REAL_FEISHU_APP_ID;
    try {
      const firstFile = join(firstDir, 'real-one.env');
      const secondFile = join(secondDir, 'real-two.env');
      await writeFile(firstFile, [
        'CLAWX_REAL_OPENAI_API_KEY=from-file',
        'CLAWX_REAL_FEISHU_DOMAIN=lark',
      ].join('\n'), 'utf8');
      await writeFile(secondFile, [
        'CLAWX_REAL_FEISHU_APP_ID=app-from-second',
      ].join('\n'), 'utf8');

      process.env.CLAWX_REAL_ENV_FILE = firstFile;
      process.env.CLAWX_REAL_ENV_FILES = `${delimiter}${secondFile}${delimiter}${firstFile}`;
      process.env.CLAWX_REAL_OPENAI_API_KEY = 'from-process';
      delete process.env.CLAWX_REAL_FEISHU_DOMAIN;
      delete process.env.CLAWX_REAL_FEISHU_APP_ID;

      expect(extraLocalRealEnvFiles(process.env)).toEqual([firstFile, secondFile]);
      const { env, summaries } = await loadLocalEnvFiles({ envFiles: [] });

      expect(env).toMatchObject({
        CLAWX_REAL_FEISHU_DOMAIN: 'lark',
        CLAWX_REAL_FEISHU_APP_ID: 'app-from-second',
      });
      expect(env.CLAWX_REAL_OPENAI_API_KEY).toBeUndefined();
      expect(summaries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'real-one.env',
          loaded: true,
          variableNames: ['CLAWX_REAL_FEISHU_DOMAIN', 'CLAWX_REAL_OPENAI_API_KEY'],
          safety: expect.objectContaining({ location: 'outside-repo', safe: true }),
        }),
        expect.objectContaining({
          name: 'real-two.env',
          loaded: true,
          variableNames: ['CLAWX_REAL_FEISHU_APP_ID'],
          safety: expect.objectContaining({ location: 'outside-repo', safe: true }),
        }),
      ]));
    } finally {
      if (originalSingle === undefined) delete process.env.CLAWX_REAL_ENV_FILE;
      else process.env.CLAWX_REAL_ENV_FILE = originalSingle;
      if (originalMultiple === undefined) delete process.env.CLAWX_REAL_ENV_FILES;
      else process.env.CLAWX_REAL_ENV_FILES = originalMultiple;
      if (originalKey === undefined) delete process.env.CLAWX_REAL_OPENAI_API_KEY;
      else process.env.CLAWX_REAL_OPENAI_API_KEY = originalKey;
      if (originalFeishuDomain === undefined) delete process.env.CLAWX_REAL_FEISHU_DOMAIN;
      else process.env.CLAWX_REAL_FEISHU_DOMAIN = originalFeishuDomain;
      if (originalFeishuAppId === undefined) delete process.env.CLAWX_REAL_FEISHU_APP_ID;
      else process.env.CLAWX_REAL_FEISHU_APP_ID = originalFeishuAppId;
      await Promise.all([
        rm(firstDir, { recursive: true, force: true }),
        rm(secondDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('does not load unsafe repo-local verifier env files', async () => {
    const unsafeEnvFile = 'clawx-unsafe-real-env.tmp';
    try {
      await writeFile(unsafeEnvFile, [
        'CLAWX_REAL_OPENAI_API_KEY=unsafe-secret-value',
        'CLAWX_REAL_FEISHU_APP_ID=unsafe-app-id',
      ].join('\n'), 'utf8');

      const result = await loadLocalEnvFiles({
        envFiles: [unsafeEnvFile],
      });

      expect(result.env).not.toHaveProperty('CLAWX_REAL_OPENAI_API_KEY');
      expect(result.env).not.toHaveProperty('CLAWX_REAL_FEISHU_APP_ID');
      expect(result.summaries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: unsafeEnvFile,
          exists: true,
          loaded: false,
          variableNames: [],
          safety: expect.objectContaining({
            location: 'repo',
            safe: false,
          }),
          skippedReason: expect.stringContaining('untracked and gitignored'),
        }),
      ]));
    } finally {
      await rm(unsafeEnvFile, { force: true });
    }
  });

  it('resolves ClawX-specific OpenAI API key env before the standard name', () => {
    expect(resolveOpenAiApiKeyEnv({
      CLAWX_REAL_OPENAI_API_KEY: ' clawx-key ',
      OPENAI_API_KEY: 'standard-key',
    })).toEqual({
      source: 'CLAWX_REAL_OPENAI_API_KEY',
      value: 'clawx-key',
      childEnv: {
        OPENAI_API_KEY: 'clawx-key',
      },
    });

    expect(resolveOpenAiApiKeyEnv({
      OPENAI_API_KEY: ' standard-key ',
    })).toEqual({
      source: 'OPENAI_API_KEY',
      value: 'standard-key',
      childEnv: {
        OPENAI_API_KEY: 'standard-key',
      },
    });

    expect(resolveOpenAiApiKeyEnv({})).toEqual({
      source: '',
      value: '',
      childEnv: {},
    });
  });

  it('can resolve OpenAI API key from Codex auth only after explicit env keys', () => {
    expect(resolveOpenAiApiKeyEnv({
      OPENAI_API_KEY: ' standard-key ',
    }, {
      source: 'default Codex auth.json OPENAI_API_KEY',
      value: ' auth-key ',
    })).toEqual({
      source: 'OPENAI_API_KEY',
      value: 'standard-key',
      childEnv: {
        OPENAI_API_KEY: 'standard-key',
      },
    });

    expect(resolveOpenAiApiKeyEnv({}, {
      source: 'default Codex auth.json OPENAI_API_KEY',
      value: ' auth-key ',
    })).toEqual({
      source: 'default Codex auth.json OPENAI_API_KEY',
      value: 'auth-key',
      childEnv: {
        OPENAI_API_KEY: 'auth-key',
      },
    });

    expect(resolveOpenAiApiKeyEnv({}, {
      source: 'default Codex auth.json OPENAI_API_KEY',
      value: null,
    })).toEqual({
      source: '',
      value: '',
      childEnv: {},
    });
  });

  it('summarizes Codex auth OpenAI API key candidates without exposing values', () => {
    expect(openAiApiKeyCandidateSummary(' sk-redacted ')).toEqual({
      present: true,
      usable: true,
      valueType: 'string',
      length: 'sk-redacted'.length,
      reason: 'non-empty string',
    });
    expect(openAiApiKeyCandidateSummary(null)).toEqual({
      present: true,
      usable: false,
      valueType: 'null',
      length: 0,
      reason: 'must be a non-empty string',
    });
    expect(openAiApiKeyCandidateSummary(undefined)).toEqual({
      present: false,
      usable: false,
      valueType: 'undefined',
      length: 0,
      reason: 'missing',
    });
  });

  it('explains OpenAI API key precondition state without implying unusable metadata is a real key', () => {
    expect(openAiApiKeyPreconditionMessage(true, true, openAiApiKeyCandidateSummary(undefined)))
      .toBe('OpenAI API key real E2E environment is configured and selected for this run.');
    expect(openAiApiKeyPreconditionMessage(true, false, openAiApiKeyCandidateSummary(undefined)))
      .toBe('OpenAI API key real E2E environment is configured; the real API-key E2E was not requested in this run.');
    expect(openAiApiKeyPreconditionMessage(false, true, openAiApiKeyCandidateSummary(undefined)))
      .toBe('OpenAI API key real E2E environment is not configured.');
    expect(openAiApiKeyPreconditionMessage(false, true, openAiApiKeyCandidateSummary('   ')))
      .toBe('Codex auth metadata contains an empty OPENAI_API_KEY; configure CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY for real API-key validation.');
    expect(openAiApiKeyPreconditionMessage(false, true, openAiApiKeyCandidateSummary(null)))
      .toBe('Codex auth metadata contains OPENAI_API_KEY as null; configure CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY with a non-empty string for real API-key validation.');
  });

  it('separates missing credentials from coverage paths that were not requested', () => {
    const authSummary = {
      exists: true,
      hasTokens: true,
      completeTokens: true,
      tokenKeys: ['access_token', 'account_id', 'id_token', 'refresh_token'],
      expired: false,
    };

    expect(missingPreconditions({
      authSummary,
      authImportExplicit: true,
      openAiConfigured: true,
      feishuConfigured: true,
      feishuInboundConfigured: true,
      appPath: '/tmp/ClawX.app',
      packagedExecutableExists: true,
    })).toEqual([]);

    expect(missingPreconditions({
      authSummary,
      authImportExplicit: true,
      openAiConfigured: false,
      feishuConfigured: false,
      feishuInboundConfigured: false,
      appPath: '/tmp/ClawX.app',
      packagedExecutableExists: true,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-api-key-env',
        required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
        optional: ['CLAWX_REAL_OPENAI_MODEL'],
        nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
        note: expect.stringContaining('CLAWX_REAL_OPENAI_MODEL'),
      }),
      expect.objectContaining({
        id: 'feishu-env',
        required: [
          'CLAWX_REAL_FEISHU_APP_ID',
          'CLAWX_REAL_FEISHU_APP_SECRET',
          'CLAWX_REAL_FEISHU_ADMIN_FROM',
        ],
        nextCommand: 'pnpm run verify:cc-connect:local-real:feishu',
      }),
    ]));
  });

  it('requires explicit Codex auth import before real OAuth paths can run', () => {
    expect(missingPreconditions({
      authSummary: {
      exists: true,
      hasTokens: true,
      completeTokens: true,
      tokenKeys: ['access_token', 'refresh_token'],
      expired: false,
      },
      authImportExplicit: false,
      openAiConfigured: true,
      feishuConfigured: true,
      feishuInboundConfigured: true,
      appPath: '/tmp/ClawX.app',
      packagedExecutableExists: true,
    })).toEqual([
      expect.objectContaining({
        id: 'codex-oauth-auth-json',
        required: ['CLAWX_REAL_CODEX_AUTH_JSON with a complete refresh-token set'],
        nextCommand: 'pnpm run verify:cc-connect:local-real:oauth',
      }),
    ]);
  });

  it('summarizes Codex auth expiry without exposing token values', () => {
    const now = Date.parse('2026-06-21T12:00:00.000Z');
    const jwt = (expiresAt: string) => [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.parse(expiresAt) / 1000) })).toString('base64url'),
      'signature',
    ].join('.');

    expect(codexAuthExpirySummary({
      tokens: {
        access_token: 'redacted',
        expires_at: '2026-06-21T13:00:00.000Z',
      },
    }, now)).toEqual({
      expiryStatus: 'valid',
      expiresAt: '2026-06-21T13:00:00.000Z',
      expired: false,
    });

    expect(codexAuthExpirySummary({
      tokens: {
        access_token: 'redacted',
        refresh_token: 'redacted',
        nested: { expiry: Math.floor(Date.parse('2026-06-21T11:00:00.000Z') / 1000) },
      },
    }, now)).toEqual({
      expiryStatus: 'expired',
      expiresAt: '2026-06-21T11:00:00.000Z',
      expired: true,
    });

    expect(codexAuthExpirySummary({
      tokens: { access_token: 'redacted' },
    }, now)).toEqual({
      expiryStatus: 'unknown',
      expiresAt: null,
      expired: false,
    });

    const encodedToken = jwt('2026-06-21T10:00:00.000Z');
    const jwtSummary = codexAuthExpirySummary({
      tokens: {
        access_token: encodedToken,
        id_token: 'malformed-token',
        refresh_token: 'must-not-appear',
      },
    }, now);
    expect(jwtSummary).toEqual({
      expiryStatus: 'expired',
      expiresAt: '2026-06-21T10:00:00.000Z',
      expired: true,
    });
    expect(JSON.stringify(jwtSummary)).not.toContain(encodedToken);
    expect(JSON.stringify(jwtSummary)).not.toContain('must-not-appear');
  });

  it('allows a complete expired Codex auth set so real execution can prove refresh', () => {
    expect(missingPreconditions({
      authSummary: {
        exists: true,
        hasTokens: true,
        completeTokens: true,
        tokenKeys: ['access_token', 'refresh_token'],
        expired: true,
      },
      authImportExplicit: true,
      openAiConfigured: true,
      feishuConfigured: true,
      feishuInboundConfigured: true,
      appPath: '/tmp/ClawX.app',
      packagedExecutableExists: true,
    })).toEqual([]);
  });

  it('treats incomplete Codex auth tokens as a missing real OAuth precondition', () => {
    expect(missingPreconditions({
      authSummary: {
        exists: true,
        hasTokens: true,
        completeTokens: false,
        tokenKeys: ['access_token', 'refresh_token'],
        missingTokenKeys: ['account_id', 'id_token'],
        expired: false,
      },
      authImportExplicit: true,
      openAiConfigured: true,
      feishuConfigured: true,
      feishuInboundConfigured: true,
      appPath: '/tmp/ClawX.app',
      packagedExecutableExists: true,
    })).toEqual([
      expect.objectContaining({
        id: 'codex-oauth-auth-json',
        required: ['CLAWX_REAL_CODEX_AUTH_JSON with a complete refresh-token set'],
        note: expect.stringContaining('account_id, id_token'),
      }),
    ]);
  });

  it('records cc-connect upstream CLI surface and unsupported primitives', () => {
    const surface = analyzeCcConnectCliSurface({
      topHelp: [
        'Commands:',
        '  send',
        '  cron',
        '  sessions',
        '  provider',
        '  feishu',
        '  config',
      ].join('\n'),
      cronAddHelp: [
        'Usage: cc-connect cron add',
        '--prompt <text>',
        '--exec <command>',
        '--session-mode <mode>',
        '--timeout-mins <n>',
      ].join('\n'),
      feishuHelp: [
        'Commands:',
        '  setup',
        '  new',
        '  bind',
        '--platform-type <type>',
        '--app-id <id>',
        '--app-secret <secret>',
      ].join('\n'),
      providerHelp: [
        'cc-connect provider add',
        'cc-connect provider list',
        'cc-connect provider remove',
        'cc-connect provider import',
        'cc-connect provider presets',
        'cc-connect provider global list',
      ].join('\n'),
      sessionsHelp: [
        'cc-connect sessions list',
        'cc-connect sessions show "#1"',
      ].join('\n'),
      configExample: [
        'cc-connect doctor user-isolation',
        '[[projects.platforms]]',
      ].join('\n'),
    });

    expect(surface).toMatchObject({
      commands: {
        send: true,
        cron: true,
        sessions: true,
        provider: true,
        feishu: true,
        config: true,
        doctorUserIsolation: true,
      },
      cron: {
        promptJobs: true,
        execJobs: true,
        sessionMode: true,
        timeoutMins: true,
      },
      feishu: {
        setup: true,
        bind: true,
        new: true,
        platformType: true,
        appIdSecret: true,
      },
      channelLifecycle: {
        documentedConnectDisconnect: false,
        documentedReloadStatus: true,
      },
      missingPrimitives: [
        'documented per-platform channel connect/disconnect',
      ],
    });
  });

  it('summarizes replacement readiness from required runtime parity coverage', () => {
    const ready = buildReplacementReadiness(coverageRows({}));
    expect(ready).toMatchObject({
      status: 'ready',
      replacementReady: true,
      requiredCoverageIds: REPLACEMENT_REQUIRED_COVERAGE_IDS,
      passedCoverageIds: REPLACEMENT_REQUIRED_COVERAGE_IDS,
      missingCoverage: [],
      nextCommands: [],
    });
    expect(replacementReadinessCheck(ready)).toMatchObject({
      id: 'replacement-readiness',
      status: 'pass',
    });
    expect(runtimeMatrixStatus(coverageRows({}), ready)).toBe('pass');

    const readiness = buildReplacementReadiness(coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
    }), [
      { id: 'openai-api-key-env' },
      { id: 'feishu-env' },
      { id: 'feishu-inbound-fixture' },
    ]);

    expect(readiness).toMatchObject({
      status: 'partial',
      replacementReady: false,
      missingPreconditions: [
        { id: 'openai-api-key-env' },
        { id: 'feishu-env' },
        { id: 'feishu-inbound-fixture' },
      ],
      missingCoverage: [
        expect.objectContaining({
          id: 'openai-api-key-provider-model-chat',
          status: 'skipped',
          nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
        }),
        expect.objectContaining({
          id: 'feishu-live-channel-lifecycle',
          status: 'not-run',
          nextCommand: 'pnpm run verify:cc-connect:local-real:feishu',
        }),
        expect.objectContaining({
          id: 'feishu-live-inbound-delivery',
          status: 'not-run',
          nextCommand: 'pnpm run verify:cc-connect:local-real:feishu-inbound',
        }),
      ],
      nextCommands: [
        'pnpm run verify:cc-connect:local-real:api-key',
        'pnpm run verify:cc-connect:local-real:feishu',
        'pnpm run verify:cc-connect:local-real:feishu-inbound',
      ],
    });
    expect(replacementReadinessCheck(readiness)).toMatchObject({
      id: 'replacement-readiness',
      status: 'partial',
      details: {
        missingCoverage: [
          expect.objectContaining({ id: 'openai-api-key-provider-model-chat' }),
          expect.objectContaining({ id: 'feishu-live-channel-lifecycle' }),
          expect.objectContaining({ id: 'feishu-live-inbound-delivery' }),
        ],
        nextCommands: [
          'pnpm run verify:cc-connect:local-real:api-key',
          'pnpm run verify:cc-connect:local-real:feishu',
          'pnpm run verify:cc-connect:local-real:feishu-inbound',
        ],
      },
    });
    expect(replacementReadinessCheck(readiness, { hardGate: true })).toMatchObject({
      id: 'replacement-readiness',
      status: 'fail',
      details: {
        missingCoverage: [
          expect.objectContaining({ id: 'openai-api-key-provider-model-chat' }),
          expect.objectContaining({ id: 'feishu-live-channel-lifecycle' }),
          expect.objectContaining({ id: 'feishu-live-inbound-delivery' }),
        ],
        nextCommands: [
          'pnpm run verify:cc-connect:local-real:api-key',
          'pnpm run verify:cc-connect:local-real:feishu',
          'pnpm run verify:cc-connect:local-real:feishu-inbound',
        ],
      },
    });
    expect(runtimeMatrixStatus(coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
    }), readiness)).toBe('partial');
  });

  it('distinguishes runtime matrix status from hard-gate status', () => {
    const partialCoverage = coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
    });
    const partialReadiness = buildReplacementReadiness(partialCoverage);
    expect(replacementReadinessCheck(partialReadiness)).toMatchObject({
      status: 'partial',
    });
    expect(replacementReadinessCheck(partialReadiness, { hardGate: true })).toMatchObject({
      status: 'fail',
    });
    expect(runtimeMatrixStatus(partialCoverage, partialReadiness)).toBe('partial');

    const failedCoverage = coverageRows({
      'oauth-core-runtime-parity': 'fail',
    });
    expect(runtimeMatrixStatus(failedCoverage, buildReplacementReadiness(failedCoverage))).toBe('fail');
  });

  it('builds a replacement contract checklist from the user-stated parity constraints', () => {
    const coverage = coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
    });
    const readiness = buildReplacementReadiness(coverage);
    const gaps = buildValidationGaps(readiness, [], null, coverage);
    const checklist = buildReplacementContract(coverage, readiness, gaps);

    expect(checklist).toHaveLength(REPLACEMENT_CONTRACT_ITEMS.length);
    expect(checklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'developer-mode-gate',
        status: 'pass',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'doctor-fix-non-parity',
        status: 'pass',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'runtime-boundary-bridgeplatform-only',
        status: 'pass',
        requiredForLocalReplacementGate: true,
        evidence: expect.stringContaining('Runtime boundary diagnostics: pass'),
      }),
      expect.objectContaining({
        id: 'codex-oauth-and-openai-api-key',
        status: 'partial',
        requiredForLocalReplacementGate: true,
        nextAction: 'pnpm run verify:cc-connect:local-real:api-key',
      }),
      expect.objectContaining({
        id: 'feishu-channel-lifecycle',
        status: 'partial',
        requiredForLocalReplacementGate: true,
        nextAction: 'pnpm run verify:cc-connect:local-real:feishu-inbound',
        evidence: expect.stringContaining('live inbound delivery: not-run'),
      }),
      expect.objectContaining({
        id: 'cron-main-path',
        status: 'pass',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'session-history-parity',
        status: 'pass',
        requiredForLocalReplacementGate: true,
        evidence: expect.stringContaining('Local session/history diagnostics: pass'),
      }),
      expect.objectContaining({
        id: 'token-usage-contract',
        status: 'partial',
        requiredForLocalReplacementGate: true,
      }),
      expect.objectContaining({
        id: 'real-validation-opt-in',
        status: 'pass',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'packaging-platform-smoke',
        status: 'partial',
        requiredForLocalReplacementGate: false,
      }),
    ]));
  });

  it('does not let local diagnostics satisfy live provider or public usage readiness', () => {
    const readiness = buildReplacementReadiness(coverageRows({
      'provider-model-profile-local-diagnostics': 'pass',
      'token-usage-contract-local-diagnostics': 'partial',
      'runtime-management-bundle-local-diagnostics': 'pass',
      'channel-lifecycle-local-bundle': 'pass',
      'cron-lifecycle-local-bundle': 'pass',
      'openai-api-key-provider-model-chat': 'skipped',
    }));

    expect(readiness).toMatchObject({
      status: 'partial',
      replacementReady: false,
      requiredCoverageIds: REPLACEMENT_REQUIRED_COVERAGE_IDS,
      missingCoverage: expect.arrayContaining([
        expect.objectContaining({
          id: 'openai-api-key-provider-model-chat',
          status: 'skipped',
          nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
        }),
        expect.objectContaining({
          id: 'token-usage-contract-local-diagnostics',
          status: 'partial',
        }),
      ]),
    });
    expect(readiness.missingCoverage.map((item) => item.id))
      .not.toContain('provider-model-profile-local-diagnostics');
    expect(readiness.missingCoverage.map((item) => item.id))
      .toContain('token-usage-contract-local-diagnostics');
    expect(readiness.missingCoverage.map((item) => item.id))
      .not.toContain('runtime-management-bundle-local-diagnostics');
    expect(readiness.missingCoverage.map((item) => item.id))
      .not.toContain('channel-lifecycle-local-bundle');
    expect(readiness.missingCoverage.map((item) => item.id))
      .not.toContain('cron-lifecycle-local-bundle');
  });

  it('builds sanitized next actions for missing credentials, coverage, and upstream gaps', () => {
    const readiness = buildReplacementReadiness(coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
    }), [
      {
        id: 'openai-api-key-env',
        required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
        optional: ['CLAWX_REAL_OPENAI_MODEL'],
        nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
        note: 'Set an OpenAI API key in an untracked and gitignored local env file.',
      },
    ]);
    const surface = analyzeCcConnectCliSurface({
      topHelp: 'send\ncron\nsessions\nprovider\nfeishu\nconfig',
      cronAddHelp: '--prompt\n--exec\n--session-mode\n--timeout-mins',
      feishuHelp: 'setup\nbind\nnew\n--platform-type\n--app-id\n--app-secret',
      providerHelp: 'provider add\nprovider list\nprovider remove\nprovider import\nprovider presets\nprovider global',
      sessionsHelp: 'sessions list\nsessions show',
      configExample: 'doctor user-isolation\n[[projects.platforms]]',
    });

    expect(buildNextActions(readiness, readiness.missingPreconditions, surface)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'configure-openai-api-key-env',
        type: 'precondition',
        priority: 'required',
        command: 'pnpm run verify:cc-connect:local-real:api-key',
        required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
        optional: ['CLAWX_REAL_OPENAI_MODEL'],
      }),
      expect.objectContaining({
        id: 'verify-openai-api-key-provider-model-chat',
        type: 'coverage',
        priority: 'required',
        command: 'pnpm run verify:cc-connect:local-real:api-key',
      }),
      expect.objectContaining({
        id: 'upstream-documented-per-platform-channel-connect-disconnect',
        type: 'upstream-gap',
        priority: 'follow-up',
        reason: 'documented per-platform channel connect/disconnect',
      }),
    ]));
  });

  it('builds structured validation gaps for required and residual replacement evidence', () => {
    const readiness = buildReplacementReadiness(coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
    }), [
      {
        id: 'openai-api-key-env',
        status: 'missing',
        required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
        nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
        note: 'Set an OpenAI API key in an untracked and gitignored local env file.',
      },
      {
        id: 'feishu-inbound-fixture',
        status: 'missing',
        required: ['CLAWX_REAL_FEISHU_INBOUND_E2E=1'],
        nextCommand: 'pnpm run verify:cc-connect:local-real:feishu-inbound',
        note: 'Set CLAWX_REAL_FEISHU_INBOUND_E2E=1 before running the real inbound smoke.',
      },
    ]);
    const surface = analyzeCcConnectCliSurface({
      topHelp: 'send\ncron\nsessions\nprovider\nfeishu\nconfig',
      cronAddHelp: '--prompt\n--exec\n--session-mode\n--timeout-mins',
      feishuHelp: 'setup\nbind\nnew\n--platform-type\n--app-id\n--app-secret',
      providerHelp: 'provider add\nprovider list\nprovider remove\nprovider import\nprovider presets\nprovider global',
      sessionsHelp: 'sessions list\nsessions show',
      configExample: 'doctor user-isolation\n[[projects.platforms]]',
    });

    const gaps = buildValidationGaps(readiness, readiness.missingPreconditions, surface, coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
      'scheduled-cron-delivery-local-bundle': 'not-run',
      'scheduled-prompt-cron-delivery-local-bundle': 'not-run',
    }));

    expect(gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'precondition-openai-api-key-env',
        priority: 'required',
        status: 'missing',
        requiredForLocalReplacementGate: true,
      }),
      expect.objectContaining({
        id: 'coverage-openai-api-key-provider-model-chat',
        priority: 'required',
        status: 'skipped',
        requiredForLocalReplacementGate: true,
      }),
      expect.objectContaining({
        id: 'coverage-feishu-live-channel-lifecycle',
        priority: 'required',
        status: 'not-run',
        requiredForLocalReplacementGate: true,
      }),
      expect.objectContaining({
        id: 'upstream-documented-per-platform-channel-connect-disconnect',
        priority: 'follow-up',
        status: 'missing-upstream-primitive',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'coverage-feishu-live-inbound-delivery',
        area: 'feishu-live-inbound-delivery',
        priority: 'required',
        status: 'not-run',
        requiredForLocalReplacementGate: true,
      }),
      expect.objectContaining({
        id: 'real-scheduled-cron-delivery',
        area: 'cron',
        priority: 'follow-up',
        status: 'unverified',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'real-scheduled-prompt-channel-cron-delivery',
        area: 'cron',
        priority: 'follow-up',
        status: 'unverified',
        requiredForLocalReplacementGate: false,
      }),
      expect.objectContaining({
        id: 'upstream-public-token-usage',
        area: 'usage',
        priority: 'required',
        status: 'upstream-blocked',
        requiredForLocalReplacementGate: true,
      }),
    ]));
    expect(gaps.filter((gap) => gap.requiredForLocalReplacementGate).map((gap) => gap.id))
      .toEqual([
        'precondition-openai-api-key-env',
        'precondition-feishu-inbound-fixture',
        'coverage-openai-api-key-provider-model-chat',
        'coverage-feishu-live-channel-lifecycle',
        'coverage-feishu-live-inbound-delivery',
        'upstream-public-token-usage',
      ]);
    const publicUsageGap = gaps.find((gap) => gap.id === 'upstream-public-token-usage');
    expect(publicUsageGap?.reason).toContain('v1.5.0-beta.1');
    expect(publicUsageGap?.reason).toContain('PR #1428');
    expect(publicUsageGap?.reason).toContain('project/provider/model');
    expect(publicUsageGap?.reason).toContain('reconnect/replay');
    expect(gaps.filter((gap) => gap.requiredForLocalReplacementGate === false).map((gap) => gap.id))
      .toEqual(expect.arrayContaining(RESIDUAL_VALIDATION_GAPS
        .filter((gap) => !gap.requiredForLocalReplacementGate)
        .map((gap) => gap.id)));

    const gapsAfterScheduledCron = buildValidationGaps(readiness, readiness.missingPreconditions, surface, coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
      'scheduled-cron-delivery-local-bundle': 'pass',
      'scheduled-prompt-cron-delivery-local-bundle': 'not-run',
    }));
    expect(gapsAfterScheduledCron.map((gap) => gap.id)).not.toContain('real-scheduled-cron-delivery');
    expect(gapsAfterScheduledCron.map((gap) => gap.id)).toContain('real-scheduled-prompt-channel-cron-delivery');

    const gapsAfterPromptDelivery = buildValidationGaps(readiness, readiness.missingPreconditions, surface, coverageRows({
      'openai-api-key-provider-model-chat': 'skipped',
      'feishu-live-channel-lifecycle': 'not-run',
      'feishu-live-inbound-delivery': 'not-run',
      'scheduled-cron-delivery-local-bundle': 'pass',
      'scheduled-prompt-cron-delivery-local-bundle': 'pass',
    }));
    expect(gapsAfterPromptDelivery).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'real-scheduled-prompt-channel-cron-delivery',
        status: 'unverified-channel-delivery',
        nextCommand: 'Run a live tenant-channel scheduled prompt cron smoke once a safe channel fixture is available.',
        reason: expect.stringContaining('Local BridgePlatform prompt delivery passed'),
      }),
    ]));
  });

  it('renders required and optional credential fields in markdown action tables', () => {
    const report = {
      generatedAt: '2026-06-28T00:00:00.000Z',
      status: 'partial',
      runtimeMatrixStatus: 'partial',
      checks: [],
      missingPreconditions: [
        {
          id: 'openai-api-key-env',
          required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
          optional: ['CLAWX_REAL_OPENAI_MODEL'],
          nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
          note: 'Set an API key.',
        },
      ],
      nextActions: [
        {
          id: 'configure-openai-api-key-env',
          type: 'precondition',
          priority: 'required',
          command: 'pnpm run verify:cc-connect:local-real:api-key',
          reason: 'Set an API key.',
          required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
          optional: ['CLAWX_REAL_OPENAI_MODEL'],
        },
      ],
      validationGaps: [
        {
          id: 'precondition-openai-api-key-env',
          area: 'preconditions',
          priority: 'required',
          status: 'missing',
          requiredForLocalReplacementGate: true,
          nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
          reason: 'Set an API key.',
          required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
          optional: ['CLAWX_REAL_OPENAI_MODEL'],
        },
      ],
      replacementContract: [
        {
          id: 'codex-oauth-and-openai-api-key',
          area: 'providers',
          status: 'partial',
          requiredForLocalReplacementGate: true,
          expectedState: 'oauth-and-api-key-verifiable',
          requirement: 'Codex OAuth and OpenAI API-key modes are supported and explicitly verifiable.',
          evidence: 'Real OpenAI API-key row is skipped.',
          nextAction: 'pnpm run verify:cc-connect:local-real:api-key',
        },
      ],
    };

    const markdown = toMarkdown(report);

    expect(markdown).toContain('| ID | Required | Optional | Next Command | Note |');
    expect(markdown).toContain('## Replacement Contract Checklist');
    expect(markdown).toContain('| ID | Area | Status | Required For Local Gate | Expected State | Requirement | Evidence | Next Action |');
    expect(markdown).toContain('| ID | Type | Priority | Required | Optional | Command or Action | Reason |');
    expect(markdown).toContain('| ID | Area | Priority | Status | Blocks Local Gate | Required | Optional | Next Command or Action | Reason |');
    expect(markdown).toContain('codex-oauth-and-openai-api-key | providers | PARTIAL | yes | oauth-and-api-key-verifiable');
    expect(markdown).toContain('CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY | CLAWX_REAL_OPENAI_MODEL |');
  });
});
