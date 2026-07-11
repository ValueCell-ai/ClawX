#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const defaultReportPath = join(root, 'artifacts', 'cc-connect', 'local-real-validation-report.json');
const defaultOutputPath = join(root, 'artifacts', 'cc-connect', 'local-real-external-gates.md');
const defaultJsonOutputPath = join(root, 'artifacts', 'cc-connect', 'local-real-external-gates.json');

function deriveJsonOutputPath(outputPath) {
  return outputPath.endsWith('.md')
    ? `${outputPath.slice(0, -'.md'.length)}.json`
    : `${outputPath}.json`;
}

function parseArgs(argv) {
  const result = {
    reportPath: defaultReportPath,
    outputPath: defaultOutputPath,
    jsonOutputPath: defaultJsonOutputPath,
  };
  let jsonOutputExplicit = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('--report=')) result.reportPath = resolve(root, arg.slice('--report='.length));
    else if (arg.startsWith('--output=')) {
      result.outputPath = resolve(root, arg.slice('--output='.length));
      if (!jsonOutputExplicit) result.jsonOutputPath = deriveJsonOutputPath(result.outputPath);
    }
    else if (arg.startsWith('--json-output=')) {
      result.jsonOutputPath = resolve(root, arg.slice('--json-output='.length));
      jsonOutputExplicit = true;
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return [
    'Usage: node scripts/cc-connect-real-gate-handoff.mjs [--report=<path>] [--output=<path>] [--json-output=<path>]',
    '',
    'Reads the latest sanitized cc-connect local real-validation report and writes a',
    'credential-free handoff checklist plus a machine-readable JSON handoff for',
    'the remaining external replacement gates.',
  ].join('\n');
}

function markdownCell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

function missingPreconditionIds(report) {
  return new Set((report.missingPreconditions ?? []).map((item) => item.id));
}

function coverageStatus(report, id) {
  return (report.coverage ?? []).find((item) => item.id === id)?.status ?? 'not-run';
}

function buildExternalGateHandoff(report) {
  const missing = missingPreconditionIds(report);
  const codexAuthReady = !missing.has('codex-oauth-auth-json')
    && ['pass', 'partial'].includes(report.checks?.find((check) => check.id === 'codex-oauth-auth-json')?.status ?? 'pass');
  return [
    {
      id: 'openai-api-key-provider-model-chat',
      title: 'Real OpenAI API-key provider/model chat',
      required: ['CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY'],
      optional: ['CLAWX_REAL_OPENAI_MODEL'],
      command: 'pnpm run verify:cc-connect:local-real:api-key',
      currentStatus: coverageStatus(report, 'openai-api-key-provider-model-chat'),
      missingPreconditions: missing.has('openai-api-key-env') ? ['openai-api-key-env'] : [],
      handoff: [
        'Put the API key in process env or an untracked and gitignored .env.cc-connect.local file.',
        'Set CLAWX_REAL_OPENAI_MODEL only when the default model is unavailable for the test account.',
        'Do not commit real key material or paste it into report artifacts.',
      ],
    },
    {
      id: 'feishu-live-channel-lifecycle',
      title: 'Real Feishu/Lark channel lifecycle',
      required: [
        'CLAWX_REAL_CODEX_AUTH_JSON with complete non-expired Codex OAuth tokens',
        'CLAWX_REAL_FEISHU_APP_ID',
        'CLAWX_REAL_FEISHU_APP_SECRET',
      ],
      optional: ['CLAWX_REAL_FEISHU_DOMAIN', 'CLAWX_REAL_FEISHU_ACCOUNT_ID', 'CLAWX_REAL_FEISHU_ALLOW_FROM'],
      command: 'pnpm run verify:cc-connect:local-real:feishu',
      currentStatus: coverageStatus(report, 'feishu-live-channel-lifecycle'),
      missingPreconditions: [
        ...(!codexAuthReady ? ['codex-oauth-auth-json'] : []),
        ...(missing.has('feishu-env') ? ['feishu-env'] : []),
      ],
      handoff: [
        'Use a sandbox Feishu/Lark app and bot credentials.',
        'The test writes managed runtime config under isolated Electron userData and does not reuse user ~/.cc-connect.',
        'The app secret must stay in process env or an untracked and gitignored local env file.',
      ],
    },
    {
      id: 'feishu-live-inbound-delivery',
      title: 'Real Feishu/Lark inbound tenant-message delivery',
      required: [
        'CLAWX_REAL_CODEX_AUTH_JSON with complete non-expired Codex OAuth tokens',
        'CLAWX_REAL_FEISHU_APP_ID',
        'CLAWX_REAL_FEISHU_APP_SECRET',
        'CLAWX_REAL_FEISHU_INBOUND_E2E=1',
        'sandbox tenant chat that can send the verifier marker to the configured bot',
      ],
      optional: ['CLAWX_REAL_FEISHU_INBOUND_MARKER', 'CLAWX_REAL_FEISHU_INBOUND_TIMEOUT_MS'],
      command: 'pnpm run verify:cc-connect:local-real:feishu-inbound',
      currentStatus: coverageStatus(report, 'feishu-live-inbound-delivery'),
      missingPreconditions: [
        ...(!codexAuthReady ? ['codex-oauth-auth-json'] : []),
        ...(missing.has('feishu-env') ? ['feishu-env'] : []),
        ...(missing.has('feishu-inbound-fixture') ? ['feishu-inbound-fixture'] : []),
      ],
      handoff: [
        'When the E2E starts, read artifacts/cc-connect/feishu-inbound-marker.json.',
        'Send the marker exactly as message text to the configured Feishu/Lark bot before timeout.',
        'The marker artifact is intentionally sanitized and must not contain app secrets or OAuth tokens.',
      ],
    },
  ];
}

