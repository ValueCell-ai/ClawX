import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isPluginLifecycleTask,
  loadRuleSpecs,
  loadScenarioSpecs,
  loadSpec,
  parseFrontmatter,
  pathMatchesAny,
} from '../../harness/src/specs.mjs';
import {
  scanBackendCommunicationBoundary,
  touchesCommunicationPath,
  validateGatewayTaskSpec,
  validatePluginLifecycleTaskSpec,
} from '../../harness/src/rules.mjs';

async function readMarkdownTree(directory: string): Promise<Array<{ file: string; content: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return readMarkdownTree(file);
    if (!entry.isFile() || !entry.name.endsWith('.md')) return [];
    return [{ file, content: await readFile(file, 'utf8') }];
  }));
  return nested.flat();
}

describe('harness specs', () => {
  it('defines the sidebar session attention harness contract', async () => {
    const expectedRules = [
      'renderer-main-boundary',
      'backend-communication-boundary',
      'host-events-fallback-policy',
      'gateway-readiness-policy',
      'ui-i18n-design-tokens',
      'sidebar-session-attention-authority',
      'comms-regression',
      'docs-sync',
    ];
    const [task, rules, scenarios] = await Promise.all([
      loadSpec('harness/specs/tasks/sidebar-session-attention.md'),
      loadRuleSpecs(),
      loadScenarioSpecs(),
    ]);
    const ruleIds = new Set(rules.map((rule) => rule.data.id));
    const affectedScenarioIds = [
      'gateway-backend-communication',
      'chat-workspace-and-navigation',
    ];

    expect(task.data.scenario).toBe('gateway-backend-communication');
    expect(task.data.requiredProfiles).toEqual(['fast', 'comms', 'e2e']);
    expect(task.data.requiredRules).toEqual(expectedRules);
    expect(ruleIds).toContain('sidebar-session-attention-authority');
    for (const scenarioId of affectedScenarioIds) {
      const scenario = scenarios.find((candidate) => candidate.data.id === scenarioId);
      expect(scenario?.data.requiredRules).toContain('sidebar-session-attention-authority');
    }
  });

  it('defines the local HTML preview harness contract', async () => {
    const expectedRules = [
      'renderer-main-boundary',
      'web-browser-security-and-lifecycle',
      'docs-sync',
    ];
    const [task, rules, scenarios, browserReference] = await Promise.all([
      loadSpec('harness/specs/tasks/web-browser.md'),
      loadRuleSpecs(),
      loadScenarioSpecs(),
      readFile('harness/reference/web-browser.md', 'utf8'),
    ]);
    const ruleIds = new Set(rules.map((rule) => rule.data.id));
    const workspaceScenario = scenarios.find(
      (scenario) => scenario.data.id === 'chat-workspace-and-navigation',
    );

    expect(task.data).toMatchObject({
      id: 'web-browser',
      scenario: 'gateway-backend-communication',
      taskType: 'runtime-bridge',
      requiredProfiles: ['fast'],
      requiredRules: expectedRules,
      docs: { required: true },
    });
    expect(expectedRules.filter((ruleId) => !ruleIds.has(ruleId))).toEqual([]);
    expect(workspaceScenario?.data.ownedPaths).toEqual(expect.arrayContaining([
      'src/components/web-browser/**',
      'tests/e2e/chat-acp-attachments.spec.ts',
      'tests/e2e/chat-file-changes.spec.ts',
    ]));
    expect(workspaceScenario?.body).toContain('harness/reference/web-browser.md');

    for (const contractAnchor of [
      'persist:clawx-web-browser',
      '`file:///`',
      'one-live-guest registry',
      'All links are inert',
      'denies all permissions',
      'cancels downloads',
      'blocks network protocols',
    ]) {
      expect(browserReference).toContain(contractAnchor);
    }
  });

  it('defines the Office document preview harness contract', async () => {
    const [task, rules, scenarios] = await Promise.all([
      loadSpec('harness/specs/tasks/office-document-preview.md'),
      loadRuleSpecs(),
      loadScenarioSpecs(),
    ]);
    const ruleIds = new Set(rules.map((rule) => rule.data.id));
    const workspaceScenario = scenarios.find(
      (scenario) => scenario.data.id === 'chat-workspace-and-navigation',
    );

    expect(task.data).toMatchObject({
      id: 'office-document-preview',
      scenario: 'chat-workspace-and-navigation',
      taskType: 'runtime-bridge',
      requiredProfiles: ['fast', 'e2e'],
      docs: { required: true },
    });
    expect(task.data.requiredRules).toEqual([
      'renderer-main-boundary',
      'attachment-access-safety',
      'tool-derived-file-safety',
      'ui-i18n-design-tokens',
      'office-preview-safety',
      'docs-sync',
    ]);
    expect(ruleIds).toContain('office-preview-safety');
    expect(workspaceScenario?.data.requiredRules).toContain('office-preview-safety');
    expect(workspaceScenario?.data.ownedPaths).toEqual(expect.arrayContaining([
      'src/components/file-preview/DocxViewer.tsx',
      'src/components/file-preview/PptxViewer.tsx',
      'src/pages/Chat/AcpTurnFileActivity.tsx',
      'src/pages/Chat/AcpAttachmentPart.tsx',
      'tests/e2e/office-document-preview.spec.ts',
    ]));
    expect(workspaceScenario?.body).toContain('DOCX');
    expect(workspaceScenario?.body).toContain('PPTX');
    expect(workspaceScenario?.body).toContain('20 MB');
    expect(workspaceScenario?.body).toContain('single mounted PPTX viewer');
  });

  it('defines the Streamdown Markdown rendering harness contract', async () => {
    const referencePath = 'harness/reference/markdown-rendering.md';
    const focusedTests = [
      'tests/unit/streamdown-config.test.tsx',
      'tests/unit/markdown-preview.test.tsx',
      'tests/unit/acp-chat-components.test.tsx',
      'tests/e2e/markdown-file-preview.spec.ts',
      'tests/e2e/chat-streamdown-rendering.spec.ts',
    ];
    const [task, rules, scenarios, markdownReference] = await Promise.all([
      loadSpec('harness/specs/tasks/replace-markdown-renderer-with-streamdown.md'),
      loadRuleSpecs(),
      loadScenarioSpecs(),
      readFile(referencePath, 'utf8'),
    ]);
    const markdownRule = rules.find(
      (rule) => rule.data.id === 'markdown-rendering-safety-and-performance',
    );
    const scenarioById = new Map(scenarios.map((scenario) => [scenario.data.id, scenario]));
    const requiredTests = task.data.requiredTests as string[];

    expect(task.data).toMatchObject({
      id: 'replace-markdown-renderer-with-streamdown',
      scenario: 'acp-chat-experience',
      taskType: 'runtime-bridge',
      requiredProfiles: ['fast', 'e2e'],
      docs: { required: true },
    });
    expect(task.data.requiredRules).toContain('markdown-rendering-safety-and-performance');
    expect(task.body).toContain(referencePath);
    expect(markdownRule?.data.appliesTo).toEqual(expect.arrayContaining([
      'acp-chat-experience',
      'chat-workspace-and-navigation',
    ]));
    expect(markdownRule?.body).toContain(referencePath);
    expect(markdownReference).toContain('word-level');
    expect(markdownReference).toContain('before/after');

    const scenarioTests = new Map([
      ['acp-chat-experience', 'tests/e2e/chat-streamdown-rendering.spec.ts'],
      ['chat-workspace-and-navigation', 'tests/e2e/markdown-file-preview.spec.ts'],
    ]);
    for (const [scenarioId, testPath] of scenarioTests) {
      const scenario = scenarioById.get(scenarioId);
      expect(scenario?.data.requiredRules).toContain('markdown-rendering-safety-and-performance');
      expect(scenario?.data.ownedPaths).toContain(testPath);
      expect(scenario?.body).toContain(referencePath);
    }
    for (const testPath of focusedTests) {
      expect(requiredTests.join('\n')).toContain(testPath);
    }
    expect(requiredTests).toContain('pnpm run perf:chat');
  });

  it('keeps implemented design decisions in topic-based Harness references', async () => {
    const [
      browserReference,
      officeReference,
      attentionReference,
      attachmentReference,
      scenarios,
      harnessMarkdown,
    ] = await Promise.all([
      readFile('harness/reference/web-browser.md', 'utf8'),
      readFile('harness/reference/office-document-preview.md', 'utf8'),
      readFile('harness/reference/sidebar-session-attention.md', 'utf8'),
      readFile('harness/reference/acp-attachment-access-control.md', 'utf8'),
      loadScenarioSpecs(),
      readMarkdownTree('harness'),
    ]);

    for (const anchor of [
      'User flow',
      'Link behavior',
      'Renderer flow',
      'Main boundary',
      'Security consequence',
    ]) {
      expect(browserReference).toContain(anchor);
    }

    for (const anchor of [
      '`docx-preview`',
      '`pptxviewjs@1.1.9`',
      '`jszip`',
      '`chart.js`',
      '20 MB',
      '`window.currentProcessor`',
      'Future Hardening',
    ]) {
      expect(officeReference).toContain(anchor);
    }

    for (const anchor of [
      '`clawx.session-attention`',
      '`sessions.changed`',
      '`list.ts`',
      '`event.ts`',
      '`done`',
      '`hasActiveRun`',
      '`sessions.patch({ unread: false })`',
    ]) {
      expect(attentionReference).toContain(anchor);
    }

    for (const anchor of [
      '64 KiB',
      'five seconds',
      'static JXA',
      'SHA-256',
      'Successful Empty Result On Linux',
      'Rejected Alternatives',
    ]) {
      expect(attachmentReference).toContain(anchor);
    }

    const scenarioById = new Map(scenarios.map((scenario) => [scenario.data.id, scenario]));
    expect(scenarioById.get('gateway-backend-communication')?.data.requiredRules)
      .toContain('web-browser-security-and-lifecycle');
    for (const scenarioId of ['chat-workspace-and-navigation', 'acp-chat-experience', 'acp-file-activity']) {
      expect(scenarioById.get(scenarioId)?.data.requiredRules).toContain('office-preview-safety');
    }

    for (const { file, content } of harnessMarkdown) {
      expect(content, `${file} must not depend on deleted design or plan documents`)
        .not.toMatch(/docs\/(?:specs|plans)\//);
    }
    await expect(access('docs/specs')).rejects.toThrow();
  });

  it('defines the ACP media attachment harness contract', async () => {
    const expectedRules = [
      'renderer-main-boundary',
      'backend-communication-boundary',
      'api-client-transport-policy',
      'host-api-fallback-policy',
      'acp-chat-state-and-history',
      'acp-compatibility-content-safety',
      'attachment-access-safety',
      'diagnostics-trace-safety',
      'session-workspace-authority',
      'tool-derived-file-safety',
      'ui-i18n-design-tokens',
      'comms-regression',
      'docs-sync',
    ];
    const [task, rules, scenarios] = await Promise.all([
      loadSpec('harness/specs/tasks/acp-media-attachments.md'),
      loadRuleSpecs(),
      loadScenarioSpecs(),
    ]);
    const ruleIds = new Set(rules.map((rule) => rule.data.id));
    const acpChatScenario = scenarios.find((scenario) => scenario.data.id === 'acp-chat-experience');

    expect(task.data.id).toBe('acp-media-attachments');
    expect(task.data.requiredRules).toEqual(expectedRules);
    expect(expectedRules.filter((ruleId) => !ruleIds.has(ruleId))).toEqual([]);
    expect(task.data.requiredProfiles).toContain('e2e');
    expect(acpChatScenario?.data.ownedPaths).toContain('tests/e2e/chat-acp-attachments.spec.ts');
  });

  it('keeps the structural task example on current ACP session catalog behavior', async () => {
    const example = await loadSpec('harness/specs/tasks/maintain-session-catalog-reconciliation.example.md');

    expect(example.data).toMatchObject({
      id: 'maintain-session-catalog-reconciliation',
      scenario: 'gateway-backend-communication',
      taskType: 'runtime-bridge',
      requiredProfiles: ['fast', 'comms'],
      docs: { required: false },
    });
    expect(example.data.requiredTests).toEqual([
      'tests/unit/session-catalog.test.ts',
      'tests/unit/chat-session-management.test.ts',
    ]);
    expect(example.body).toContain('session catalog alongside ACP Chat');
    expect(example.body).not.toMatch(/chat\.history|sendMessage|activeRunId|pendingFinal/);
  });

  it('parses Markdown frontmatter with arrays and nested docs', () => {
    const spec = parseFrontmatter(`---
id: example
requiredProfiles:
  - fast
  - comms
docs:
  required: false
---

Body`);

    expect(spec.data.id).toBe('example');
    expect(spec.data.requiredProfiles).toEqual(['fast', 'comms']);
    expect(spec.data.docs).toEqual({ required: false });
  });

  it('matches repository glob paths', () => {
    expect(pathMatchesAny('src/stores/chat/runtime-graph.ts', ['src/stores/chat/**'])).toBe(true);
    expect(pathMatchesAny('src/lib/host-api.ts', ['src/lib/host-api.ts'])).toBe(true);
    expect(pathMatchesAny('src/pages/Chat/index.tsx', ['electron/gateway/**'])).toBe(false);
  });

  it('requires gateway backend communication tasks to run fast and comms', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/example.md',
      data: {
        id: 'example',
        title: 'Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust backend communication.',
        touchedAreas: ['src/lib/host-api.ts'],
        expectedUserBehavior: ['Visible state remains consistent.'],
        requiredProfiles: ['fast'],
        acceptance: ['Comms compare passes.'],
        docs: { required: false },
      },
    };
    const scenarioSpec = {
      data: {
        requiredProfiles: ['fast', 'comms'],
        ownedPaths: ['src/lib/host-api.ts'],
      },
    };

    expect(validateGatewayTaskSpec(taskSpec, scenarioSpec)).toContain(
      'harness/specs/tasks/example.md: requiredProfiles must include "comms"',
    );
  });

  it('detects plugin lifecycle task specs for strict validation', () => {
    expect(isPluginLifecycleTask({
      data: {
        scenario: 'plugin-lifecycle-management',
      },
    })).toBe(true);
    expect(isPluginLifecycleTask({
      data: {
        scenarios: ['plugin-lifecycle-management'],
      },
    })).toBe(true);
    expect(isPluginLifecycleTask({
      data: {
        scenario: 'gateway-backend-communication',
      },
    })).toBe(false);
  });

  it('requires plugin lifecycle tasks to declare strict task fields', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/plugin-example.md',
      data: {
        id: 'plugin-example',
        title: 'Plugin Example',
        scenario: 'plugin-lifecycle-management',
        taskType: 'plugin-lifecycle',
        intent: 'Adjust plugin lifecycle behavior.',
        requiredProfiles: [],
        docs: { required: false },
      },
    };
    const scenarioSpec = {
      data: {
        requiredProfiles: ['fast'],
        ownedPaths: ['electron/utils/plugin-install.ts'],
      },
    };

    expect(validatePluginLifecycleTaskSpec(taskSpec, scenarioSpec)).toEqual(
      expect.arrayContaining([
        'harness/specs/tasks/plugin-example.md: requiredProfiles must include "fast"',
        'harness/specs/tasks/plugin-example.md: touchedAreas must declare affected paths',
        'harness/specs/tasks/plugin-example.md: expectedUserBehavior must declare visible behavior',
        'harness/specs/tasks/plugin-example.md: acceptance must declare completion criteria',
      ]),
    );
  });

  it('rejects plugin lifecycle tasks with the wrong scenario or task type', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/plugin-example.md',
      data: {
        id: 'plugin-example',
        title: 'Plugin Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust plugin lifecycle behavior.',
        touchedAreas: ['electron/utils/plugin-install.ts'],
        expectedUserBehavior: ['Plugin remains usable.'],
        requiredProfiles: ['fast'],
        acceptance: ['Validation passes.'],
        docs: { required: false },
      },
    };

    expect(validatePluginLifecycleTaskSpec(taskSpec, null)).toEqual(
      expect.arrayContaining([
        'harness/specs/tasks/plugin-example.md: plugin lifecycle tasks must set scenario: plugin-lifecycle-management',
        'harness/specs/tasks/plugin-example.md: plugin lifecycle tasks must set taskType: plugin-lifecycle',
      ]),
    );
  });

  it('detects communication path changes', () => {
    expect(touchesCommunicationPath(['electron/gateway/manager.ts'])).toBe(true);
    expect(touchesCommunicationPath(['README.md'])).toBe(false);
  });

  it('blocks direct Gateway HTTP in renderer files', async () => {
    const failures = await scanBackendCommunicationBoundary(['src/pages/Chat/index.tsx']);
    expect(failures).toEqual([]);
  });

  it('allows fallback flags only in their boundary modules', async () => {
    const failures = await scanBackendCommunicationBoundary([
      'src/lib/host-api-client.ts',
      'src/lib/host-api.ts',
      'src/lib/host-events.ts',
    ]);
    expect(failures).toEqual([]);
  });

  it('allows pages and components to display gatewayReady state', async () => {
    const failures = await scanBackendCommunicationBoundary(['src/components/layout/Sidebar.tsx']);
    expect(failures).toEqual([]);
  });
});
