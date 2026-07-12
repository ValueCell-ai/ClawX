#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  toJson as toExternalGateHandoffJson,
  toMarkdown as toExternalGateHandoffMarkdown,
} from './cc-connect-real-gate-handoff.mjs';
import { collectMissingRuntimeBundles } from './verify-runtime-bundles.mjs';
import {
  defaultPackagedAppPath,
  packagedExecutablePath,
} from './packaged-runtime-layout.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDir = join(root, 'artifacts', 'cc-connect');
const jsonReportPath = join(reportDir, 'local-real-validation-report.json');
const markdownReportPath = join(reportDir, 'local-real-validation-report.md');
const externalGateHandoffPath = join(reportDir, 'local-real-external-gates.md');
const externalGateHandoffJsonPath = join(reportDir, 'local-real-external-gates.json');
const COVERAGE_IDS = [
  'runtime-bundles-current-platform',
  'runtime-boundary-bridgeplatform-only',
  'session-history-parity-local-diagnostics',
  'real-spec-compile-and-skip-paths',
  'codex-oauth-lifecycle-local-diagnostics',
  'codex-oauth-host-api-lifecycle-local',
  'provider-model-profile-local-diagnostics',
  'token-usage-contract-local-diagnostics',
  'runtime-management-bundle-local-diagnostics',
  'bridge-media-packets-local-diagnostics',
  'bridge-rich-packets-local-diagnostics',
  'channel-lifecycle-local-bundle',
  'cron-lifecycle-local-bundle',
  'scheduled-cron-delivery-local-bundle',
  'scheduled-prompt-cron-delivery-local-bundle',
  'local-openai-compatible-api-key-chat',
  'chat-abort-local-openai-compatible',
  'oauth-core-runtime-parity',
  'generated-file-card-real-oauth',
  'openai-api-key-provider-model-chat',
  'feishu-live-channel-lifecycle',
  'feishu-live-inbound-delivery',
  'packaged-oauth-runtime-smoke',
];
const REPLACEMENT_REQUIRED_COVERAGE_IDS = [
  'runtime-bundles-current-platform',
  'runtime-boundary-bridgeplatform-only',
  'session-history-parity-local-diagnostics',
  'real-spec-compile-and-skip-paths',
  'codex-oauth-lifecycle-local-diagnostics',
  'codex-oauth-host-api-lifecycle-local',
  'chat-abort-local-openai-compatible',
  'token-usage-contract-local-diagnostics',
  'oauth-core-runtime-parity',
  'openai-api-key-provider-model-chat',
  'feishu-live-channel-lifecycle',
  'feishu-live-inbound-delivery',
  'packaged-oauth-runtime-smoke',
];

const REQUIRED_CODEX_AUTH_TOKEN_KEYS = ['access_token', 'account_id', 'id_token', 'refresh_token'];

const RESIDUAL_VALIDATION_GAPS = [
  {
    id: 'upstream-public-token-usage',
    area: 'usage',
    priority: 'required',
    status: 'upstream-blocked',
    requiredForLocalReplacementGate: true,
    nextCommand: 'Upgrade to a pinned cc-connect release with a versioned, attributable, replayable per-turn usage API/event, then implement and verify RuntimeUsageRecord mapping.',
    reason: 'cc-connect v1.4.1 and v1.5.0-beta.1 expose no versioned Bridge or Management usage payload. Upstream PR #1428 proposes an unmerged observer, but omits project/provider/model attribution and durable reconnect/replay semantics. ClawX intentionally returns missing cc-connect usage instead of parsing footers or reading private session/Codex transcript files.',
  },
  {
    id: 'real-scheduled-prompt-channel-cron-delivery',
    area: 'cron',
    priority: 'follow-up',
    status: 'unverified',
    requiredForLocalReplacementGate: false,
    nextCommand: 'Run a live tenant-channel scheduled prompt cron smoke once a safe channel fixture is available.',
    reason: 'Scheduled exec cron and ClawX BridgePlatform prompt cron delivery are covered separately. Live tenant-channel scheduled prompt delivery remains distinct and requires a safe channel fixture.',
  },
  {
    id: 'rich-generated-media-packet-delivery',
    area: 'chat',
    priority: 'follow-up',
    status: 'unverified',
    requiredForLocalReplacementGate: false,
    nextCommand: 'Add a real cc-connect rich media/card packet delivery smoke once the upstream packet path is stable.',
    reason: 'Real OAuth covers Codex apply_patch-generated file cards through cc-connect, and adapter diagnostics cover media/rich packet mapping. Real upstream rich media/card/button/preview/update/delete packet delivery beyond generated-file cards remains unverified.',
  },
  {
    id: 'notarized-macos-dmg-zip-smoke',
    area: 'packaging',
    priority: 'follow-up',
    status: 'unverified',
    requiredForLocalReplacementGate: false,
    nextCommand: 'Run notarized macOS dmg/zip smoke in release validation.',
    reason: 'Current packaged smoke targets a macOS dir app; notarized dmg/zip installation behavior is not covered by the local verifier.',
  },
  {
    id: 'native-target-release-smoke-observation',
    area: 'packaging',
    priority: 'follow-up',
    status: 'unverified',
    requiredForLocalReplacementGate: false,
    nextCommand: 'Observe the macOS x64/arm64, Windows x64, and Linux x64/arm64 native packaged smoke jobs in a release workflow run.',
    reason: 'The release workflow defines native startup/health/rollback/cleanup jobs for all supported targets, but a local verifier run cannot attest to their remote outcome.',
  },
];

const REPLACEMENT_CONTRACT_ITEMS = [
  {
    id: 'developer-mode-gate',
    area: 'release-gating',
    requirement: 'cc-connect remains gated behind Developer Mode.',
    expectedState: 'unchanged',
    requiredForLocalReplacementGate: false,
  },
  {
    id: 'doctor-fix-non-parity',
    area: 'doctor',
    requirement: 'cc-connect Doctor may exist, but cc-connect Doctor Fix is not required to replace OpenClaw Doctor Fix.',
    expectedState: 'documented-non-goal',
    requiredForLocalReplacementGate: false,
  },
  {
    id: 'runtime-boundary-bridgeplatform-only',
    area: 'runtime-boundary',
    requirement: 'ClawX chat/session/history/tool execution in cc-connect mode must flow through cc-connect BridgePlatform or cc-connect-owned stores, not direct Codex execution.',
    expectedState: 'bridgeplatform-only',
    requiredForLocalReplacementGate: true,
  },
  {
    id: 'codex-oauth-and-openai-api-key',
    area: 'providers',
    requirement: 'Codex OAuth and OpenAI API-key modes are supported and explicitly verifiable.',
    expectedState: 'oauth-and-api-key-verifiable',
    requiredForLocalReplacementGate: true,
  },
  {
    id: 'provider-model-matrix',
    area: 'providers',
    requirement: 'Provider/model support is narrower than OpenClaw and must stay explicit instead of being implied by runtime selection.',
    expectedState: 'partial-matrix-with-stable-errors',
    requiredForLocalReplacementGate: false,
  },
  {
    id: 'feishu-channel-lifecycle',
    area: 'channels',
    requirement: 'Channel lifecycle is runtime-owned, with Feishu/Lark projection and live lifecycle tracked separately.',
    expectedState: 'local-projection-plus-live-gate',
    requiredForLocalReplacementGate: true,
  },
  {
    id: 'cron-main-path',
    area: 'cron',
    requirement: 'Cron supports the prompt-job/main-path contract while distinguishing local BridgePlatform delivery from live tenant-channel delivery.',
    expectedState: 'local-lifecycle-plus-scheduled-exec-and-prompt',
    requiredForLocalReplacementGate: false,
  },
  {
    id: 'session-history-parity',
    area: 'sessions',
    requirement: 'Session/history parity covers cross-agent, named-session, title, and workspace isolation paths.',
    expectedState: 'runtime-routed-session-history',
    requiredForLocalReplacementGate: true,
  },
  {
    id: 'token-usage-contract',
    area: 'usage',
    requirement: 'Token usage follows the runtime contract and does not silently mix OpenClaw or user-global Codex data.',
    expectedState: 'public-runtime-usage-required',
    requiredForLocalReplacementGate: true,
  },
  {
    id: 'real-validation-opt-in',
    area: 'validation',
    requirement: 'Real OpenAI/Feishu/OAuth validation remains opt-in rather than default CI.',
    expectedState: 'opt-in',
    requiredForLocalReplacementGate: false,
  },
  {
    id: 'packaging-platform-smoke',
    area: 'packaging',
    requirement: 'Packaging smoke covers current local platform, while all-platform final artifact smoke remains release validation.',
    expectedState: 'current-platform-local',
    requiredForLocalReplacementGate: false,
  },
];

