#!/usr/bin/env node
import process from 'node:process';
import { getChangedFiles } from './git.mjs';
import { PROFILES, selectSteps } from './profiles.mjs';
import { writeReport } from './report.mjs';
import { runStep } from './runner.mjs';
import {
  isGatewayBackendCommunicationTask,
  isPluginLifecycleTask,
  loadRuleSpecs,
  loadScenarioSpecs,
  loadSpec,
  toArray,
} from './specs.mjs';
import {
  scanBackendCommunicationBoundary,
  touchesCommunicationPath,
  validateGatewayTaskSpec,
  validatePluginLifecycleTaskSpec,
} from './rules.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  pnpm harness list',
    '  pnpm harness validate --spec <path> [--since origin/main] [--no-diff]',
    '  pnpm harness explain --spec <path> [--since origin/main]',
    '  pnpm harness run --spec <path> [--since origin/main] [--dry-run] [--continue-on-error]',
  ].join('\n'));
}

async function findScenario(id) {
  const scenarios = await loadScenarioSpecs();
  return scenarios.find((scenario) => scenario.data.id === id);
}

async function list() {
  const scenarios = await loadScenarioSpecs();
  const rules = await loadRuleSpecs();
  console.log('Profiles:');
  for (const profile of Object.keys(PROFILES)) console.log(`- ${profile}`);
  console.log('\nScenario specs:');
  for (const spec of scenarios) console.log(`- ${spec.data.id}: ${spec.path}`);
  console.log('\nRule specs:');
  for (const spec of rules) console.log(`- ${spec.data.id}: ${spec.path}`);
}

async function validate(specPath, options = {}) {
  const spec = await loadSpec(specPath);
  const scenario = spec.data.scenario ? await findScenario(spec.data.scenario) : null;
  const shouldCheckDiff = !options.noDiff && (options.checkDiff || Boolean(spec.data.scenario));
  const changedFiles = shouldCheckDiff
    ? await getChangedFiles(options.since ?? 'origin/main')
    : [];
  const failures = [];

  if (spec.data.type === 'runtime-bridge' && spec.data.id === 'gateway-backend-communication') {
    for (const profile of ['fast', 'comms']) {
      if (!toArray(spec.data.requiredProfiles).includes(profile)) {
        failures.push(`${spec.path}: requiredProfiles must include "${profile}"`);
      }
    }
    for (const rule of ['renderer-main-boundary', 'backend-communication-boundary', 'comms-regression', 'docs-sync']) {
      if (!toArray(spec.data.requiredRules).includes(rule)) {
        failures.push(`${spec.path}: requiredRules must include "${rule}"`);
      }
    }
  } else if (isGatewayBackendCommunicationTask(spec)) {
    failures.push(...validateGatewayTaskSpec(spec, scenario, changedFiles));
  } else if (isPluginLifecycleTask(spec)) {
    failures.push(...validatePluginLifecycleTaskSpec(spec, scenario, changedFiles));
  } else if (!spec.data.id || !spec.data.title) {
    failures.push(`${spec.path}: spec must include id and title`);
  }

  if (changedFiles.length > 0 && touchesCommunicationPath(changedFiles) && isGatewayBackendCommunicationTask(spec)) {
    const requiredProfiles = toArray(spec.data.requiredProfiles);
    if (!requiredProfiles.includes('comms')) {
      failures.push(`${spec.path}: communication path changes must require comms`);
    }
  }

  return { spec, scenario, changedFiles, failures };
}

