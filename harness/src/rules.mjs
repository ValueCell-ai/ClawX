import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, pathMatchesAny, toArray } from './specs.mjs';

const DIRECT_IPC_PATTERN = /window\.electron\.ipcRenderer\.invoke\s*\(/;
const DIRECT_GATEWAY_HTTP_PATTERN = /fetch\s*\(\s*['"`]http:\/\/(?:127\.0\.0\.1|localhost):18789/;
const HOST_API_LOCAL_HTTP_PATTERN = /fetch\s*\(\s*['"`]http:\/\/(?:127\.0\.0\.1|localhost):13210|HOST_API_BASE\s*=\s*`?http:\/\/127\.0\.0\.1:\$\{HOST_API_PORT\}`?/;
const LOCALHOST_FALLBACK_FLAG = 'clawx:allow-localhost-fallback';
const SSE_FALLBACK_FLAG = 'clawx:allow-sse-fallback';
const WS_DIAGNOSTIC_FLAG = 'clawx:gateway-ws-diagnostic';
const GATEWAY_READY_MUTATION_PATTERN = /gatewayReady\s*[:=]\s*(?:true|false)|setStatus\s*\([^)]*gatewayReady|setState\s*\([^)]*gatewayReady/s;
const COMMUNICATION_PATHS = [
  'src/lib/api-client.ts',
  'src/lib/host-api.ts',
  'src/stores/gateway.ts',
  'src/stores/chat.ts',
  'src/stores/chat/**',
  'electron/api/**',
  'electron/main/ipc/**',
  'electron/gateway/**',
  'electron/preload/**',
  'electron/utils/**',
];

function unique(values) {
  return [...new Set(values)].sort();
}

async function readTextIfExists(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), 'utf8');
  } catch {
    return '';
  }
}

export function touchesCommunicationPath(files) {
  return files.some((file) => pathMatchesAny(file, COMMUNICATION_PATHS));
}

export async function scanBackendCommunicationBoundary(files) {
  const failures = [];
  const scanFiles = unique(files).filter((file) => file.startsWith('src/') && /\.(ts|tsx|js|jsx)$/.test(file));

  for (const file of scanFiles) {
    const text = await readTextIfExists(file);
    if (!text) continue;

    const isPageOrComponent = file.startsWith('src/pages/') || file.startsWith('src/components/');
    if (isPageOrComponent && DIRECT_IPC_PATTERN.test(text)) {
      failures.push(`${file}: renderer page/component must not call window.electron.ipcRenderer.invoke directly`);
    }

    if (DIRECT_GATEWAY_HTTP_PATTERN.test(text)) {
      failures.push(`${file}: renderer must not fetch Gateway HTTP directly`);
    }

    const isTest = file.startsWith('tests/');
    if (!isTest && text.includes(LOCALHOST_FALLBACK_FLAG) && file !== 'src/lib/host-api.ts') {
      failures.push(`${file}: ${LOCALHOST_FALLBACK_FLAG} is only allowed in src/lib/host-api.ts`);
    }

    if (!isTest && HOST_API_LOCAL_HTTP_PATTERN.test(text) && file !== 'src/lib/host-api.ts') {
      failures.push(`${file}: direct Host API localhost fallback is only allowed in src/lib/host-api.ts`);
    }

    if (!isTest && text.includes(SSE_FALLBACK_FLAG) && file !== 'src/lib/host-events.ts') {
      failures.push(`${file}: ${SSE_FALLBACK_FLAG} is only allowed in src/lib/host-events.ts`);
    }

    if (!isTest && text.includes(WS_DIAGNOSTIC_FLAG) && file !== 'src/lib/api-client.ts') {
      failures.push(`${file}: ${WS_DIAGNOSTIC_FLAG} is only allowed in src/lib/api-client.ts`);
    }

    const isPageOrComponentFile = file.startsWith('src/pages/') || file.startsWith('src/components/');
    if (isPageOrComponentFile && GATEWAY_READY_MUTATION_PATTERN.test(text)) {
      failures.push(`${file}: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code`);
    }
  }

  return failures;
}

export function validateGatewayTaskSpec(taskSpec, scenarioSpec, changedFiles = []) {
  return validateTaskSpec(taskSpec, scenarioSpec, changedFiles, {
    scenarioId: 'gateway-backend-communication',
    taskType: 'runtime-bridge',
    label: 'gateway backend communication',
    requiredProfiles: ['fast', 'comms'],
  });
}

export function validatePluginLifecycleTaskSpec(taskSpec, scenarioSpec, changedFiles = []) {
  return validateTaskSpec(taskSpec, scenarioSpec, changedFiles, {
    scenarioId: 'plugin-lifecycle-management',
    taskType: 'plugin-lifecycle',
    label: 'plugin lifecycle',
    requiredProfiles: ['fast'],
  });
}

function validateTaskSpec(taskSpec, scenarioSpec, changedFiles, options) {
  const failures = [];
  const data = taskSpec.data ?? {};
  const requiredProfiles = toArray(data.requiredProfiles);
  const touchedAreas = toArray(data.touchedAreas);
  const expectedUserBehavior = toArray(data.expectedUserBehavior);
  const acceptance = toArray(data.acceptance);

  for (const field of ['id', 'title', 'scenario', 'taskType', 'intent']) {
    if (!data[field]) failures.push(`${taskSpec.path}: missing required field "${field}"`);
  }

  if (data.scenario !== options.scenarioId) {
    failures.push(`${taskSpec.path}: ${options.label} tasks must set scenario: ${options.scenarioId}`);
  }

  if (data.taskType !== options.taskType) {
    failures.push(`${taskSpec.path}: ${options.label} tasks must set taskType: ${options.taskType}`);
  }

  for (const profile of options.requiredProfiles) {
    if (!requiredProfiles.includes(profile)) {
      failures.push(`${taskSpec.path}: requiredProfiles must include "${profile}"`);
    }
  }

  if (touchedAreas.length === 0) failures.push(`${taskSpec.path}: touchedAreas must declare affected paths`);
  if (expectedUserBehavior.length === 0) failures.push(`${taskSpec.path}: expectedUserBehavior must declare visible behavior`);
  if (acceptance.length === 0) failures.push(`${taskSpec.path}: acceptance must declare completion criteria`);

  if (!data.docs || typeof data.docs !== 'object' || typeof data.docs.required !== 'boolean') {
    failures.push(`${taskSpec.path}: docs.required must be explicitly true or false`);
  }

  if (scenarioSpec) {
    const scenarioProfiles = toArray(scenarioSpec.data?.requiredProfiles);
    for (const profile of scenarioProfiles) {
      if (!requiredProfiles.includes(profile)) {
        failures.push(`${taskSpec.path}: requiredProfiles must include scenario-required profile "${profile}"`);
      }
    }
  }

  if (changedFiles.length > 0) {
    const ownedPaths = toArray(scenarioSpec?.data?.ownedPaths);
    const allowedPaths = [...touchedAreas, ...ownedPaths];
    const uncovered = changedFiles.filter((file) => !pathMatchesAny(file, allowedPaths));
    if (uncovered.length > 0) {
      failures.push(`${taskSpec.path}: changed files are not covered by touchedAreas or scenario ownedPaths: ${uncovered.join(', ')}`);
    }
  }

  return failures;
}