function parseArgs(argv) {
  const result = {
    run: false,
    includeOAuth: false,
    includePackaged: false,
    includePackagedOAuth: false,
    includeOpenAiApiKey: false,
    includeFeishu: false,
    includeFeishuInbound: false,
    includeScheduledCron: false,
    strictReal: false,
    requireReplacementReady: false,
    requireCoverage: [],
    envFiles: [],
    noWrite: false,
    writeHandoff: false,
    externalGatesOnly: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--run') result.run = true;
    else if (arg === '--include-oauth') result.includeOAuth = true;
    else if (arg === '--include-packaged') result.includePackaged = true;
    else if (arg === '--include-packaged-oauth') result.includePackagedOAuth = true;
    else if (arg === '--include-openai-api-key') result.includeOpenAiApiKey = true;
    else if (arg === '--include-feishu') result.includeFeishu = true;
    else if (arg === '--include-feishu-inbound') result.includeFeishuInbound = true;
    else if (arg === '--include-scheduled-cron') result.includeScheduledCron = true;
    else if (arg === '--strict-real') result.strictReal = true;
    else if (arg === '--require-replacement-ready') result.requireReplacementReady = true;
    else if (arg === '--no-write') result.noWrite = true;
    else if (arg === '--write-handoff') result.writeHandoff = true;
    else if (arg === '--external-gates-only') result.externalGatesOnly = true;
    else if (arg.startsWith('--require-coverage=')) {
      result.requireCoverage.push(...arg.slice('--require-coverage='.length).split(',').map((value) => value.trim()).filter(Boolean));
    }
    else if (arg.startsWith('--env-file=')) result.envFiles.push(arg.slice('--env-file='.length));
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function shouldWriteReport(args) {
  return !args.noWrite;
}

function shouldWriteHandoff(args) {
  return shouldWriteReport(args) && args.writeHandoff;
}

function usage() {
  return [
    'Usage: node scripts/verify-cc-connect-local-real.mjs [--run] [--external-gates-only] [--include-oauth] [--include-openai-api-key] [--include-feishu] [--include-feishu-inbound] [--include-scheduled-cron] [--include-packaged] [--include-packaged-oauth] [--env-file=<path>] [--strict-real] [--require-coverage=<all|id,id>] [--require-replacement-ready] [--write-handoff] [--no-write]',
    '',
    'Default mode records a local cc-connect real-validation preflight report.',
    'By default it also loads untracked and gitignored local env files when present: .env.cc-connect.local, .env.local, .env.',
    'Use .env.cc-connect.local.example as the field template for local real credentials.',
    '--run executes safe local commands: runtime bundle verification and real credential E2E skip/compile paths.',
    '--external-gates-only skips the safe local baseline commands and runs only explicitly included credential-gated paths.',
    '--include-oauth additionally runs the gated real OAuth comprehensive E2E when CLAWX_REAL_CODEX_AUTH_JSON points at a Codex auth.json.',
    '--include-openai-api-key additionally runs the real OpenAI API-key E2E when CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY is available.',
    '--include-feishu additionally runs the real Feishu/Lark channel E2E when required Feishu/Lark env and CLAWX_REAL_CODEX_AUTH_JSON are available.',
    '--include-feishu-inbound additionally runs the manual real Feishu/Lark inbound message E2E when CLAWX_REAL_FEISHU_INBOUND_E2E=1 and required credentials are available.',
    '--include-scheduled-cron additionally waits for a real cc-connect exec cron scheduler tick without external credentials.',
    '--include-packaged additionally runs packaged cc-connect smoke when release/mac-<arch>/ClawX.app exists.',
    '--include-packaged-oauth additionally runs packaged cc-connect smoke with real OAuth when release/mac-<arch>/ClawX.app exists and CLAWX_REAL_CODEX_AUTH_JSON points at a Codex auth.json.',
    '--env-file=<path> loads an additional local env file for this verifier; process env values still win.',
    'CLAWX_REAL_ENV_FILE and CLAWX_REAL_ENV_FILES may also point at additional local env files, matching the direct real E2E helpers.',
    '--strict-real exits non-zero when real OpenAI API key or Feishu/Lark credentials are missing.',
    '--require-coverage=<all|id,id> exits non-zero unless the selected runtime parity coverage rows are PASS.',
    '--require-replacement-ready exits non-zero unless every replacement-readiness coverage row is PASS.',
    '--write-handoff also writes artifacts/cc-connect/local-real-external-gates.{md,json} from the same sanitized report.',
    '--no-write evaluates the verifier without overwriting the last JSON/Markdown report artifacts.',
  ].join('\n');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function executableExists(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function currentTarget() {
  return `${process.platform}-${process.arch}`;
}

function binaryName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function currentBundlePaths() {
  const target = currentTarget();
  return {
    ccConnect: join(root, 'build', 'cc-connect', target, binaryName('cc-connect')),
    codex: join(root, 'build', 'codex', target, 'bin', binaryName('codex')),
  };
}

const CC_CONNECT_CLI_PROBES = [
  ['topHelp', ['--help']],
  ['cronAddHelp', ['cron', 'add', '--help']],
  ['feishuHelp', ['feishu', '--help']],
  ['providerHelp', ['provider', '--help']],
  ['sessionsHelp', ['sessions', '--help']],
  ['configExample', ['config', 'example']],
];

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

function analyzeCcConnectCliSurface(probeText) {
  const topHelp = probeText.topHelp || '';
  const cronAddHelp = probeText.cronAddHelp || '';
  const feishuHelp = probeText.feishuHelp || '';
  const providerHelp = probeText.providerHelp || '';
  const sessionsHelp = probeText.sessionsHelp || '';
  const configExample = probeText.configExample || '';

  const surface = {
    commands: {
      send: topHelp.includes('send'),
      cron: topHelp.includes('cron'),
      sessions: topHelp.includes('sessions'),
      provider: topHelp.includes('provider'),
      feishu: topHelp.includes('feishu'),
      config: topHelp.includes('config'),
      doctorUserIsolation: topHelp.includes('doctor') || configExample.includes('doctor user-isolation'),
    },
    cron: {
      promptJobs: cronAddHelp.includes('--prompt'),
      execJobs: cronAddHelp.includes('--exec'),
      sessionMode: cronAddHelp.includes('--session-mode') || configExample.includes('session_mode'),
      timeoutMins: cronAddHelp.includes('--timeout-mins') || configExample.includes('timeout_mins'),
    },
    sessions: {
      list: includesAll(sessionsHelp, ['sessions list']),
      show: includesAll(sessionsHelp, ['sessions show']),
    },
    providers: {
      add: providerHelp.includes('provider add'),
      list: providerHelp.includes('provider list'),
      remove: providerHelp.includes('provider remove'),
      import: providerHelp.includes('provider import'),
      presets: providerHelp.includes('provider presets'),
      global: providerHelp.includes('provider global'),
    },
    feishu: {
      setup: feishuHelp.includes('setup'),
      bind: feishuHelp.includes('bind'),
      new: feishuHelp.includes('new'),
      platformType: feishuHelp.includes('--platform-type'),
      appIdSecret: feishuHelp.includes('--app-id') && feishuHelp.includes('--app-secret'),
    },
    channelLifecycle: {
      documentedConnectDisconnect: /^\s+(connect|disconnect)\b/im.test(feishuHelp)
        || /\bcc-connect\s+feishu\s+(connect|disconnect)\b/i.test(feishuHelp),
      documentedReloadStatus: topHelp.includes('config') && configExample.includes('[[projects.platforms]]'),
    },
  };
  const missingPrimitives = [];
  if (!surface.channelLifecycle.documentedConnectDisconnect) {
    missingPrimitives.push('documented per-platform channel connect/disconnect');
  }
  if (!surface.cron.execJobs) {
    missingPrimitives.push('cron exec jobs');
  }
  if (!surface.cron.promptJobs) {
    missingPrimitives.push('cron prompt jobs');
  }
  if (!surface.sessions.list || !surface.sessions.show) {
    missingPrimitives.push('session list/show CLI');
  }
  if (!surface.commands.doctorUserIsolation) {
    missingPrimitives.push('doctor user-isolation evidence');
  }
  return {
    ...surface,
    missingPrimitives,
  };
}

async function runCcConnectCliProbe(binaryPath, args) {
  try {
    const result = await execFileAsync(binaryPath, args, {
      cwd: root,
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return [result.stdout || '', result.stderr || ''].join('\n');
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const message = error instanceof Error ? error.message : String(error);
    return [stdout, stderr, message].filter(Boolean).join('\n');
  }
}

async function readCcConnectCliSurface(binaryPath) {
  const probeEntries = await Promise.all(CC_CONNECT_CLI_PROBES.map(async ([name, args]) => [
    name,
    await runCcConnectCliProbe(binaryPath, args),
  ]));
  return analyzeCcConnectCliSurface(Object.fromEntries(probeEntries));
}

function packagedAppPath() {
  return defaultPackagedAppPath({ rootDir: root });
}

function defaultCodexAuthPath() {
  return join(homedir(), '.codex', 'auth.json');
}

function stripOptionalQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(contents) {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = stripOptionalQuotes(normalized.slice(separator + 1));
    parsed[key] = value;
  }
  return parsed;
}

async function loadLocalEnvFiles(args) {
  const defaultFiles = [
    join(root, '.env.cc-connect.local'),
    join(root, '.env.local'),
    join(root, '.env'),
  ];
  const requestedFiles = [
    ...extraLocalRealEnvFiles(process.env),
    ...args.envFiles,
  ].map((file) => resolve(root, file));
  const files = [...new Set([...defaultFiles, ...requestedFiles])];
  const loaded = {};
  const summaries = [];
  for (const file of files) {
    const safety = await localEnvFileSafety(file);
    if (!await pathExists(file)) {
      summaries.push({ name: basename(file), exists: false, loaded: false, variableNames: [], safety });
      continue;
    }
    if (safety.location === 'repo' && safety.safe !== true) {
      summaries.push({
        name: basename(file),
        exists: true,
        loaded: false,
        variableNames: [],
        safety,
        skippedReason: 'repo-local env files must be untracked and gitignored before they can be loaded',
      });
      continue;
    }
    const parsed = parseEnvFile(await readFile(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined && loaded[key] === undefined) {
        loaded[key] = value;
      }
    }
    summaries.push({
      name: basename(file),
      exists: true,
      loaded: true,
      variableNames: Object.keys(parsed).sort(),
      safety,
    });
  }
  return { env: loaded, summaries };
}

function extraLocalRealEnvFiles(env) {
  const single = env.CLAWX_REAL_ENV_FILE?.trim();
  const multiple = env.CLAWX_REAL_ENV_FILES
    ?.split(delimiter)
    .map((file) => file.trim())
    .filter(Boolean) ?? [];
  return [...new Set([
    ...(single ? [single] : []),
    ...multiple,
  ])];
}

function isPathInsideRoot(file) {
  const rel = relative(root, file);
  return Boolean(rel) && !rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\');
}

function parseAuthExpiryTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return undefined;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function codexAuthExpirySummary(value, nowMs = Date.now()) {
  const expirations = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (/^(expires_at|expiresAt|expiry|expires|expiration|expiration_time|expirationTime)$/i.test(key)) {
        const ts = parseAuthExpiryTimestamp(child);
        if (ts !== undefined) expirations.push(ts);
      }
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(value);
  if (expirations.length === 0) {
    return { expiryStatus: 'unknown', expiresAt: null, expired: false };
  }
  const earliest = Math.min(...expirations);
  return {
    expiryStatus: earliest <= nowMs ? 'expired' : 'valid',
    expiresAt: new Date(earliest).toISOString(),
    expired: earliest <= nowMs,
  };
}

async function isGitIgnored(file) {
  try {
    await execFileAsync('git', ['check-ignore', '--quiet', '--', file], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

async function isGitTracked(file) {
  if (!isPathInsideRoot(file)) return false;
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relative(root, file)], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

async function localEnvFileSafety(file) {
  if (!isPathInsideRoot(file)) {
    return { location: 'outside-repo', gitignored: true, tracked: false, safe: true };
  }
  const [gitignored, tracked] = await Promise.all([
    isGitIgnored(file),
    isGitTracked(file),
  ]);
  return {
    location: 'repo',
    gitignored,
    tracked,
    safe: gitignored && !tracked,
  };
}

async function readCodexAuthSummary(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const tokens = value && typeof value === 'object' && value.tokens && typeof value.tokens === 'object'
      ? value.tokens
      : null;
    const tokenKeys = tokens
      ? Object.keys(value.tokens).sort()
      : [];
    const missingTokenKeys = REQUIRED_CODEX_AUTH_TOKEN_KEYS
      .filter((key) => typeof tokens?.[key] !== 'string' || !tokens[key].trim());
    const expiry = codexAuthExpirySummary(value);
    return {
      exists: true,
      hasTokens: tokenKeys.length > 0,
      completeTokens: missingTokenKeys.length === 0,
      tokenKeys,
      missingTokenKeys,
      openAiApiKey: openAiApiKeyCandidateSummary(value?.OPENAI_API_KEY),
      ...expiry,
    };
  } catch {
    return {
      exists: false,
      hasTokens: false,
      completeTokens: false,
      tokenKeys: [],
      missingTokenKeys: REQUIRED_CODEX_AUTH_TOKEN_KEYS,
      openAiApiKey: openAiApiKeyCandidateSummary(undefined),
      expiryStatus: 'unknown',
      expiresAt: null,
      expired: false,
    };
  }
}

function openAiApiKeyCandidateSummary(value) {
  const valueType = value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value;
  if (typeof value === 'string') {
    const length = value.trim().length;
    return {
      present: true,
      usable: length > 0,
      valueType,
      length,
      reason: length > 0 ? 'non-empty string' : 'empty string',
    };
  }
  return {
    present: value !== undefined,
    usable: false,
    valueType,
    length: 0,
    reason: value === undefined ? 'missing' : 'must be a non-empty string',
  };
}

function openAiApiKeyPreconditionMessage(configured, requested, candidateSummary) {
  if (configured) {
    return requested
      ? 'OpenAI API key real E2E environment is configured and selected for this run.'
      : 'OpenAI API key real E2E environment is configured; the real API-key E2E was not requested in this run.';
  }
  if (!candidateSummary?.present) {
    return 'OpenAI API key real E2E environment is not configured.';
  }
  if (candidateSummary.valueType === 'string' && candidateSummary.length === 0) {
    return 'Codex auth metadata contains an empty OPENAI_API_KEY; configure CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY for real API-key validation.';
  }
  return `Codex auth metadata contains OPENAI_API_KEY as ${candidateSummary.valueType}; configure CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY with a non-empty string for real API-key validation.`;
}

async function readCodexAuthOpenAiApiKey(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const candidate = value?.OPENAI_API_KEY;
    return typeof candidate === 'string' ? candidate.trim() : '';
  } catch {
    return '';
  }
}

async function listProcessCommandsContaining(needle) {
  if (process.platform === 'win32') return [];
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes(needle))
      .filter((line) => !line.includes('ps -axo'));
  } catch {
    return [];
  }
}

function createCheck(id, status, message, details = {}) {
  return { id, status, message, details };
}

function requiredCoverageIds(values) {
  const requested = values.flatMap((value) => (
    value === 'all' ? COVERAGE_IDS : value.split(',').map((item) => item.trim()).filter(Boolean)
  ));
  return [...new Set(requested)];
}

function requiredCoverageCheck(coverage, requestedValues) {
  const ids = requiredCoverageIds(requestedValues);
  if (ids.length === 0) return null;
  const known = new Set(COVERAGE_IDS);
  const unknown = ids.filter((id) => !known.has(id));
  const byId = new Map(coverage.map((item) => [item.id, item]));
  const missing = ids
    .map((id) => byId.get(id) || { id, status: 'not-run', reason: 'Coverage row is missing.' })
    .filter((item) => item.status !== 'pass');
  if (unknown.length > 0 || missing.length > 0) {
    return createCheck(
      'required-coverage',
      'fail',
      'One or more explicitly requested runtime parity coverage rows are not PASS.',
      { required: ids, unknown, missing },
    );
  }
  return createCheck(
    'required-coverage',
    'pass',
    'All explicitly requested runtime parity coverage rows are PASS.',
    { required: ids },
  );
}

function readinessNextCommand(id) {
  switch (id) {
    case 'runtime-bundles-current-platform':
      return 'pnpm run verify:runtime-bundles';
    case 'real-spec-compile-and-skip-paths':
      return 'pnpm run verify:cc-connect:local-real:run';
    case 'runtime-boundary-bridgeplatform-only':
      return 'pnpm run verify:cc-connect:local-real:run';
    case 'session-history-parity-local-diagnostics':
      return 'pnpm run verify:cc-connect:local-real:run';
    case 'oauth-core-runtime-parity':
      return 'pnpm run verify:cc-connect:local-real:oauth';
    case 'openai-api-key-provider-model-chat':
      return 'pnpm run verify:cc-connect:local-real:api-key';
    case 'chat-abort-local-openai-compatible':
      return 'pnpm run verify:cc-connect:local-real:api-key';
    case 'feishu-live-channel-lifecycle':
      return 'pnpm run verify:cc-connect:local-real:feishu';
    case 'feishu-live-inbound-delivery':
      return 'pnpm run verify:cc-connect:local-real:feishu-inbound';
    case 'scheduled-cron-delivery-local-bundle':
      return 'pnpm run verify:cc-connect:local-real:scheduled-cron';
    case 'token-usage-contract-local-diagnostics':
      return 'Upgrade to a pinned cc-connect release with a versioned, attributable, replayable per-turn usage API/event, then implement RuntimeUsageRecord mapping.';
    case 'packaged-oauth-runtime-smoke':
      return 'pnpm run verify:cc-connect:local-real:packaged-oauth';
    default:
      return 'pnpm run verify:cc-connect:local-real:all-strict';
  }
}

function buildReplacementReadiness(coverage, missingPreconditions = []) {
  const byId = new Map(coverage.map((item) => [item.id, item]));
  const required = REPLACEMENT_REQUIRED_COVERAGE_IDS.map((id) => {
    const row = byId.get(id) || {
      id,
      status: 'not-run',
      reason: 'Coverage row is missing.',
    };
    return {
      id,
      status: row.status,
      ready: row.status === 'pass',
      reason: row.reason || '',
      evidence: row.evidence || '',
      nextCommand: row.status === 'pass' ? '' : readinessNextCommand(id),
    };
  });
  const missingCoverage = required.filter((item) => !item.ready);
  return {
    status: missingCoverage.length === 0 ? 'ready' : 'partial',
    replacementReady: missingCoverage.length === 0,
    requiredCoverageIds: REPLACEMENT_REQUIRED_COVERAGE_IDS,
    passedCoverageIds: required.filter((item) => item.ready).map((item) => item.id),
    missingCoverage,
    missingPreconditions,
    nextCommands: Array.from(new Set(missingCoverage.map((item) => item.nextCommand).filter(Boolean))),
    note: missingCoverage.length === 0
      ? 'All local real runtime parity coverage rows passed for this verifier matrix.'
      : 'cc-connect is not replacement-ready on this verifier matrix until every required runtime parity coverage row is PASS.',
  };
}

function replacementReadinessCheck(readiness, options = {}) {
  if (readiness.replacementReady) {
    return createCheck(
      'replacement-readiness',
      'pass',
      'All replacement-readiness runtime parity coverage rows are PASS.',
      { requiredCoverageIds: readiness.requiredCoverageIds },
    );
  }
  if (!options.hardGate) {
    return createCheck(
      'replacement-readiness',
      'partial',
      'Replacement-readiness coverage is incomplete; this check is informational unless --require-replacement-ready is set.',
      {
        missingCoverage: readiness.missingCoverage,
        missingPreconditions: readiness.missingPreconditions,
        nextCommands: readiness.nextCommands,
      },
    );
  }
  return createCheck(
    'replacement-readiness',
    'fail',
    'cc-connect is not replacement-ready for this verifier matrix.',
    {
      missingCoverage: readiness.missingCoverage,
      missingPreconditions: readiness.missingPreconditions,
      nextCommands: readiness.nextCommands,
    },
  );
}

function runtimeMatrixStatus(coverage, replacementReadiness) {
  if (coverage.some((item) => item.status === 'fail')) return 'fail';
  if (coverage.some((item) => item.status !== 'pass') || !replacementReadiness.replacementReady) {
    return 'partial';
  }
  return 'pass';
}

function coverageById(coverage, id) {
  return coverage.find((item) => item.id === id) || { id, status: 'not-run', reason: 'Coverage row is missing.' };
}

function coverageEvidence(row) {
  return row.evidence || row.reason || 'No evidence recorded.';
}

function buildReplacementContract(coverage, replacementReadiness, validationGaps = []) {
  const row = (id) => coverageById(coverage, id);
  const gapIds = new Set(validationGaps.map((gap) => gap.id));
  return REPLACEMENT_CONTRACT_ITEMS.map((item) => {
    switch (item.id) {
      case 'developer-mode-gate':
        return {
          ...item,
          status: 'pass',
          evidence: 'Developer Mode gating is intentionally kept as the release control for cc-connect.',
          nextAction: '',
        };
      case 'doctor-fix-non-parity':
        return {
          ...item,
          status: 'pass',
          evidence: 'cc-connect doctor user-isolation is covered; OpenClaw Doctor Fix replacement is an explicit non-goal.',
          nextAction: '',
        };
      case 'runtime-boundary-bridgeplatform-only': {
        const boundary = row('runtime-boundary-bridgeplatform-only');
        return {
          ...item,
          status: boundary.status === 'pass' ? 'pass' : 'partial',
          evidence: `Runtime boundary diagnostics: ${boundary.status} (${coverageEvidence(boundary)}).`,
          nextAction: boundary.status === 'pass' ? '' : 'pnpm run verify:cc-connect:local-real:run',
        };
      }
      case 'codex-oauth-and-openai-api-key': {
        const oauth = row('oauth-core-runtime-parity');
        const localApiKey = row('local-openai-compatible-api-key-chat');
        const realApiKey = row('openai-api-key-provider-model-chat');
        const ready = oauth.status === 'pass' && localApiKey.status === 'pass' && realApiKey.status === 'pass';
        return {
          ...item,
          status: ready ? 'pass' : 'partial',
          evidence: [
            `OAuth: ${oauth.status} (${coverageEvidence(oauth)})`,
            `Local OpenAI-compatible API-key: ${localApiKey.status} (${coverageEvidence(localApiKey)})`,
            `Real OpenAI API-key: ${realApiKey.status} (${coverageEvidence(realApiKey)})`,
          ].join(' | '),
          nextAction: ready ? '' : 'pnpm run verify:cc-connect:local-real:api-key',
        };
      }
      case 'provider-model-matrix': {
        const diagnostics = row('provider-model-profile-local-diagnostics');
        const realApiKey = row('openai-api-key-provider-model-chat');
        return {
          ...item,
          status: realApiKey.status === 'pass' ? 'pass' : 'partial',
          evidence: `Local diagnostics: ${diagnostics.status} (${coverageEvidence(diagnostics)}); real OpenAI API-key row: ${realApiKey.status}. Unsupported providers remain stable errors, not implied parity.`,
          nextAction: realApiKey.status === 'pass' ? '' : 'pnpm run verify:cc-connect:local-real:api-key',
        };
      }
      case 'feishu-channel-lifecycle': {
        const local = row('channel-lifecycle-local-bundle');
        const live = row('feishu-live-channel-lifecycle');
        const inbound = row('feishu-live-inbound-delivery');
        const ready = local.status === 'pass' && live.status === 'pass' && inbound.status === 'pass';
        return {
          ...item,
          status: ready ? 'pass' : 'partial',
          evidence: `Local projection/lifecycle: ${local.status} (${coverageEvidence(local)}); live Feishu/Lark lifecycle: ${live.status} (${coverageEvidence(live)}); live inbound delivery: ${inbound.status} (${coverageEvidence(inbound)}).`,
          nextAction: ready ? '' : 'pnpm run verify:cc-connect:local-real:feishu-inbound',
        };
      }
      case 'cron-main-path': {
        const lifecycle = row('cron-lifecycle-local-bundle');
        const scheduledExec = row('scheduled-cron-delivery-local-bundle');
        const scheduledPrompt = row('scheduled-prompt-cron-delivery-local-bundle');
        return {
          ...item,
          status: lifecycle.status === 'pass' && scheduledExec.status === 'pass' && scheduledPrompt.status === 'pass' ? 'pass' : 'partial',
          evidence: `Lifecycle: ${lifecycle.status} (${coverageEvidence(lifecycle)}); scheduled exec: ${scheduledExec.status} (${coverageEvidence(scheduledExec)}); scheduled prompt BridgePlatform: ${scheduledPrompt.status} (${coverageEvidence(scheduledPrompt)}).`,
          nextAction: scheduledExec.status === 'pass' && scheduledPrompt.status === 'pass'
            ? 'Run a real tenant-channel scheduled prompt cron smoke when a safe channel fixture is available.'
            : 'pnpm run verify:cc-connect:local-real:scheduled-cron',
        };
      }
      case 'session-history-parity': {
        const local = row('session-history-parity-local-diagnostics');
        const oauth = row('oauth-core-runtime-parity');
        return {
          ...item,
          status: local.status === 'pass' ? 'pass' : 'partial',
          evidence: [
            `Local session/history diagnostics: ${local.status} (${coverageEvidence(local)})`,
            `Real OAuth comprehensive session path: ${oauth.status} (${coverageEvidence(oauth)})`,
          ].join(' | '),
          nextAction: local.status === 'pass' ? '' : 'pnpm run verify:cc-connect:local-real:run',
        };
      }
      case 'token-usage-contract': {
        const usage = row('token-usage-contract-local-diagnostics');
        return {
          ...item,
          status: 'partial',
          evidence: `Private-data boundary diagnostics: ${usage.status} (${coverageEvidence(usage)}). Public per-turn cc-connect usage remains upstream-blocked.`,
          nextAction: 'Upgrade to a pinned cc-connect release with a versioned, attributable, replayable per-turn usage API/event, then implement RuntimeUsageRecord mapping.',
        };
      }
      case 'real-validation-opt-in':
        return {
          ...item,
          status: 'pass',
          evidence: 'Real OpenAI API-key and Feishu/Lark rows are recorded as explicit opt-in coverage and skipped when credentials are unavailable.',
          nextAction: '',
        };
      case 'packaging-platform-smoke': {
        const packaged = row('packaged-oauth-runtime-smoke');
        const allPlatformOpen = gapIds.has('native-target-release-smoke-observation') || gapIds.has('notarized-macos-dmg-zip-smoke');
        return {
          ...item,
          status: packaged.status === 'pass' && !allPlatformOpen ? 'pass' : 'partial',
          evidence: `Current packaged smoke: ${packaged.status} (${coverageEvidence(packaged)}); all-platform/release artifact gaps: ${allPlatformOpen ? 'open' : 'closed'}.`,
          nextAction: allPlatformOpen ? 'Observe all native target smoke jobs and notarized macOS artifact smoke in release validation.' : '',
        };
      }
      default:
        return {
          ...item,
          status: replacementReadiness.replacementReady ? 'pass' : 'partial',
          evidence: replacementReadiness.note,
          nextAction: '',
        };
    }
  });
}

function buildValidationGaps(replacementReadiness, missingPreconditions = [], ccConnectCliSurface = null, coverage = []) {
  const gaps = [];
  for (const item of missingPreconditions) {
    gaps.push({
      id: `precondition-${item.id}`,
      area: 'preconditions',
      priority: 'required',
      status: item.status || 'missing',
      requiredForLocalReplacementGate: true,
      nextCommand: item.nextCommand || '',
      reason: item.note || '',
      required: item.required ?? [],
      optional: item.optional ?? [],
    });
  }
  for (const item of replacementReadiness.missingCoverage ?? []) {
    gaps.push({
      id: `coverage-${item.id}`,
      area: item.id,
      priority: 'required',
      status: item.status,
      requiredForLocalReplacementGate: true,
      nextCommand: item.nextCommand || readinessNextCommand(item.id),
      reason: item.reason || item.evidence || 'Required replacement-readiness coverage is not PASS.',
      required: [],
      optional: [],
    });
  }
  for (const primitive of ccConnectCliSurface?.missingPrimitives ?? []) {
    gaps.push({
      id: `upstream-${primitive.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      area: 'upstream',
      priority: 'follow-up',
      status: 'missing-upstream-primitive',
      requiredForLocalReplacementGate: false,
      nextCommand: 'Track upstream cc-connect support or keep the ClawX reload/status lifecycle fallback documented.',
      reason: primitive,
      required: [],
      optional: [],
    });
  }
  const scheduledCron = coverage.find((item) => item.id === 'scheduled-cron-delivery-local-bundle');
  if (scheduledCron?.status !== 'pass') {
    gaps.push({
      id: 'real-scheduled-cron-delivery',
      area: 'cron',
      priority: 'follow-up',
      status: scheduledCron?.status === 'fail' ? 'fail' : 'unverified',
      requiredForLocalReplacementGate: false,
      nextCommand: 'pnpm run verify:cc-connect:local-real:scheduled-cron',
      reason: scheduledCron?.reason
        || scheduledCron?.evidence
        || 'The local bundle and OAuth smokes prove cron create/list/update/toggle/delete and prompt run paths, but not actual scheduled delivery behavior.',
    });
  }
  const scheduledPromptDelivery = coverage.find((item) => item.id === 'scheduled-prompt-cron-delivery-local-bundle');
  gaps.push(...RESIDUAL_VALIDATION_GAPS.map((gap) => {
    if (gap.id !== 'real-scheduled-prompt-channel-cron-delivery') return gap;
    if (scheduledPromptDelivery?.status === 'pass') {
      return {
        ...gap,
        status: 'unverified-channel-delivery',
        reason: `${gap.reason} Local BridgePlatform prompt delivery passed: ${scheduledPromptDelivery.evidence}.`,
      };
    }
    if (scheduledPromptDelivery?.status === 'fail') {
      return {
        ...gap,
        status: 'prompt-delivery-failed',
        reason: scheduledPromptDelivery.reason || scheduledPromptDelivery.evidence || gap.reason,
      };
    }
    return gap;
  }));

  const seen = new Set();
  return gaps.filter((gap) => {
    const key = `${gap.id}:${gap.priority}:${gap.nextCommand}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildNextActions(replacementReadiness, missingPreconditions = [], ccConnectCliSurface = null) {
  const actions = [];
  for (const item of missingPreconditions) {
    actions.push({
      id: `configure-${item.id}`,
      type: 'precondition',
      priority: 'required',
      command: item.nextCommand || '',
      reason: item.note || '',
      required: item.required ?? [],
      optional: item.optional ?? [],
    });
  }
  for (const item of replacementReadiness.missingCoverage ?? []) {
    actions.push({
      id: `verify-${item.id}`,
      type: 'coverage',
      priority: 'required',
      command: item.nextCommand || readinessNextCommand(item.id),
      reason: item.reason || item.evidence || 'Required replacement-readiness coverage is not PASS.',
      required: [],
      optional: [],
    });
  }
  for (const primitive of ccConnectCliSurface?.missingPrimitives ?? []) {
    actions.push({
      id: `upstream-${primitive.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      type: 'upstream-gap',
      priority: 'follow-up',
      command: 'Track upstream cc-connect support or keep the ClawX reload/status lifecycle fallback documented.',
      reason: primitive,
      required: [],
      optional: [],
    });
  }

  const seen = new Set();
  return actions.filter((action) => {
    const key = `${action.type}:${action.id}:${action.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function redactEnvStatus(env, name) {
  const value = env[name]?.trim();
  return {
    name,
    present: Boolean(value),
    length: value ? value.length : 0,
  };
}

function resolveOpenAiApiKeyEnv(env, codexAuthCandidate = {}) {
  const clawxKey = env.CLAWX_REAL_OPENAI_API_KEY?.trim();
  const standardKey = env.OPENAI_API_KEY?.trim();
  const codexAuthKey = typeof codexAuthCandidate.value === 'string'
    ? codexAuthCandidate.value.trim()
    : '';
  if (clawxKey) {
    return {
      source: 'CLAWX_REAL_OPENAI_API_KEY',
      value: clawxKey,
      childEnv: {
        OPENAI_API_KEY: clawxKey,
      },
    };
  }
  if (standardKey) {
    return {
      source: 'OPENAI_API_KEY',
      value: standardKey,
      childEnv: {
        OPENAI_API_KEY: standardKey,
      },
    };
  }
  if (codexAuthKey) {
    return {
      source: codexAuthCandidate.source || 'codex-auth-json OPENAI_API_KEY',
      value: codexAuthKey,
      childEnv: {
        OPENAI_API_KEY: codexAuthKey,
      },
    };
  }
  return {
    source: '',
    value: '',
    childEnv: {},
  };
}

function runCommand(command, args, options = {}) {
  const startedAt = Date.now();
  return new Promise((resolveResult) => {
    let outputTail = '';
    const appendOutput = (stream, chunk) => {
      stream.write(chunk);
      outputTail = `${outputTail}${String(chunk)}`.slice(-512 * 1024);
    };
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...(options.baseEnv || process.env), ...(options.env || {}) },
    });
    child.stdout?.on('data', (chunk) => appendOutput(process.stdout, chunk));
    child.stderr?.on('data', (chunk) => appendOutput(process.stderr, chunk));
    child.on('error', (error) => {
      resolveResult({
        command: commandLabel(command, args),
        status: 'fail',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        error: error.message,
        coverageAliases: options.coverageAliases ?? [],
      });
    });
    child.on('exit', (code, signal) => {
      const classification = classifyCommandExit(code, outputTail);
      resolveResult({
        command: commandLabel(command, args),
        status: classification.status,
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt,
        ...(classification.reason ? { reason: classification.reason } : {}),
        coverageAliases: options.coverageAliases ?? [],
      });
    });
  });
}

function classifyCommandExit(code, output) {
  if (code !== 0) return { status: 'fail', reason: '' };
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const summaryOutput = output.replace(ansiPattern, '');
  const passed = Array.from(summaryOutput.matchAll(/^\s*(\d+)\s+passed(?:\s|$)/gim))
    .reduce((total, match) => total + Number(match[1]), 0);
  const skipped = Array.from(summaryOutput.matchAll(/^\s*(\d+)\s+skipped(?:\s|$)/gim))
    .reduce((total, match) => total + Number(match[1]), 0);
  if (skipped > 0 && passed === 0) {
    return {
      status: 'skipped',
      reason: `Test command exited successfully but executed no passing tests (${skipped} skipped).`,
    };
  }
  return { status: 'pass', reason: '' };
}

function summarizeCommandAttempts(command, args, attempts) {
  const finalAttempt = attempts.at(-1);
  const failedAttempts = attempts.filter((attempt) => attempt.status === 'fail');
  const summary = {
    ...finalAttempt,
    command: commandLabel(command, args),
    durationMs: attempts.reduce((total, attempt) => total + (attempt.durationMs || 0), 0),
    attempts,
  };
  if (attempts.length > 1 && finalAttempt.status === 'pass') {
    summary.reason = `Passed after ${attempts.length} attempts; ${failedAttempts.length} previous attempt(s) failed.`;
  } else if (attempts.length > 1 && finalAttempt.status === 'fail') {
    summary.reason = `Failed after ${attempts.length} attempts.`;
  }
  return summary;
}

async function runCommandWithRetry(command, args, optionsOrFactory = {}, retryOptions = {}) {
  const maxAttempts = Math.max(1, (retryOptions.retries || 0) + 1);
  const attempts = [];
  for (let index = 0; index < maxAttempts; index += 1) {
    const attemptNumber = index + 1;
    if (attemptNumber > 1) {
      console.log(`Retrying ${commandLabel(command, args)} (${attemptNumber}/${maxAttempts})`);
    }
    const options = typeof optionsOrFactory === 'function'
      ? await optionsOrFactory({ attemptNumber, maxAttempts })
      : optionsOrFactory;
    try {
      attempts.push(await runCommand(command, args, options));
    } finally {
      if (typeof options?.cleanup === 'function') {
        await options.cleanup();
      }
    }
    if (attempts.at(-1).status === 'pass') break;
  }
  return summarizeCommandAttempts(command, args, attempts);
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function skippedCommand(command, args, reason) {
  return {
    command: commandLabel(command, args),
    status: 'skipped',
    exitCode: null,
    signal: null,
    durationMs: 0,
    reason,
  };
}

function missingPreconditions({
  authSummary,
  authImportExplicit,
  openAiConfigured,
  feishuConfigured,
  feishuInboundConfigured,
  appPath,
  packagedExecutableExists,
}) {
  const missing = [];
  if (!authImportExplicit || !authSummary.exists || !authSummary.completeTokens || authSummary.expired) {
    missing.push({
      id: 'codex-oauth-auth-json',
      status: 'missing',
      required: ['CLAWX_REAL_CODEX_AUTH_JSON with complete non-expired tokens'],
      nextCommand: 'pnpm run verify:cc-connect:local-real:oauth',
      note: authSummary.expired
        ? 'The explicit Codex auth.json appears expired. Refresh Codex OAuth before running real OAuth validation.'
        : authSummary.exists && !authSummary.completeTokens
          ? `The explicit Codex auth.json is missing required token fields: ${(authSummary.missingTokenKeys ?? []).join(', ')}. Refresh Codex OAuth before running real OAuth validation.`
        : 'Point CLAWX_REAL_CODEX_AUTH_JSON at the auth.json that this verifier may explicitly import into an isolated managed CODEX_HOME; set it to ~/.codex/auth.json only when that import is intentional.',
    });
  }
  if (!openAiConfigured) {
    missing.push({
      id: 'openai-api-key-env',
      status: 'missing',
      required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
      optional: ['CLAWX_REAL_OPENAI_MODEL'],
      nextCommand: 'pnpm run verify:cc-connect:local-real:api-key',
      note: 'Set CLAWX_REAL_OPENAI_API_KEY in process env or an untracked and gitignored local env file such as .env.cc-connect.local; OPENAI_API_KEY is also accepted for external tool compatibility. Set CLAWX_REAL_OPENAI_MODEL when the default smoke model is unavailable for the test account.',
    });
  }
  if (!feishuConfigured) {
    missing.push({
      id: 'feishu-env',
      status: 'missing',
      required: ['CLAWX_REAL_FEISHU_APP_ID', 'CLAWX_REAL_FEISHU_APP_SECRET', 'CLAWX_REAL_FEISHU_ADMIN_FROM'],
      optional: ['CLAWX_REAL_FEISHU_DOMAIN', 'CLAWX_REAL_FEISHU_ACCOUNT_ID', 'CLAWX_REAL_FEISHU_ALLOW_FROM'],
      nextCommand: 'pnpm run verify:cc-connect:local-real:feishu',
      note: 'Set Feishu/Lark app credentials in process env or an untracked and gitignored local env file; see .env.cc-connect.local.example for fields.',
    });
  }
  if (!feishuInboundConfigured) {
    missing.push({
      id: 'feishu-inbound-fixture',
      status: 'missing',
      required: ['CLAWX_REAL_FEISHU_INBOUND_E2E=1', 'sandbox tenant chat that can send the verifier marker to the configured bot'],
      optional: ['CLAWX_REAL_FEISHU_INBOUND_MARKER', 'CLAWX_REAL_FEISHU_INBOUND_TIMEOUT_MS'],
      nextCommand: 'pnpm run verify:cc-connect:local-real:feishu-inbound',
      note: 'Set CLAWX_REAL_FEISHU_INBOUND_E2E=1 only when a sandbox tenant chat can send the verifier marker to the configured Feishu/Lark bot during the test timeout.',
    });
  }
  if (!appPath || !packagedExecutableExists) {
    missing.push({
      id: 'packaged-native-app',
      status: 'missing',
      required: [appPath ?? 'native unpacked application'],
      nextCommand: 'Build the current-platform unpacked application before packaged runtime smoke.',
      note: 'Packaged smoke requires a native unpacked application built from the current source tree.',
    });
  }
  return missing;
}

async function buildReport(args, effectiveEnv, envFileSummaries) {
  const bundles = currentBundlePaths();
  const missingBundles = collectMissingRuntimeBundles([]);
  const ccConnectBundleExecutable = await executableExists(bundles.ccConnect);
  const ccConnectCliSurface = ccConnectBundleExecutable
    ? await readCcConnectCliSurface(bundles.ccConnect)
    : null;
  const appPath = packagedAppPath();
  const explicitAuthPath = effectiveEnv.CLAWX_REAL_CODEX_AUTH_JSON?.trim();
  const authPath = explicitAuthPath || defaultCodexAuthPath();
  const authSummary = await readCodexAuthSummary(authPath);
  const defaultAuthSummary = explicitAuthPath ? await readCodexAuthSummary(defaultCodexAuthPath()) : authSummary;
  const authImportExplicit = Boolean(explicitAuthPath);
  const authImportAllowed = authImportExplicit && authSummary.exists && authSummary.completeTokens && !authSummary.expired;
  const codexAuthOpenAiApiKey = await readCodexAuthOpenAiApiKey(authPath);
  const openAiApiKey = resolveOpenAiApiKeyEnv(effectiveEnv, {
    source: explicitAuthPath ? 'CLAWX_REAL_CODEX_AUTH_JSON OPENAI_API_KEY' : 'default Codex auth.json OPENAI_API_KEY',
    value: codexAuthOpenAiApiKey,
  });
  const openAiEnv = [
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_OPENAI_API_KEY_E2E'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_OPENAI_API_KEY'),
    redactEnvStatus(effectiveEnv, 'OPENAI_API_KEY'),
  ];
  const openAiConfigured = Boolean(openAiApiKey.value);
  const openAiRequested = effectiveEnv.CLAWX_REAL_OPENAI_API_KEY_E2E === '1' || args.includeOpenAiApiKey;
  const feishuEnv = [
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_E2E'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_INBOUND_E2E'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_APP_ID'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_APP_SECRET'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_ADMIN_FROM'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_ALLOW_FROM'),
    redactEnvStatus(effectiveEnv, 'CLAWX_REAL_FEISHU_INBOUND_MARKER'),
  ];
  const feishuConfigured = Boolean(effectiveEnv.CLAWX_REAL_FEISHU_APP_ID?.trim())
    && Boolean(effectiveEnv.CLAWX_REAL_FEISHU_APP_SECRET?.trim())
    && Boolean(effectiveEnv.CLAWX_REAL_FEISHU_ADMIN_FROM?.trim());
  const feishuRequested = effectiveEnv.CLAWX_REAL_FEISHU_E2E === '1' || args.includeFeishu;
  const feishuInboundRequested = effectiveEnv.CLAWX_REAL_FEISHU_INBOUND_E2E === '1' || args.includeFeishuInbound;
  const feishuInboundConfigured = feishuConfigured && authImportAllowed && effectiveEnv.CLAWX_REAL_FEISHU_INBOUND_E2E === '1';
  const residualRuntimeProcesses = process.platform === 'win32'
    ? []
    : [
        ...await listProcessCommandsContaining('/runtimes/cc-connect/'),
        ...await listProcessCommandsContaining('plugins-clone'),
      ].filter((value, index, array) => array.indexOf(value) === index);

  const unsafeRepoEnvFiles = envFileSummaries.filter((item) =>
    item.exists && item.safety?.location === 'repo' && item.safety?.safe !== true
  );

  const checks = [
    createCheck(
      'local-env-files',
      unsafeRepoEnvFiles.length === 0 ? 'pass' : 'fail',
      unsafeRepoEnvFiles.length === 0
        ? envFileSummaries.some((item) => item.loaded)
          ? 'Local verifier env files were loaded with secret values redacted and untracked/gitignore safety checked.'
          : 'No local verifier env files were found.'
        : 'Repo-local verifier env files must be untracked and gitignored before they can be loaded.',
      { files: envFileSummaries, unsafeLoadedFileNames: unsafeRepoEnvFiles.map((item) => item.name) },
    ),
    createCheck(
      'current-runtime-bundles',
      missingBundles.length === 0 ? 'pass' : 'fail',
      missingBundles.length === 0
        ? 'Current platform cc-connect and Codex bundles are present.'
        : 'Current platform runtime bundles are missing.',
      {
        target: currentTarget(),
        ccConnectPath: bundles.ccConnect,
        codexPath: bundles.codex,
        missing: missingBundles,
      },
    ),
    createCheck(
      'cc-connect-upstream-cli-surface',
      ccConnectCliSurface ? 'pass' : 'skipped',
      ccConnectCliSurface
        ? 'cc-connect CLI surface was probed from the bundled binary; unsupported upstream primitives are recorded as validation gaps.'
        : 'cc-connect bundled binary is unavailable; upstream CLI surface could not be probed.',
      {
        target: currentTarget(),
        binaryPath: bundles.ccConnect,
        surface: ccConnectCliSurface,
      },
    ),
    createCheck(
      'codex-oauth-auth-json',
      authImportAllowed ? 'pass' : 'skipped',
      authImportAllowed
        ? 'Explicit Codex auth.json is available for real OAuth validation.'
        : 'CLAWX_REAL_CODEX_AUTH_JSON is missing or incomplete; real OAuth validation will not copy user-global Codex auth implicitly.',
      {
        source: explicitAuthPath ? 'CLAWX_REAL_CODEX_AUTH_JSON' : 'default-codex-auth-json-observed-only',
        explicitImport: authImportExplicit,
        defaultAuthJson: {
          exists: defaultAuthSummary.exists,
          hasTokens: defaultAuthSummary.hasTokens,
          completeTokens: defaultAuthSummary.completeTokens,
          missingTokenKeys: defaultAuthSummary.missingTokenKeys,
          expiryStatus: defaultAuthSummary.expiryStatus,
          expiresAt: defaultAuthSummary.expiresAt,
          openAiApiKey: defaultAuthSummary.openAiApiKey,
        },
        tokenKeys: authSummary.tokenKeys,
        completeTokens: authSummary.completeTokens,
        missingTokenKeys: authSummary.missingTokenKeys,
        expiryStatus: authSummary.expiryStatus,
        expiresAt: authSummary.expiresAt,
        openAiApiKey: authSummary.openAiApiKey,
      },
    ),
    createCheck(
      'openai-api-key-env',
      openAiConfigured ? 'pass' : (args.strictReal ? 'fail' : 'skipped'),
      openAiApiKeyPreconditionMessage(openAiConfigured, openAiRequested, authSummary.openAiApiKey),
      {
        env: openAiEnv,
        requested: openAiRequested,
        credentialSource: openAiApiKey.source || null,
        codexAuthOpenAiApiKey: authSummary.openAiApiKey,
      },
    ),
    createCheck(
      'feishu-env',
      feishuConfigured ? 'pass' : (args.strictReal ? 'fail' : 'skipped'),
      feishuConfigured
        ? feishuRequested
          ? 'Feishu/Lark real E2E environment is configured and selected for this run.'
          : 'Feishu/Lark real E2E environment is configured; the real Feishu/Lark E2E was not requested in this run.'
        : 'Feishu/Lark real E2E environment is not configured.',
      { env: feishuEnv, requested: feishuRequested },
    ),
    createCheck(
      'feishu-inbound-fixture',
      feishuInboundConfigured ? 'pass' : (args.strictReal ? 'fail' : 'skipped'),
      feishuInboundConfigured
        ? feishuInboundRequested
          ? 'Feishu/Lark inbound tenant-message fixture is configured and selected for this run.'
          : 'Feishu/Lark inbound tenant-message fixture is configured; the inbound E2E was not requested in this run.'
        : 'Feishu/Lark inbound tenant-message fixture is not configured.',
      {
        env: feishuEnv,
        requested: feishuInboundRequested,
        note: 'Set CLAWX_REAL_FEISHU_INBOUND_E2E=1 only when a sandbox tenant chat can send the verifier marker to the configured bot during the test timeout.',
      },
    ),
    createCheck(
      'packaged-native-app',
      appPath && await pathExists(appPath) ? 'pass' : 'skipped',
      appPath && await pathExists(appPath)
        ? 'Native packaged application is available for optional packaged smoke.'
        : 'Native packaged application is unavailable.',
      { appPath },
    ),
    createCheck(
      'residual-runtime-processes',
      residualRuntimeProcesses.length === 0 ? 'pass' : 'fail',
      residualRuntimeProcesses.length === 0
        ? 'No residual local cc-connect/Codex runtime processes were found.'
        : 'Residual cc-connect/Codex runtime processes were found.',
      { processCount: residualRuntimeProcesses.length, processes: residualRuntimeProcesses },
    ),
  ];

  const commands = [];
  if (args.run && !args.externalGatesOnly) {
    commands.push(await runCommand('pnpm', ['run', 'verify:runtime-bundles'], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'exec',
      'vitest',
      'run',
      'tests/unit/cc-connect-local-real-verifier.test.ts',
      'tests/unit/e2e-local-real-env.test.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'exec',
      'vitest',
      'run',
      'tests/unit/cc-connect-provider-profile.test.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'exec',
      'vitest',
      'run',
      'tests/unit/cc-connect-runtime-provider.test.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'exec',
      'vitest',
      'run',
      'tests/unit/cc-connect-bridge-adapter.test.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'run',
      'test:e2e',
      '--',
      'tests/e2e/cc-connect-codex-runtime.spec.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'run',
      'test:e2e:cc-connect:codex-oauth-lifecycle',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'exec',
      'vitest',
      'run',
      'tests/unit/token-usage-scan.test.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'run',
      'test:e2e',
      '--',
      'tests/e2e/token-usage.spec.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'run',
      'test:e2e',
      '--',
      'tests/e2e/cc-connect-real-bundle-smoke.spec.ts',
    ], { baseEnv: effectiveEnv }));
    commands.push(await runCommand('pnpm', [
      'run',
      'test:e2e',
      '--',
      'tests/e2e/cc-connect-real-openai-api-key.spec.ts',
      'tests/e2e/cc-connect-real-feishu-channel.spec.ts',
    ], { baseEnv: effectiveEnv }));
  }
  if (args.run && args.includeOAuth) {
    if (authImportAllowed) {
      commands.push(await runCommandWithRetry(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-oauth'],
        ({ attemptNumber }) => {
          const oauthRunId = `${Date.now()}-${process.pid}-tool-${attemptNumber}`;
          const oauthHomeDir = join(tmpdir(), `clawx-local-real-oauth-tool-home-${oauthRunId}`);
          const oauthUserDataDir = join(tmpdir(), `clawx-local-real-oauth-tool-user-data-${oauthRunId}`);
          return {
            baseEnv: effectiveEnv,
            env: {
              CLAWX_REAL_OAUTH_E2E: '1',
              CLAWX_E2E_HOME_DIR: oauthHomeDir,
              CLAWX_E2E_USER_DATA_DIR: oauthUserDataDir,
            },
            cleanup: () => Promise.all([
              rm(oauthHomeDir, { recursive: true, force: true }),
              rm(oauthUserDataDir, { recursive: true, force: true }),
            ]),
          };
        },
        { retries: 1 },
      ));
      commands.push(await runCommandWithRetry(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-comprehensive'],
        ({ attemptNumber }) => {
          const oauthRunId = `${Date.now()}-${process.pid}-${attemptNumber}`;
          const oauthHomeDir = join(tmpdir(), `clawx-local-real-oauth-home-${oauthRunId}`);
          const oauthUserDataDir = join(tmpdir(), `clawx-local-real-oauth-user-data-${oauthRunId}`);
          return {
            baseEnv: effectiveEnv,
            env: {
              CLAWX_REAL_OAUTH_E2E: '1',
              CLAWX_E2E_HOME_DIR: oauthHomeDir,
              CLAWX_E2E_USER_DATA_DIR: oauthUserDataDir,
            },
            cleanup: () => Promise.all([
              rm(oauthHomeDir, { recursive: true, force: true }),
              rm(oauthUserDataDir, { recursive: true, force: true }),
            ]),
          };
        },
        { retries: 1 },
      ));
    } else {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-oauth'],
        'CLAWX_REAL_CODEX_AUTH_JSON is missing or incomplete; user-global ~/.codex/auth.json is not copied implicitly.',
      ));
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-comprehensive'],
        'CLAWX_REAL_CODEX_AUTH_JSON is missing or incomplete; user-global ~/.codex/auth.json is not copied implicitly.',
      ));
    }
  }
  if (args.run && args.includeOpenAiApiKey) {
    if (openAiApiKey.value) {
      commands.push(await runCommand('pnpm', ['run', 'test:e2e:cc-connect:real-openai-api-key'], {
        baseEnv: effectiveEnv,
        env: {
          CLAWX_REAL_OPENAI_API_KEY_E2E: '1',
          ...openAiApiKey.childEnv,
        },
      }));
    } else {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-openai-api-key'],
        'CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY is not configured.',
      ));
    }
  }
  if (args.run && args.includeFeishu) {
    if (
      feishuConfigured && authImportAllowed
    ) {
      commands.push(await runCommand('pnpm', ['run', 'test:e2e:cc-connect:real-feishu'], {
        baseEnv: effectiveEnv,
        env: { CLAWX_REAL_FEISHU_E2E: '1' },
      }));
    } else {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-feishu'],
        'Feishu/Lark app credentials or CLAWX_REAL_CODEX_AUTH_JSON are not configured.',
      ));
    }
  }
  if (args.run && args.includeFeishuInbound) {
    if (
      feishuConfigured
      && authImportAllowed
      && effectiveEnv.CLAWX_REAL_FEISHU_INBOUND_E2E === '1'
    ) {
      commands.push(await runCommand('pnpm', ['run', 'test:e2e:cc-connect:real-feishu-inbound'], {
        baseEnv: effectiveEnv,
        env: { CLAWX_REAL_FEISHU_INBOUND_E2E: '1' },
      }));
    } else {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-feishu-inbound'],
        'Feishu/Lark app credentials, CLAWX_REAL_CODEX_AUTH_JSON, or CLAWX_REAL_FEISHU_INBOUND_E2E=1 tenant-message fixture are not configured.',
      ));
    }
  }
  if (args.run && args.includeScheduledCron) {
    const scheduledCronEnv = { CLAWX_REAL_SCHEDULED_CRON_E2E: '1' };
    const scheduledCronCoverageAliases = [];
    if (authImportAllowed) {
      scheduledCronEnv.CLAWX_REAL_SCHEDULED_PROMPT_CRON_E2E = '1';
      scheduledCronCoverageAliases.push('test:e2e:cc-connect:real-scheduled-prompt-cron');
    }
    commands.push(await runCommand('pnpm', ['run', 'test:e2e:cc-connect:real-scheduled-cron'], {
      baseEnv: effectiveEnv,
      env: scheduledCronEnv,
      coverageAliases: scheduledCronCoverageAliases,
    }));
    if (!authImportAllowed) {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'test:e2e:cc-connect:real-scheduled-prompt-cron'],
        'CLAWX_REAL_CODEX_AUTH_JSON is missing or incomplete; scheduled prompt cron bridge fallback delivery requires managed Codex OAuth.',
      ));
    }
  }
  const packagedExecutableExists = appPath
    ? await executableExists(packagedExecutablePath(appPath))
    : false;
  if (args.run && args.includePackaged) {
    if (appPath && packagedExecutableExists) {
      commands.push(await runCommand('pnpm', [
        'run',
        'smoke:cc-connect:packaged',
        '--',
        `--app=${appPath}`,
      ], { baseEnv: effectiveEnv }));
    } else {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'smoke:cc-connect:packaged', '--', `--app=${appPath ?? '<unavailable>'}`],
        'Native packaged application executable is unavailable.',
      ));
    }
  }
  if (args.run && args.includePackagedOAuth) {
    if (appPath && authImportAllowed && packagedExecutableExists) {
      commands.push(await runCommand('pnpm', [
        'run',
        'smoke:cc-connect:packaged',
        '--',
        `--app=${appPath}`,
        '--real-oauth=1',
      ], { baseEnv: effectiveEnv }));
    } else {
      commands.push(skippedCommand(
        'pnpm',
        ['run', 'smoke:cc-connect:packaged', '--', `--app=${appPath ?? '<unavailable>'}`, '--real-oauth=1'],
        'Native packaged application executable or CLAWX_REAL_CODEX_AUTH_JSON is unavailable.',
      ));
    }
  }

  const commandFailures = commands.filter((item) => item.status === 'fail');
  const commandSkips = commands.filter((item) => item.status === 'skipped');
  if (commandFailures.length > 0) {
    checks.push(createCheck('local-validation-commands', 'fail', 'One or more requested local validation commands failed.', { commands }));
  } else if (commandSkips.length > 0) {
    checks.push(createCheck('local-validation-commands', 'pass', 'Requested local validation commands passed; unavailable real-credential paths were recorded as skipped.', { commands }));
  } else if (commands.length > 0) {
    checks.push(createCheck('local-validation-commands', 'pass', 'Requested local validation commands passed.', { commands }));
  }

  const missing = missingPreconditions({
    authSummary,
    authImportExplicit,
    openAiConfigured,
    feishuConfigured,
    feishuInboundConfigured,
    appPath,
    packagedExecutableExists,
  });
  const coverage = buildCoverage({
    args,
    missingPreconditions: missing,
    checks,
  });
  const coverageCheck = requiredCoverageCheck(coverage, args.requireCoverage);
  if (coverageCheck) checks.push(coverageCheck);
  const replacementReadiness = buildReplacementReadiness(coverage, missing);
  const validationGaps = buildValidationGaps(replacementReadiness, missing, ccConnectCliSurface, coverage);
  const replacementContract = buildReplacementContract(coverage, replacementReadiness, validationGaps);
  const nextActions = buildNextActions(replacementReadiness, missing, ccConnectCliSurface);
  checks.push(replacementReadinessCheck(replacementReadiness, { hardGate: args.requireReplacementReady }));
  const failed = checks.filter((check) => check.status === 'fail');
  const skipped = checks.filter((check) => check.status === 'skipped');
  const status = failed.length > 0
    ? 'fail'
    : skipped.length > 0 || !replacementReadiness.replacementReady
      ? 'partial'
      : 'pass';
  const matrixStatus = runtimeMatrixStatus(coverage, replacementReadiness);

  return {
    generatedAt: new Date().toISOString(),
    status,
    runtimeMatrixStatus: matrixStatus,
    args,
    missingPreconditions: missing,
    replacementReadiness,
    replacementContract,
    validationGaps,
    nextActions,
    ccConnectCliSurface,
    coverage,
    checks,
  };
}

