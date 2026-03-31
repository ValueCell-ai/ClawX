import { app, utilityProcess } from 'electron';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import type { GatewayLaunchContext } from './config-sync';
import type { GatewayLifecycleState } from './process-policy';
import { logger } from '../utils/logger';
import { appendNodeRequireToNodeOptions } from '../utils/paths';

const GATEWAY_FETCH_PRELOAD_SOURCE = `'use strict';
(function () {
  var _f = globalThis.fetch;
  if (typeof _f !== 'function') return;
  if (globalThis.__clawxFetchPatched) return;
  globalThis.__clawxFetchPatched = true;

  globalThis.fetch = function clawxFetch(input, init) {
    var url =
      typeof input === 'string' ? input
        : input && typeof input === 'object' && typeof input.url === 'string'
          ? input.url : '';

    if (url.indexOf('openrouter.ai') !== -1) {
      init = init ? Object.assign({}, init) : {};
      var prev = init.headers;
      var flat = {};
      if (prev && typeof prev.forEach === 'function') {
        prev.forEach(function (v, k) { flat[k] = v; });
      } else if (prev && typeof prev === 'object') {
        Object.assign(flat, prev);
      }
      delete flat['http-referer'];
      delete flat['HTTP-Referer'];
      delete flat['x-title'];
      delete flat['X-Title'];
      flat['HTTP-Referer'] = 'https://claw-x.com';
      flat['X-Title'] = 'ClawX';
      init.headers = flat;
    }
    return _f.call(globalThis, input, init);
  };

  if (process.platform === 'win32') {
    try {
      var cp = require('child_process');
      if (!cp.__clawxPatched) {
        cp.__clawxPatched = true;
        ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync'].forEach(function(method) {
          var original = cp[method];
          if (typeof original !== 'function') return;
          cp[method] = function() {
            var args = Array.prototype.slice.call(arguments);
            var optIdx = -1;
            for (var i = 1; i < args.length; i++) {
              var a = args[i];
              if (a && typeof a === 'object' && !Array.isArray(a)) {
                optIdx = i;
                break;
              }
            }
            if (optIdx >= 0) {
              args[optIdx].windowsHide = true;
            } else {
              var opts = { windowsHide: true };
              if (typeof args[args.length - 1] === 'function') {
                args.splice(args.length - 1, 0, opts);
              } else {
                args.push(opts);
              }
            }
            return original.apply(this, args);
          };
        });
      }
    } catch (e) {
      // ignore
    }
  }
})();
`;

function ensureGatewayFetchPreload(): string {
  const dest = path.join(app.getPath('userData'), 'gateway-fetch-preload.cjs');
  try {
    writeFileSync(dest, GATEWAY_FETCH_PRELOAD_SOURCE, 'utf-8');
  } catch {
    // best-effort
  }
  return dest;
}

export async function launchGatewayProcess(options: {
  port: number;
  launchContext: GatewayLaunchContext;
  sanitizeSpawnArgs: (args: string[]) => string[];
  getCurrentState: () => GatewayLifecycleState;
  getShouldReconnect: () => boolean;
  onStderrLine: (line: string) => void;
  onSpawn: (pid: number | undefined) => void;
  onExit: (child: Electron.UtilityProcess, code: number | null) => void;
  onError: (error: Error) => void;
}): Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }> {
  const {
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  } = options.launchContext;

  logger.info(
    `Starting Gateway process (mode=${mode}, port=${options.port}, entry="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'}, providerKeys=${loadedProviderKeyCount}, channels=${channelStartupSummary}, proxy=${proxySummary})`,
  );
  const lastSpawnSummary = `mode=${mode}, entry="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}"`;

  const runtimeEnv = { ...forkEnv };
  // Only apply the fetch/child_process preload in dev mode.
  // In packaged builds Electron's UtilityProcess rejects NODE_OPTIONS
  // with --require, logging "Most NODE_OPTIONs are not supported in
  // packaged apps" and the preload never loads.
  if (!app.isPackaged) {
    try {
      const preloadPath = ensureGatewayFetchPreload();
      if (existsSync(preloadPath)) {
        runtimeEnv.NODE_OPTIONS = appendNodeRequireToNodeOptions(
          runtimeEnv.NODE_OPTIONS,
          preloadPath,
        );
      }
    } catch (err) {
      logger.warn('Failed to set up OpenRouter headers preload:', err);
    }
  }

  return await new Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }>((resolve, reject) => {
    const child = utilityProcess.fork(entryScript, gatewayArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: runtimeEnv as NodeJS.ProcessEnv,
      serviceName: 'OpenClaw Gateway',
    });

    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve({ child, lastSpawnSummary });
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on('error', (error) => {
      logger.error('Gateway process spawn error:', error);
      options.onError(error);
      rejectOnce(error);
    });

    child.on('exit', (code: number) => {
      const expectedExit = !options.getShouldReconnect() || options.getCurrentState() === 'stopped';
      const level = expectedExit ? logger.info : logger.warn;
      level(`Gateway process exited (code=${code}, expected=${expectedExit ? 'yes' : 'no'})`);
      options.onExit(child, code);
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        options.onStderrLine(line);
      }
    });

    child.on('spawn', () => {
      logger.info(`Gateway process started (pid=${child.pid})`);
      options.onSpawn(child.pid);
      resolveOnce();
    });
  });
}