async function explain(specPath, options = {}) {
  const result = await validate(specPath, { ...options, checkDiff: Boolean(options.since) });
  const requiredProfiles = toArray(result.spec.data.requiredProfiles);
  const scenarioProfiles = toArray(result.scenario?.data?.requiredProfiles);
  const profiles = [...new Set([...scenarioProfiles, ...requiredProfiles])];
  console.log(`Spec: ${result.spec.path}`);
  console.log(`Scenario: ${result.spec.data.scenario ?? result.spec.data.id}`);
  console.log(`Task type: ${result.spec.data.taskType ?? result.spec.data.type ?? 'n/a'}`);
  console.log(`Required profiles: ${profiles.join(', ') || 'none'}`);
  if (result.changedFiles.length > 0) {
    console.log('\nChanged files:');
    for (const file of result.changedFiles) console.log(`- ${file}`);
  }
  console.log('\nSelected steps:');
  for (const step of selectSteps(profiles)) {
    console.log(`- [${step.profile}] ${step.command} ${step.args.join(' ')}`);
  }
  if (result.failures.length > 0) {
    console.log('\nValidation failures:');
    for (const failure of result.failures) console.log(`- ${failure}`);
  }
  return result.failures.length === 0 ? 0 : 1;
}

async function run(specPath, options = {}) {
  const startedAt = new Date().toISOString();
  const validation = await validate(specPath, { ...options, checkDiff: true });
  const requiredProfiles = [
    ...toArray(validation.scenario?.data?.requiredProfiles),
    ...toArray(validation.spec.data.requiredProfiles),
  ];
  const profiles = [...new Set(requiredProfiles)];
  const steps = [];
  const failures = [...validation.failures];

  const scanFiles = [
    ...validation.changedFiles,
    ...toArray(validation.spec.data.touchedAreas),
  ];
  const boundaryFailures = await scanBackendCommunicationBoundary(scanFiles);
  failures.push(...boundaryFailures);
  steps.push({
    profile: 'rules',
    name: 'Backend communication boundary scan',
    status: boundaryFailures.length === 0 ? 'pass' : 'fail',
    exitCode: boundaryFailures.length === 0 ? 0 : 1,
    durationMs: 0,
  });

  const selectedSteps = selectSteps(profiles);
  if (failures.length === 0) {
    for (const step of selectedSteps) {
      if (options.dryRun) {
        steps.push({ ...step, status: 'skipped', exitCode: 0, durationMs: 0 });
        continue;
      }
      const result = await runStep(step);
      steps.push(result);
      if (result.status !== 'pass') {
        failures.push(`${step.name} failed with exit code ${result.exitCode}`);
        if (!options.continueOnError) break;
      }
    }
  } else {
    for (const step of selectedSteps) {
      steps.push({ ...step, status: 'blocked', exitCode: 1, durationMs: 0 });
    }
  }

  const report = {
    specPath: validation.spec.path,
    scenario: validation.spec.data.scenario ?? validation.spec.data.id,
    taskType: validation.spec.data.taskType ?? validation.spec.data.type ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    changedFiles: validation.changedFiles,
    selectedProfiles: profiles,
    steps,
    failures,
    result: failures.length === 0 ? 'pass' : 'fail',
  };
  const paths = await writeReport(report);
  console.log(`Harness report: ${paths.markdownPath}`);
  if (failures.length > 0) {
    console.error(failures.map((failure) => `- ${failure}`).join('\n'));
    return 1;
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    printUsage();
    return 0;
  }

  if (command === 'list') {
    await list();
    return 0;
  }

  if (!args.spec) {
    printUsage();
    return 1;
  }

  if (command === 'validate') {
    const result = await validate(args.spec, {
      since: args.since,
      checkDiff: Boolean(args.since),
      noDiff: Boolean(args['no-diff']),
    });
    if (result.failures.length > 0) {
      console.error(result.failures.map((failure) => `- ${failure}`).join('\n'));
      return 1;
    }
    console.log(`Spec is valid: ${result.spec.path}`);
    return 0;
  }

  if (command === 'explain') {
    return await explain(args.spec, { since: args.since });
  }

  if (command === 'run') {
    return await run(args.spec, {
      since: args.since,
      dryRun: Boolean(args['dry-run']),
      continueOnError: Boolean(args['continue-on-error']),
    });
  }

  printUsage();
  return 1;
}

main().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