function markdownStatus(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'fail') return 'FAIL';
  if (status === 'partial') return 'PARTIAL';
  return 'SKIPPED';
}

function markdownCell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

function markdownList(values) {
  return markdownCell((values ?? []).join(', '));
}

function commandRecords(report) {
  return report.checks.find((check) => check.id === 'local-validation-commands')?.details?.commands ?? [];
}

function preconditionRecords(report) {
  return report.missingPreconditions ?? [];
}

function findCommand(commands, needle) {
  return commands.find((command) =>
    command.command.includes(needle)
    || (command.coverageAliases ?? []).some((alias) => alias.includes(needle))
  );
}

function commandCoverage(commands, needle, fallbackStatus = 'not-run') {
  const command = findCommand(commands, needle);
  if (!command) {
    return {
      status: fallbackStatus,
      command: '',
      reason: 'Command was not requested.',
    };
  }
  return {
    status: command.status,
    command: command.command,
    reason: command.reason || command.error || '',
  };
}

function commandCoverageWithPreconditions(report, commands, needle, preconditionIds) {
  const coverage = commandCoverage(commands, needle);
  if (coverage.status !== 'not-run') return coverage;
  const missing = preconditionIds
    .map((id) => (report.missingPreconditions ?? []).find((item) => item.id === id))
    .find(Boolean);
  if (!missing) return coverage;
  return {
    status: 'skipped',
    command: '',
    reason: missing.note || `Missing precondition: ${missing.id}`,
  };
}

