import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './specs.mjs';

const REPORT_DIR = path.join(ROOT, 'artifacts', 'harness');

export async function writeReport(report) {
  await mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, 'latest.json');
  const markdownPath = path.join(REPORT_DIR, 'latest.md');
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(markdownPath, renderMarkdownReport(report));
  return {
    jsonPath,
    markdownPath,
  };
}

function renderMarkdownReport(report) {
  const rows = report.steps.map((step) => (
    `| ${step.profile ?? 'rules'} | ${step.name} | ${step.status} | ${step.exitCode ?? ''} | ${step.durationMs ?? 0} |`
  ));
  const failures = report.failures.length > 0
    ? report.failures.map((failure) => `- ${failure}`).join('\n')
    : '- none';

  return [
    '# Harness Report',
    '',
    `- Spec: ${report.specPath}`,
    `- Scenario: ${report.scenario}`,
    `- Result: ${report.result}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    '',
    '## Steps',
    '',
    '| Profile | Step | Status | Exit code | Duration ms |',
    '|---|---|---:|---:|---:|',
    ...rows,
    '',
    '## Failures',
    '',
    failures,
    '',
  ].join('\n');
}
