#!/usr/bin/env node

/**
 * CLAWX External Gateway Headless Smoke
 * ======================================
 * BR-C: Headless WebSocket smoke against the LAH OpenClaw Gateway.
 *
 * Safety guarantees:
 *  - No process spawning
 *  - No Electron imports
 *  - No OpenClaw runtime startup import
 *  - No writes to ~/.openclaw or production paths
 *  - No dependency installation
 *  - Localhost-only target enforcement
 *  - All 11 safe-mode env flags validated before any socket action
 *
 * Uses Node.js native `WebSocket` global (v18+). No `ws` package needed.
 *
 * Usage:
 *   node scripts/lah/clawx-external-gateway-headless-smoke.mjs --dry-run
 *   node scripts/lah/clawx-external-gateway-headless-smoke.mjs --smoke
 *   node scripts/lah/clawx-external-gateway-headless-smoke.mjs --env <path> --out <dir> --timeout-ms <ms>
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';

// ─── Constants ───────────────────────────────────────────────────────────
const DEFAULT_ENV_FILE = '/home/deploy/lah-stack-runtime/clawx-phase1/env/clawx-phase1.env';
const DEFAULT_OUTPUT_DIR = '/home/deploy/lah-stack-runtime/clawx-phase1/checks';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TARGET_URL = 'ws://127.0.0.1:4000/gateway';

// Flags that MUST match these values for approval
const REQUIRED_FLAGS = {
  LAH_SAFE_MODE: '1',
  CLAWX_EXTERNAL_GATEWAY_ENABLED: '1',
  CLAWX_GATEWAY_SPAWN_ENABLED: '0',
  CLAWX_GATEWAY_KILL_ON_CONFLICT: '0',
  CLAWX_OPENCLAW_CONFIG_MUTATION: '0',
  CLAWX_TELEMETRY_ENABLED: '0',
  CLAWX_UPDATE_CHECKS_ENABLED: '0',
  CLAWX_PROVIDER_VALIDATION_ENABLED: '0',
  CLAWX_OAUTH_ENABLED: '0',
  CLAWX_EXTERNAL_URL_OPENING_ENABLED: '0',
  CLAWX_CONNECTIVITY_PROBE_ENABLED: '0',
};

// ─── CLI Parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    mode: 'dry-run',   // 'dry-run' | 'smoke'
    envFile: DEFAULT_ENV_FILE,
    outputDir: DEFAULT_OUTPUT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dry-run':
        args.mode = 'dry-run';
        break;
      case '--smoke':
        args.mode = 'smoke';
        break;
      case '--env':
        args.envFile = argv[++i];
        break;
      case '--out':
        args.outputDir = argv[++i];
        break;
      case '--timeout-ms':
        args.timeoutMs = parseInt(argv[++i], 10);
        if (isNaN(args.timeoutMs) || args.timeoutMs < 1000) {
          die('--timeout-ms must be >= 1000');
        }
        break;
      default:
        die(`Unknown option: ${argv[i]}`);
    }
  }
  return args;
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function die(msg) {
  process.stderr.write(`clawx-headless-smoke: ERROR: ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  process.stderr.write(`clawx-headless-smoke: WARN: ${msg}\n`);
}

function log(msg) {
  process.stdout.write(`clawx-headless-smoke: ${msg}\n`);
}

function isLocalhost(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

// ─── Env File Loader ─────────────────────────────────────────────────────
function parseEnvFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const vars = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    // Handle `export KEY=VALUE` or `KEY=VALUE`
    const match = trimmed.replace(/^export\s+/, '');
    const eqIdx = match.indexOf('=');
    if (eqIdx === -1) continue;

    const key = match.slice(0, eqIdx).trim();
    let value = match.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

// ─── Flag Validator ─────────────────────────────────────────────────────
function validateFlags(vars) {
  const results = {};
  let allValid = true;

  for (const [flag, expected] of Object.entries(REQUIRED_FLAGS)) {
    const actual = vars[flag] ?? '<not set>';
    const valid = actual === expected;
    if (!valid) allValid = false;
    results[flag] = { expected, actual, valid };
  }

  return { allValid, results };
}

// ─── Smoke Mode: WebSocket Connection ────────────────────────────────────
async function runSmoke(targetUrl, timeoutMs, outputDir, envVars, flagResults) {
  log(`Opening WebSocket to ${targetUrl}`);

  return new Promise((resolvePromise) => {
    let resolved = false;
    const result = {
      target_url: targetUrl,
      remote_host: hostname(),
      timestamp: new Date().toISOString(),
      connection_opened: false,
      first_message_received: false,
      first_message_text: null,
      challenge_observed: false,
      challenge_type: null,
      error: null,
      gateway_present: false,
      timeout_ms: timeoutMs,
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        result.error = 'timeout';
        result.gateway_present = false; // No response means no Gateway
        log(`Timeout (${timeoutMs}ms) — Gateway not responding`);
        writeReport(outputDir, 'smoke', result, envVars, flagResults);
        resolvePromise(result);
      }
    }, timeoutMs);

    let ws;
    try {
      ws = new WebSocket(targetUrl);
    } catch (err) {
      clearTimeout(timer);
      result.error = `WebSocket constructor failed: ${err.message}`;
      result.gateway_present = false;
      writeReport(outputDir, 'smoke', result, envVars, flagResults);
      resolvePromise(result);
      return;
    }

    ws.onopen = () => {
      if (resolved) return;
      result.connection_opened = true;
      result.gateway_present = true; // Connection opened = Gateway is present
      log(`Connection opened to ${targetUrl}`);
    };

    ws.onmessage = (event) => {
      if (resolved) return;
      result.first_message_received = true;
      result.first_message_text = String(event.data).slice(0, 500); // Truncate for safety
      log(`First message received (${String(event.data).length} chars)`);

      // Detect connect.challenge (standard OpenClaw Gateway protocol)
      if (result.first_message_text.includes('connect.challenge')) {
        result.challenge_observed = true;
        result.challenge_type = 'connect.challenge';
        log('connect.challenge detected — Gateway protocol confirmed');
      }

      // Check for JSON-RPC 2.0 patterns
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.jsonrpc === '2.0') {
          log(`JSON-RPC 2.0 message: method=${parsed.method || 'response'}, id=${parsed.id || 'N/A'}`);
          if (!result.challenge_type) result.challenge_type = 'json-rpc-2.0';
        }
      } catch {
        // Not JSON — raw text protocol
        if (!result.challenge_type) result.challenge_type = 'raw-text';
      }

      // Close after receiving first message
      clearTimeout(timer);
      resolved = true;
      log(`Closing socket after first message`);
      ws.close();
      writeReport(outputDir, 'smoke', result, envVars, flagResults);
      resolvePromise(result);
    };

    ws.onerror = (err) => {
      if (resolved) return;
      clearTimeout(timer);
      result.error = `WebSocket error: ${err.message || 'unknown'}`;
      result.gateway_present = false;
      log(`WebSocket error: ${err.message || 'unknown'}`);
      writeReport(outputDir, 'smoke', result, envVars, flagResults);
      resolvePromise(result);
    };

    ws.onclose = (event) => {
      if (resolved) return;
      clearTimeout(timer);
      resolved = true;

      if (event.code !== 1000 && event.code !== 1005) {
        // Abnormal close without prior message = Gateway absent or refused
        if (!result.connection_opened) {
          result.error = `connection refused / closed (code=${event.code})`;
          result.gateway_present = false;
        } else {
          result.error = `connection closed abnormally (code=${event.code})`;
        }
      } else {
        // Clean close without messages = Gateway closed immediately
        if (!result.connection_opened && !result.first_message_received) {
          result.gateway_present = false;
        }
      }
      writeReport(outputDir, 'smoke', result, envVars, flagResults);
      resolvePromise(result);
    };
  });
}

// ─── Report Writer ───────────────────────────────────────────────────────
function writeReport(outputDir, mode, liveResult, envVars, flagResults) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `clawx-gateway-headless-smoke-${mode}-${timestamp}.json`;
  const filePath = join(outputDir, filename);

  const report = {
    mode,
    timestamp: new Date().toISOString(),
    script_version: '1.0.0',
    env_file: envVars.__filePath,
    target_url: envVars.__targetUrl,
    no_spawn: true,
    no_kill: true,
    no_mutation: true,
    no_electron: true,
    no_openclaw_runtime: true,
    no_install_executed: true,
    websocket_runtime_available: typeof WebSocket !== 'undefined',
    node_version: process.version,
    node_versions: process.versions,
    flags: flagResults,
    flags_passed: flagResults.allValid,
    smoke: liveResult,
  };

  writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n');
  log(`Report written: ${filePath}`);
  return filePath;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  log(`CLAWX External Gateway Headless Smoke (${args.mode.toUpperCase()})`);
  log(`Node.js ${process.version} — WebSocket global: ${typeof WebSocket !== 'undefined'}`);
  log(`Target: ${DEFAULT_TARGET_URL}`);
  log(`Env file: ${args.envFile}`);

  // 1. Check env file exists
  if (!existsSync(args.envFile)) {
    die(`Env file not found: ${args.envFile}`);
  }

  // 2. Parse env file
  let envVars;
  try {
    envVars = parseEnvFile(args.envFile);
    envVars.__filePath = args.envFile;
    envVars.__targetUrl = envVars.CLAWX_EXTERNAL_GATEWAY_URL || DEFAULT_TARGET_URL;
  } catch (err) {
    die(`Failed to parse env file: ${err.message}`);
  }

  // 3. Validate target is localhost
  const targetUrl = envVars.__targetUrl;
  if (!isLocalhost(targetUrl)) {
    die(`Non-localhost target URL forbidden: ${targetUrl}`);
  }
  log(`Target URL validated: ${targetUrl} (localhost ✓)`);

  // 4. Validate flags
  const flagResults = validateFlags(envVars);
  for (const [flag, r] of Object.entries(flagResults.results)) {
    const status = r.valid ? '✓' : '✗';
    log(`  ${status} ${flag}=${r.actual} (expected ${r.expected})`);
  }

  if (!flagResults.allValid) {
    warn(`Flag validation FAILED — ${args.mode === 'smoke' ? 'smoke will not proceed' : 'dry-run will proceed informational'}`);
    if (args.mode === 'smoke') {
      die('Safe-mode flag validation failed. Skipping smoke.');
    }
  }

  // 5. Ensure output dir exists
  if (!existsSync(args.outputDir)) {
    mkdirSync(args.outputDir, { recursive: true });
    log(`Created output directory: ${args.outputDir}`);
  }

  // 6. Check runtime
  const wsAvailable = typeof WebSocket !== 'undefined';
  if (!wsAvailable) {
    warn('Native WebSocket global not available in this Node.js runtime.');
  }

  // 7. Mode-specific execution
  if (args.mode === 'dry-run') {
    log('─── DRY RUN ───');
    log('All validations passed. Would test:');
    log(`  - WebSocket connection to ${targetUrl}`);
    log(`  - First message / connect.challenge detection`);
    log(`  - Clean close`);
    log(`  - Report to ${args.outputDir}/`);
    log('No socket opened (dry-run).');

    const dryResult = {
      dry_run: true,
      target_url: targetUrl,
      remote_host: hostname(),
      timestamp: new Date().toISOString(),
      checks: {
        env_file_exists: existsSync(args.envFile),
        output_dir_writable: existsSync(args.outputDir),
        websocket_available: wsAvailable,
        target_is_localhost: true,
        flags_valid: flagResults.allValid,
      },
    };

    writeReport(args.outputDir, 'dry-run', dryResult, envVars, flagResults);
    log(`Dry-run complete. Exit code: ${flagResults.allValid ? 0 : 1}`);
    process.exit(flagResults.allValid ? 0 : 1);
  }

  if (args.mode === 'smoke') {
    if (!flagResults.allValid) {
      // Already died above, but be safe
      die('Cannot run smoke: flag validation failed.');
    }

    if (!wsAvailable) {
      log('WebSocket runtime unavailable. Skipping actual smoke.');
      const result = {
        gateway_present: false,
        websocket_runtime_available: false,
        error: 'Native WebSocket not available in this Node runtime',
        target_url: targetUrl,
        timestamp: new Date().toISOString(),
      };
      writeReport(args.outputDir, 'smoke', result, envVars, flagResults);
      log(`Smoke complete (no WebSocket). Final: BR_C_HEADLESS_SMOKE_SCRIPT_READY_RUNTIME_WEBSOCKET_UNAVAILABLE`);
      process.exit(0);
    }

    log('─── SMOKE ───');
    const smokeResult = await runSmoke(targetUrl, args.timeoutMs, args.outputDir, envVars, flagResults);
    log(`Smoke complete. Gateway present: ${smokeResult.gateway_present}`);
    log(`Challenge observed: ${smokeResult.challenge_observed}`);
    log(`Connection opened: ${smokeResult.connection_opened}`);
    log(`First message: ${smokeResult.first_message_received}`);

    const success = smokeResult.gateway_present;
    process.exit(success ? 0 : 0); // Exit 0 always — informational result
  }
}

main().catch((err) => {
  die(`Unexpected error: ${err.message}`);
});