function buildCoverage(report) {
  const commands = commandRecords(report);
  const bundles = report.checks.find((check) => check.id === 'current-runtime-bundles');
  const compile = commandCoverage(commands, 'tests/e2e/cc-connect-real-openai-api-key.spec.ts');
  const providerProfile = commandCoverage(commands, 'tests/unit/cc-connect-provider-profile.test.ts');
  const runtimeProviderUnit = commandCoverage(commands, 'tests/unit/cc-connect-runtime-provider.test.ts');
  const oauthHostApiLifecycle = commandCoverage(commands, 'test:e2e:cc-connect:codex-oauth-lifecycle');
  const verifierUnit = commandCoverage(commands, 'tests/unit/cc-connect-local-real-verifier.test.ts');
  const tokenUsageUnit = commandCoverage(commands, 'tests/unit/token-usage-scan.test.ts');
  const tokenUsageE2e = commandCoverage(commands, 'tests/e2e/token-usage.spec.ts');
  const bridgeAdapterUnit = commandCoverage(commands, 'tests/unit/cc-connect-bridge-adapter.test.ts');
  const mockBridgeE2e = commandCoverage(commands, 'tests/e2e/cc-connect-codex-runtime.spec.ts');
  const runtimeManagementBundle = commandCoverage(commands, 'tests/e2e/cc-connect-real-bundle-smoke.spec.ts');
  const oauth = commandCoverageWithPreconditions(report, commands, 'test:e2e:cc-connect:real-comprehensive', ['codex-oauth-auth-json']);
  const oauthTool = commandCoverageWithPreconditions(report, commands, 'test:e2e:cc-connect:real-oauth', ['codex-oauth-auth-json']);
  const generatedFileOAuth = oauthTool.status === 'not-run' ? oauth : oauthTool;
  const apiKey = commandCoverageWithPreconditions(report, commands, 'test:e2e:cc-connect:real-openai-api-key', ['openai-api-key-env']);
  const feishu = commandCoverageWithPreconditions(report, commands, 'test:e2e:cc-connect:real-feishu', ['feishu-env', 'codex-oauth-auth-json']);
  const feishuInbound = commandCoverageWithPreconditions(
    report,
    commands,
    'test:e2e:cc-connect:real-feishu-inbound',
    ['feishu-env', 'codex-oauth-auth-json', 'feishu-inbound-fixture'],
  );
  const scheduledCron = commandCoverage(commands, 'test:e2e:cc-connect:real-scheduled-cron');
  const scheduledPromptDelivery = commandCoverageWithPreconditions(
    report,
    commands,
    'test:e2e:cc-connect:real-scheduled-prompt-cron',
    ['codex-oauth-auth-json'],
  );
  const packaged = commandCoverageWithPreconditions(report, commands, 'smoke:cc-connect:packaged', ['packaged-native-app', 'codex-oauth-auth-json']);

  return [
    {
      id: 'runtime-bundles-current-platform',
      status: bundles?.status || 'not-run',
      covers: ['cc-connect binary', 'Codex binary', 'current platform resolver'],
      evidence: bundles?.message || 'Runtime bundle preflight was not evaluated.',
    },
    {
      id: 'runtime-boundary-bridgeplatform-only',
      status: runtimeProviderUnit.status === 'pass' && bridgeAdapterUnit.status === 'pass' && mockBridgeE2e.status === 'pass'
        ? 'pass'
        : runtimeProviderUnit.status === 'fail' || bridgeAdapterUnit.status === 'fail' || mockBridgeE2e.status === 'fail'
          ? 'fail'
          : runtimeProviderUnit.status === 'not-run' && bridgeAdapterUnit.status === 'not-run' && mockBridgeE2e.status === 'not-run'
            ? 'not-run'
            : 'skipped',
      covers: [
        'CcConnectRuntimeProvider chat.send delegates to the BridgePlatform adapter',
        'BridgePlatform WebSocket message delivery carries the GUI chat payload into cc-connect',
        'Codex is configured only as the cc-connect project agent command and managed CODEX_HOME',
        'Mock Electron E2E proves chat box delivery through cc-connect BridgePlatform',
        'Electron Host API provider sync replaces stale same-account managed OAuth after browser re-login',
        'ordinary runtime start preserves Codex-refreshed managed OAuth over an older vault snapshot',
      ],
      evidence: [runtimeProviderUnit.command, bridgeAdapterUnit.command, mockBridgeE2e.command].filter(Boolean).join(' && ')
        || runtimeProviderUnit.reason
        || bridgeAdapterUnit.reason
        || mockBridgeE2e.reason,
      reason: [runtimeProviderUnit.reason, bridgeAdapterUnit.reason, mockBridgeE2e.reason].filter(Boolean).join('; '),
    },
    {
      id: 'session-history-parity-local-diagnostics',
      status: runtimeProviderUnit.status === 'pass' && bridgeAdapterUnit.status === 'pass' && mockBridgeE2e.status === 'pass'
        ? 'pass'
        : runtimeProviderUnit.status === 'fail' || bridgeAdapterUnit.status === 'fail' || mockBridgeE2e.status === 'fail'
          ? 'fail'
          : runtimeProviderUnit.status === 'not-run' && bridgeAdapterUnit.status === 'not-run' && mockBridgeE2e.status === 'not-run'
            ? 'not-run'
            : 'skipped',
      covers: [
        'cross-agent session keys stay runtime-routed through cc-connect stores',
        'named and active session keys load from cc-connect-owned session stores',
        'Host API sessions.rename updates cc-connect-owned session labels and titles',
        'Host API sessions.delete removes cc-connect-owned session state and history',
        'channel session display names preserve cc-connect chat/user metadata',
      ],
      evidence: [runtimeProviderUnit.command, bridgeAdapterUnit.command, mockBridgeE2e.command].filter(Boolean).join(' && ')
        || runtimeProviderUnit.reason
        || bridgeAdapterUnit.reason
        || mockBridgeE2e.reason,
      reason: [runtimeProviderUnit.reason, bridgeAdapterUnit.reason, mockBridgeE2e.reason].filter(Boolean).join('; '),
    },
    {
      id: 'real-spec-compile-and-skip-paths',
      status: compile.status,
      covers: ['OpenAI API key E2E spec compiles', 'Feishu lifecycle/inbound E2E spec compiles', 'credential-gated skip semantics'],
      evidence: compile.command || compile.reason,
      reason: compile.reason,
    },
    {
      id: 'codex-oauth-lifecycle-local-diagnostics',
      status: verifierUnit.status,
      covers: [
        'explicit auth import requirement',
        'complete Codex token field requirement',
        'expired auth rejection',
        'sanitized expiry metadata',
        'missing token key reporting without token values',
      ],
      evidence: verifierUnit.command || verifierUnit.reason,
      reason: verifierUnit.reason,
    },
    {
      id: 'codex-oauth-host-api-lifecycle-local',
      status: oauthHostApiLifecycle.status,
      covers: [
        'Electron Host API providers.codexOAuthStatus',
        'Electron Host API providers.importCodexOAuth',
        'Electron Host API providers.logoutCodexOAuth',
        'managed Codex auth file lifecycle',
        'provider OAuth secret cleanup',
        'token redaction in Host API responses and public provider profile',
      ],
      evidence: oauthHostApiLifecycle.command || oauthHostApiLifecycle.reason,
      reason: oauthHostApiLifecycle.reason,
    },
    {
      id: 'provider-model-profile-local-diagnostics',
      status: providerProfile.status,
      covers: [
        'OpenAI API-key profile materialization',
        'OpenAI OAuth profile materialization',
        'custom Responses profile materialization',
        'unsupported provider diagnostics',
        'secret redaction',
        'running runtime provider/model sync restart',
        'browser OAuth re-login secret precedence over stale same-account managed auth',
        'Codex-refreshed managed auth precedence during ordinary runtime start',
      ],
      evidence: providerProfile.command || providerProfile.reason,
      reason: providerProfile.reason,
    },
    {
      id: 'token-usage-contract-local-diagnostics',
      status: tokenUsageUnit.status === 'pass' && tokenUsageE2e.status === 'pass'
        ? 'partial'
        : tokenUsageUnit.status === 'fail' || tokenUsageE2e.status === 'fail'
          ? 'fail'
          : tokenUsageUnit.status === 'not-run' && tokenUsageE2e.status === 'not-run'
            ? 'not-run'
            : 'skipped',
      covers: [
        'cc-connect private session-store exclusion',
        'managed and user-global Codex transcript exclusion',
        'explicit empty usage result while the public runtime API is unavailable',
        'runtimeKind filtering without OpenClaw data leakage',
        'OpenClaw transcript usage remains unaffected',
        'Electron IPC unavailable-usage shape',
      ],
      evidence: [tokenUsageUnit.command, tokenUsageE2e.command].filter(Boolean).join(' && ')
        || tokenUsageUnit.reason
        || tokenUsageE2e.reason,
      reason: tokenUsageUnit.status === 'pass' && tokenUsageE2e.status === 'pass'
        ? 'Boundary diagnostics pass, but published cc-connect releases have no versioned, attributable, replayable per-turn usage API or event; unmerged upstream PR #1428 is insufficient for production parity.'
        : [tokenUsageUnit.reason, tokenUsageE2e.reason].filter(Boolean).join('; '),
    },
    {
      id: 'runtime-management-bundle-local-diagnostics',
      status: runtimeManagementBundle.status,
      covers: [
        'real bundled cc-connect startup',
        'runtime diagnostics redaction',
        'fallback port selection',
        'Management API channel reload/status',
        'Management API cron lifecycle',
        'cc-connect doctor user-isolation',
        'quit cleanup',
        'rollback cleanup',
      ],
      evidence: runtimeManagementBundle.command || runtimeManagementBundle.reason,
      reason: runtimeManagementBundle.reason,
    },
    {
      id: 'bridge-media-packets-local-diagnostics',
      status: bridgeAdapterUnit.status,
      covers: [
        'BridgePlatform image packet to renderer attached file',
        'BridgePlatform file packet to renderer attached file',
        'BridgePlatform audio packet to renderer attached file',
        'cc-connect managed media directory writes',
        'image preview data URL preservation',
        'file/audio preview suppression',
      ],
      evidence: bridgeAdapterUnit.command || bridgeAdapterUnit.reason,
      reason: bridgeAdapterUnit.reason,
    },
    {
      id: 'bridge-rich-packets-local-diagnostics',
      status: bridgeAdapterUnit.status,
      covers: [
        'BridgePlatform card packet to shared assistant message',
        'BridgePlatform buttons packet to shared assistant message',
        'BridgePlatform preview_start acknowledgement',
        'BridgePlatform update_message assistant delta',
        'BridgePlatform delete_message no-op stability',
        'typing packet no-op stability',
      ],
      evidence: bridgeAdapterUnit.command || bridgeAdapterUnit.reason,
      reason: bridgeAdapterUnit.reason,
    },
    {
      id: 'channel-lifecycle-local-bundle',
      status: runtimeManagementBundle.status,
      covers: [
        'Host API channels.connect through cc-connect runtime',
        'managed config reload without cc-connect restart',
        'channel account status from runtime-owned state',
        'Feishu/Lark local config projection',
        'Feishu/Lark agent binding and workspace projection',
        'Host API channels.disconnect through cc-connect runtime',
        'real user channel credential removal',
        'placeholder platform preservation for cc-connect startup',
      ],
      evidence: runtimeManagementBundle.command || runtimeManagementBundle.reason,
      reason: runtimeManagementBundle.reason,
    },
    {
      id: 'cron-lifecycle-local-bundle',
      status: runtimeManagementBundle.status,
      covers: [
        'Management API cron create/list/update/toggle/delete',
        'non-main agent project routing',
        'prompt cron delivery field mapping',
        'exec cron field mapping',
        'work_dir preservation',
        'session_mode preservation',
        'timeout_mins preservation',
        'mute/silent persistence',
        'non-cron schedule unsupported/error semantics',
        'manual exec run unsupported/error semantics',
      ],
      evidence: runtimeManagementBundle.command || runtimeManagementBundle.reason,
      reason: runtimeManagementBundle.reason,
    },
    {
      id: 'scheduled-cron-delivery-local-bundle',
      status: scheduledCron.status,
      covers: [
        'real cc-connect scheduler tick',
        'enabled exec cron delivery',
        'work_dir execution context',
        'scheduled job cleanup',
      ],
      evidence: scheduledCron.command || scheduledCron.reason,
      reason: scheduledCron.reason,
    },
    {
      id: 'scheduled-prompt-cron-delivery-local-bundle',
      status: scheduledPromptDelivery.status,
      covers: [
        'real cc-connect prompt cron creation',
        'real scheduler tick wait',
        'ClawX fallback delivery through cc-connect BridgePlatform',
        'cc-connect session history after scheduled prompt delivery',
      ],
      evidence: scheduledPromptDelivery.command || scheduledPromptDelivery.reason,
      reason: scheduledPromptDelivery.reason,
    },
    {
      id: 'oauth-core-runtime-parity',
      status: oauth.status,
      covers: [
        'chat',
        'sessions/history',
        'runtime-routed session rename',
        'restart reload',
        'cross-agent sessions',
        'named sessions',
        'workspace isolation',
        'tool events',
        'apply_patch generated file card',
        'skills sync',
        'cron create/list/trigger/toggle/delete',
      ],
      evidence: oauth.command || oauth.reason,
      reason: oauth.reason,
    },
    {
      id: 'generated-file-card-real-oauth',
      status: generatedFileOAuth.status,
      covers: [
        'real Codex apply_patch tool turn',
        'run-correlated cc-connect Bridge tool lifecycle',
        'generated-file card rendered in GUI chat',
      ],
      evidence: generatedFileOAuth.command || generatedFileOAuth.reason,
      reason: generatedFileOAuth.reason,
    },
    {
      id: 'local-openai-compatible-api-key-chat',
      status: compile.status,
      covers: [
        'OpenAI API-key provider with custom baseUrl',
        'local OpenAI-compatible Responses server',
        'model propagation',
        'Authorization bearer header',
        'secret redaction',
        'chat through real cc-connect and bundled Codex',
      ],
      evidence: compile.command || compile.reason,
      reason: compile.reason,
    },
    {
      id: 'chat-abort-local-openai-compatible',
      status: compile.status,
      covers: [
        'long-running local OpenAI-compatible Responses stream',
        'GUI Stop button through Host API chat.abort',
        'session-scoped cc-connect BridgePlatform /stop cancellation',
        'upstream stream closure before completion release',
        'late assistant output suppression',
        'unchanged cc-connect PID and runtime recovery to running state',
      ],
      evidence: compile.command || compile.reason,
      reason: compile.reason,
    },
    {
      id: 'openai-api-key-provider-model-chat',
      status: apiKey.status,
      covers: ['OpenAI API key provider profile', 'model propagation', 'secret redaction', 'chat through cc-connect'],
      evidence: apiKey.command || apiKey.reason,
      reason: apiKey.reason,
    },
    {
      id: 'feishu-live-channel-lifecycle',
      status: feishu.status,
      covers: ['Feishu/Lark config mapping', 'agent binding', 'runtime channel status', 'connect/disconnect', 'delete config refresh'],
      evidence: feishu.command || feishu.reason,
      reason: feishu.reason,
    },
    {
      id: 'feishu-live-inbound-delivery',
      status: feishuInbound.status,
      covers: [
        'sanitized Feishu/Lark inbound marker handoff artifact',
        'real Feishu/Lark tenant message sent by a sandbox chat',
        'cc-connect platform receives the tenant event',
        'managed cc-connect session store records the inbound marker',
        'managed runtime process cleanup after inbound smoke',
      ],
      evidence: feishuInbound.command || feishuInbound.reason,
      reason: feishuInbound.reason,
    },
    {
      id: 'packaged-oauth-runtime-smoke',
      status: packaged.status,
      covers: [
        'packaged resources path',
        'packaged cc-connect manifest and source sha256 integrity',
        'packaged Codex manifest and source sha256 integrity',
        'packaged signed executable version checks',
        'packaged Codex ripgrep helper executable',
        'packaged cc-connect startup',
        'packaged Codex OAuth smoke',
      ],
      evidence: packaged.command || packaged.reason,
      reason: packaged.reason,
    },
  ];
}