function toMarkdown(report, gates = buildExternalGateHandoff(report)) {
  const lines = [
    '# cc-connect External Gate Handoff',
    '',
    `- Source report generated at: ${report.generatedAt ?? 'unknown'}`,
    `- Source report status: ${(report.status ?? 'unknown').toUpperCase()}`,
    `- Runtime matrix status: ${(report.runtimeMatrixStatus ?? 'unknown').toUpperCase()}`,
    `- Replacement ready: ${report.replacementReadiness?.replacementReady ? 'yes' : 'no'}`,
    '- Non-destructive check: `pnpm run verify:cc-connect:local-real:external-gates:check`',
    '- Report-writing rerun: `pnpm run verify:cc-connect:local-real:external-gates`',
    '',
    '## Required External Gates',
    '',
    '| Gate | Current Status | Missing Preconditions | Command | Required Inputs | Optional Inputs |',
    '|---|---|---|---|---|---|',
    ...gates.map((gate) => [
      `| ${markdownCell(gate.title)}`,
      markdownCell(gate.currentStatus),
      markdownCell(gate.missingPreconditions.length > 0 ? gate.missingPreconditions.join(', ') : 'none'),
      markdownCell(gate.command),
      markdownCell(gate.required.join(', ')),
      `${markdownCell(gate.optional.join(', '))} |`,
    ].join(' | ')),
    '',
    '## Handoff Notes',
    '',
  ];
  for (const gate of gates) {
    lines.push(`### ${gate.title}`, '');
    for (const note of gate.handoff) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }
  lines.push(
    '## Safety',
    '',
    '- This file is generated from sanitized report metadata only.',
    '- Do not add real API keys, OAuth tokens, app secrets, generated auth files, or tenant-specific private data to this artifact.',
    '- Prefer process env, `.env.cc-connect.local`, or an explicit outside-repo env file for real credentials.',
    '',
  );
  return lines.join('\n');
}

function toJsonPayload(report, gates = buildExternalGateHandoff(report)) {
  return {
    schemaVersion: 1,
    sourceReport: {
      generatedAt: report.generatedAt ?? null,
      status: report.status ?? 'unknown',
      runtimeMatrixStatus: report.runtimeMatrixStatus ?? 'unknown',
      replacementReady: Boolean(report.replacementReadiness?.replacementReady),
    },
    commands: {
      nonDestructiveCheck: 'pnpm run verify:cc-connect:local-real:external-gates:check',
      reportWritingRerun: 'pnpm run verify:cc-connect:local-real:external-gates',
    },
    requiredExternalGates: gates.map((gate) => ({
      id: gate.id,
      title: gate.title,
      currentStatus: gate.currentStatus,
      missingPreconditions: gate.missingPreconditions,
      command: gate.command,
      requiredInputs: gate.required,
      optionalInputs: gate.optional,
      handoff: gate.handoff,
    })),
    safety: {
      sanitized: true,
      forbidden: [
        'real API keys',
        'OAuth tokens',
        'app secrets',
        'generated auth files',
        'tenant-specific private data',
      ],
    },
  };
}

function toJson(report, gates = buildExternalGateHandoff(report)) {
  return `${JSON.stringify(toJsonPayload(report, gates), null, 2)}\n`;
}

async function readReport(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeHandoff(reportPath, outputPath, jsonOutputPath = deriveJsonOutputPath(outputPath)) {
  const report = await readReport(reportPath);
  const gates = buildExternalGateHandoff(report);
  const markdown = toMarkdown(report, gates);
  const json = toJson(report, gates);
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(jsonOutputPath), { recursive: true });
  await writeFile(outputPath, markdown, 'utf8');
  await writeFile(jsonOutputPath, json, 'utf8');
  return { outputPath, jsonOutputPath, markdown, json };
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

export {
  buildExternalGateHandoff,
  parseArgs,
  toJson,
  toJsonPayload,
  toMarkdown,
  writeHandoff,
};

if (isCliEntryPoint()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else {
    writeHandoff(args.reportPath, args.outputPath, args.jsonOutputPath)
      .then(({ outputPath, jsonOutputPath }) => {
        console.log(`Wrote ${outputPath}`);
        console.log(`Wrote ${jsonOutputPath}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : String(error));
        process.exit(1);
      });
  }
}