function coverageRecords(report) {
  const inferred = buildCoverage(report);
  if (!Array.isArray(report.coverage)) return inferred;
  const rows = [...report.coverage];
  const existing = new Set(rows.map((row) => row.id));
  for (const row of inferred) {
    if (!existing.has(row.id)) rows.push(row);
  }
  return rows;
}

function coverageStatus(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'fail') return 'FAIL';
  if (status === 'partial') return 'PARTIAL';
  if (status === 'skipped') return 'SKIPPED';
  return 'NOT RUN';
}

function toMarkdown(report) {
  const lines = [
    '# cc-connect Local Real Validation Report',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Overall status: ${report.status.toUpperCase()}`,
    `- Runtime matrix status: ${(report.runtimeMatrixStatus ?? report.status).toUpperCase()}`,
    '',
    '| Check | Status | Message |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${markdownCell(check.id)} | ${markdownStatus(check.status)} | ${markdownCell(check.message)} |`),
    '',
  ];

  const commands = commandRecords(report);
  if (commands.length > 0) {
    lines.push(
      '## Command Results',
      '',
      '| Command | Status | Exit | Duration | Reason |',
      '|---|---|---:|---:|---|',
      ...commands.map((command) => [
        `| ${markdownCell(command.command)}`,
        markdownStatus(command.status),
        command.exitCode ?? '',
        `${command.durationMs ?? 0}ms`,
        `${markdownCell(command.reason ?? command.error ?? '')} |`,
      ].join(' | ')),
      '',
    );
  }

  const coverage = coverageRecords(report);
  if (coverage.length > 0) {
    lines.push(
      '## Runtime Parity Coverage',
      '',
      '| Area | Status | Covers | Evidence | Reason |',
      '|---|---|---|---|---|',
      ...coverage.map((item) => [
        `| ${markdownCell(item.id)}`,
        coverageStatus(item.status),
        markdownCell((item.covers ?? []).join(', ')),
        markdownCell(item.evidence),
        `${markdownCell(item.reason ?? '')} |`,
      ].join(' | ')),
      '',
    );
  }

  const surface = report.ccConnectCliSurface;
  if (surface) {
    lines.push(
      '## cc-connect Upstream CLI Surface',
      '',
      `- Missing upstream primitives: ${surface.missingPrimitives.length > 0 ? markdownCell(surface.missingPrimitives.join(', ')) : 'none recorded'}`,
      '',
      '| Area | Evidence |',
      '|---|---|',
      `| Commands | ${markdownCell(Object.entries(surface.commands).filter(([, value]) => value).map(([key]) => key).join(', '))} |`,
      `| Cron | ${markdownCell(Object.entries(surface.cron).filter(([, value]) => value).map(([key]) => key).join(', '))} |`,
      `| Sessions | ${markdownCell(Object.entries(surface.sessions).filter(([, value]) => value).map(([key]) => key).join(', '))} |`,
      `| Providers | ${markdownCell(Object.entries(surface.providers).filter(([, value]) => value).map(([key]) => key).join(', '))} |`,
      `| Feishu/Lark | ${markdownCell(Object.entries(surface.feishu).filter(([, value]) => value).map(([key]) => key).join(', '))} |`,
      `| Channel lifecycle | ${markdownCell(Object.entries(surface.channelLifecycle).filter(([, value]) => value).map(([key]) => key).join(', '))} |`,
      '',
    );
  }

  const readiness = report.replacementReadiness;
  if (readiness) {
    lines.push(
      '## Replacement Readiness',
      '',
      `- Status: ${readiness.status.toUpperCase()}`,
      `- Replacement ready: ${readiness.replacementReady ? 'yes' : 'no'}`,
      `- Note: ${markdownCell(readiness.note)}`,
      '',
    );
    if ((readiness.missingCoverage ?? []).length > 0) {
      lines.push(
        '| Missing Coverage | Status | Reason | Next Command |',
        '|---|---|---|---|',
        ...readiness.missingCoverage.map((item) => [
          `| ${markdownCell(item.id)}`,
          coverageStatus(item.status),
          markdownCell(item.reason || item.evidence || ''),
          `${markdownCell(item.nextCommand)} |`,
        ].join(' | ')),
        '',
      );
    }
  }

  if ((report.replacementContract ?? []).length > 0) {
    lines.push(
      '## Replacement Contract Checklist',
      '',
      '| ID | Area | Status | Required For Local Gate | Expected State | Requirement | Evidence | Next Action |',
      '|---|---|---|---|---|---|---|---|',
      ...report.replacementContract.map((item) => [
        `| ${markdownCell(item.id)}`,
        markdownCell(item.area),
        coverageStatus(item.status),
        item.requiredForLocalReplacementGate ? 'yes' : 'no',
        markdownCell(item.expectedState),
        markdownCell(item.requirement),
        markdownCell(item.evidence),
        `${markdownCell(item.nextAction ?? '')} |`,
      ].join(' | ')),
      '',
    );
  }

  const missing = preconditionRecords(report);
  if (missing.length > 0) {
    lines.push(
      '## Missing Preconditions',
      '',
      '| ID | Required | Optional | Next Command | Note |',
      '|---|---|---|---|---|',
      ...missing.map((item) => [
        `| ${markdownCell(item.id)}`,
        markdownList(item.required),
        markdownList(item.optional),
        markdownCell(item.nextCommand),
        `${markdownCell(item.note)} |`,
      ].join(' | ')),
      '',
    );
  }

  if ((report.nextActions ?? []).length > 0) {
    lines.push(
      '## Next Actions',
      '',
      '| ID | Type | Priority | Required | Optional | Command or Action | Reason |',
      '|---|---|---|---|---|---|---|',
      ...report.nextActions.map((item) => [
        `| ${markdownCell(item.id)}`,
        markdownCell(item.type),
        markdownCell(item.priority),
        markdownList(item.required),
        markdownList(item.optional),
        markdownCell(item.command),
        `${markdownCell(item.reason)} |`,
      ].join(' | ')),
      '',
    );
  }

  if ((report.validationGaps ?? []).length > 0) {
    lines.push(
      '## Validation Gaps',
      '',
      '| ID | Area | Priority | Status | Blocks Local Gate | Required | Optional | Next Command or Action | Reason |',
      '|---|---|---|---|---|---|---|---|---|',
      ...report.validationGaps.map((item) => [
        `| ${markdownCell(item.id)}`,
        markdownCell(item.area),
        markdownCell(item.priority),
        markdownCell(item.status),
        item.requiredForLocalReplacementGate ? 'yes' : 'no',
        markdownList(item.required),
        markdownList(item.optional),
        markdownCell(item.nextCommand),
        `${markdownCell(item.reason)} |`,
      ].join(' | ')),
      '',
    );
  }

  lines.push(
    '## Notes',
    '',
    '- Secret values are not written to this report; environment entries record only presence and length.',
    '- Untracked and gitignored local env files may be loaded for child commands, but the report records only file names, variable names, tracked state, and gitignore safety.',
    '- Explicit env files outside the repository may be loaded, but reports do not include their absolute paths.',
    '- Real OAuth/API-key/Feishu checks remain explicit opt-in validation paths and are not default CI gates.',
    '- Packaged real OAuth is also opt-in because it uses the caller-selected Codex auth source.',
    '- Use `--strict-real` when a release candidate requires every real credential precondition to be configured.',
    '',
  );

  return lines.join('\n');
}

function toConsoleSummaryLines(report, options = {}) {
  const focusCoverageIds = new Set(options.focusCoverageIds ?? []);
  const shouldIncludeCoverage = (id) => focusCoverageIds.size === 0 || focusCoverageIds.has(id);
  const lines = [];
  const missing = preconditionRecords(report);
  if (missing.length > 0) {
    lines.push('Missing preconditions:');
    for (const item of missing) {
      const required = (item.required ?? []).join(', ') || 'none';
      const optional = (item.optional ?? []).join(', ') || 'none';
      lines.push(`- ${item.id}: required=${required}; optional=${optional}; next=${item.nextCommand || 'n/a'}`);
    }
  }

  const missingCoverage = (report.replacementReadiness?.missingCoverage ?? [])
    .filter((item) => shouldIncludeCoverage(item.id));
  if (missingCoverage.length > 0) {
    lines.push('Missing replacement coverage:');
    for (const item of missingCoverage) {
      const reason = item.reason || item.evidence || 'Required replacement-readiness coverage is not PASS.';
      lines.push(`- ${item.id}: ${item.status}; next=${item.nextCommand || 'n/a'}; reason=${reason}`);
    }
  }

  const nextActions = (report.nextActions ?? [])
    .filter((item) => {
      if (focusCoverageIds.size === 0) return true;
      if (item.type !== 'coverage') return item.type === 'precondition';
      return focusCoverageIds.has(item.id.replace(/^verify-/, ''));
    });
  if (nextActions.length > 0) {
    lines.push('Next actions:');
    for (const item of nextActions) {
      lines.push(`- ${item.id}: ${item.command || item.reason || 'n/a'}`);
    }
  }

  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const { env: loadedEnv, summaries: envFileSummaries } = await loadLocalEnvFiles(args);
  const effectiveEnv = { ...process.env, ...loadedEnv };
  const report = await buildReport(args, effectiveEnv, envFileSummaries);

  console.log(`cc-connect local real validation status: ${report.status.toUpperCase()}`);
  console.log(`cc-connect runtime matrix status: ${(report.runtimeMatrixStatus ?? report.status).toUpperCase()}`);
  const focusCoverageIds = args.externalGatesOnly ? requiredCoverageIds(args.requireCoverage) : [];
  for (const line of toConsoleSummaryLines(report, { focusCoverageIds })) console.log(line);
  if (shouldWriteReport(args)) {
    await mkdir(reportDir, { recursive: true });
    await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(markdownReportPath, toMarkdown(report), 'utf8');
    console.log(`Wrote ${jsonReportPath}`);
    console.log(`Wrote ${markdownReportPath}`);
    if (shouldWriteHandoff(args)) {
      await writeFile(externalGateHandoffPath, toExternalGateHandoffMarkdown(report), 'utf8');
      await writeFile(externalGateHandoffJsonPath, toExternalGateHandoffJson(report), 'utf8');
      console.log(`Wrote ${externalGateHandoffPath}`);
      console.log(`Wrote ${externalGateHandoffJsonPath}`);
    }
  } else {
    console.log('No report artifacts were written (--no-write).');
  }
  if (report.status === 'fail') process.exit(1);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

export {
  COVERAGE_IDS,
  REPLACEMENT_REQUIRED_COVERAGE_IDS,
  RESIDUAL_VALIDATION_GAPS,
  REPLACEMENT_CONTRACT_ITEMS,
  buildCoverage,
  coverageRecords,
  buildNextActions,
  buildReplacementContract,
  buildReplacementReadiness,
  buildValidationGaps,
  analyzeCcConnectCliSurface,
  classifyCommandExit,
  codexAuthExpirySummary,
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
  toConsoleSummaryLines,
  summarizeCommandAttempts,
  toMarkdown,
};

if (isCliEntryPoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
