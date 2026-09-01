import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isPluginLifecycleTask,
  loadRuleSpecs,
  loadScenarioSpecs,
  loadSpec,
  parseFrontmatter,
  pathMatchesAny,
  validateSpecReferences,
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

describe('harness spec references', () => {
  it('rejects missing primary or supplemental scenarios and required rules', () => {
    const failures = validateSpecReferences(
      {
        path: 'harness/specs/tasks/example.md',
        data: {
          scenario: 'gateway-backend-communication',
          scenarios: ['removed-scenario'],
          requiredRules: ['renderer-main-boundary', 'removed-rule'],
        },
      },
      [{ data: { id: 'gateway-backend-communication' } }],
      [{ data: { id: 'renderer-main-boundary' } }],
    );

    expect(failures).toEqual([
      'harness/specs/tasks/example.md: references unknown scenario "removed-scenario"',
      'harness/specs/tasks/example.md: references unknown rule "removed-rule"',
    ]);
  });
});

describe('harness specs', () => {
  it('defines the three-minute Gateway liveness recovery contract', async () => {
    const [task, heartbeatRule, communicationScenario, diagnosticsScenario, fourMissTask, observabilityTask] = await Promise.all([
      loadSpec('harness/specs/tasks/three-minute-gateway-liveness-recovery.md'),
      loadSpec('harness/specs/rules/gateway-heartbeat-safety.md'),
      loadSpec('harness/specs/scenarios/gateway-backend-communication.md'),
      loadSpec('harness/specs/scenarios/gateway-startup-diagnostics.md'),
      loadSpec('harness/specs/tasks/restore-gateway-heartbeat-recovery-after-four-misses.md'),
      loadSpec('harness/specs/tasks/make-gateway-heartbeat-observability-only.md'),
    ]);

    expect(task.data).toMatchObject({
      id: 'three-minute-gateway-liveness-recovery',
      scenario: 'gateway-backend-communication',
      taskType: 'runtime-bridge',
      requiredProfiles: ['fast', 'comms', 'e2e'],
      docs: { required: true },
    });
    expect(task.data.requiredRules).toEqual([
      'gateway-heartbeat-safety',
      'gateway-readiness-policy',
      'backend-communication-boundary',
      'comms-regression',
      'e2e-parallel-isolation',
      'docs-sync',
    ]);
    expect(task.data.requiredTests).toEqual(expect.arrayContaining([
      'electron/gateway/recovery-controller.test.ts',
      'tests/e2e/gateway-lifecycle.spec.ts',
      'tests/e2e/channels-health-diagnostics.spec.ts',
      'tests/unit/harness-specs.test.ts',
      'tests/unit/harness-git.test.ts',
    ]));

    for (const criterion of [
      '180 seconds',
      '5000ms',
      'exactly one system-presence probe per silence generation',
      'successful deadline system-presence probe',
      'owned Gateway',
      'external Gateway',
      'Code 1012',
      'No chat, tool, cron, or workload tracking',
    ]) {
      expect(task.data.acceptance.join('\n')).toContain(criterion);
    }

    for (const spec of [heartbeatRule, communicationScenario, diagnosticsScenario]) {
      expect(spec.body).toContain('180 seconds');
      expect(spec.body).toContain('system-presence');
      expect(spec.body).toContain('externally managed');
      expect(spec.body).not.toContain('four consecutive');
    }
    expect(communicationScenario.body).toContain('Renderer code must not own transport selection');
    expect(diagnosticsScenario.body).toContain('lastDeadlineProbeResult');
    for (const archivedTask of [fourMissTask, observabilityTask]) {
      expect(archivedTask.data).toMatchObject({
        title: expect.stringMatching(/^Historical:/),
        intent: expect.stringContaining('must not guide current Gateway lifecycle behavior'),
        expectedUserBehavior: ['This historical task does not define current user behavior.'],
        acceptance: ['Do not implement this historical task; use three-minute-gateway-liveness-recovery for the current liveness policy.'],
        docs: { required: false },
      });
      expect(archivedTask.body).toContain('Historical task superseded by `three-minute-gateway-liveness-recovery`');
    }
  });

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

  it('defines the embedded ACP subagent session contract', async () => {
    const [
      task,
      oldTask,
      gatewayScenario,
      workspaceScenario,
      acpRule,
      attentionRule,
      acpReference,
      workspaceReference,
      englishReadme,
      chineseReadme,
      japaneseReadme,
    ] = await Promise.all([
      loadSpec('harness/specs/tasks/embed-subagent-sessions-in-parent-chat.md'),
      loadSpec('harness/specs/tasks/surface-subagent-sessions-and-announcements.md'),
      loadSpec('harness/specs/scenarios/gateway-backend-communication.md'),
      loadSpec('harness/specs/scenarios/chat-workspace-and-navigation.md'),
      loadSpec('harness/specs/rules/acp-chat-state-and-history.md'),
      loadSpec('harness/specs/rules/sidebar-session-attention-authority.md'),
      readFile('harness/reference/acp-chat.md', 'utf8'),
      readFile('harness/reference/chat-workspace-and-navigation.md', 'utf8'),
      readFile('README.md', 'utf8'),
      readFile('README.zh-CN.md', 'utf8'),
      readFile('README.ja-JP.md', 'utf8'),
    ]);

    expect(task.data).toMatchObject({
      id: 'embed-subagent-sessions-in-parent-chat',
      scenario: 'gateway-backend-communication',
      taskType: 'runtime-bridge',
      requiredProfiles: ['fast', 'comms', 'e2e'],
      docs: { required: true },
    });
    expect(task.data.touchedAreas).toEqual(expect.arrayContaining([
      'shared/acp-chat/types.ts',
      'src/lib/acp/subagent-lineage.ts',
      'tests/unit/acp-subagent-lineage.test.ts',
    ]));
    expect(task.data.requiredTests).toEqual(expect.arrayContaining([
      'pnpm harness validate --spec harness/specs/tasks/embed-subagent-sessions-in-parent-chat.md',
      expect.stringContaining('tests/unit/acp-subagent-lineage.test.ts'),
    ]));

    const taskAcceptance = (task.data.acceptance as string[]).join('\n');
    expect(taskAcceptance).toContain('sole lineage membership and title authority');
    expect(taskAcceptance).toContain('prefers `parentSessionId`');
    expect(taskAcceptance).toContain('falls back to `spawnedBy`');
    expect(taskAcceptance).toContain('direct native children');
    expect(taskAcceptance).toContain('Latest exact-key Gateway catalog presence gates current child visibility and actionability');
    expect(taskAcceptance).toContain('return-target availability');
    expect(taskAcceptance).toContain('Presence does not create lineage membership or titles');
    expect(taskAcceptance).toContain('`status` and `hasActiveRun`');
    expect(taskAcceptance).toContain('sole run-state authority');
    expect(taskAcceptance).toContain('completed structured accepted ACP `sessions_spawn`');
    expect(taskAcceptance).toContain('non-empty `runId` and `childSessionKey`');
    expect(taskAcceptance).toContain('invalidation signal');
    expect(task.body).toContain('128 pages');
    expect(task.body).toContain('Archived, deleted, cleaned, or otherwise unlisted historical children are excluded');
    expect(task.body).toContain('does not scan transcripts, announcements, assistant prose, Gateway lineage, or child UUIDs');
    expect(taskAcceptance).not.toContain('only for the run status that ACP does not expose');

    const taskBehavior = (task.data.expectedUserBehavior as string[]).join('\n');
    expect(taskBehavior).toContain('localized composer control');
    expect(taskBehavior).toContain('only when at least one ACP-listed direct native child is also present under its exact key in the latest Gateway catalog');
    expect(taskBehavior).toContain('Each expanded row appears only for an ACP-listed direct child that is also present under its exact key in the latest Gateway catalog');
    expect(taskBehavior).toContain('return action appears only while its ACP-listed direct parent is also present under its exact key in the latest Gateway catalog');
    expect(taskBehavior).toContain('ACP remains the sole lineage membership and title authority');
    expect(taskBehavior).toContain('Gateway absence only gates current actionability');

    const oldTaskBehavior = (oldTask.data.expectedUserBehavior as string[]).join('\n');
    expect(oldTaskBehavior).toContain('no longer appears in the sidebar');
    expect(oldTaskBehavior).toContain('remains in the shared session catalog');

    expect(gatewayScenario.body).toContain('ACP `session/list` is the sole lineage membership and title authority');
    expect(gatewayScenario.body).toContain('Latest exact-key Gateway catalog presence gates current child visibility and actionability');
    expect(gatewayScenario.body).toContain('Presence never creates lineage membership or titles');
    expect(gatewayScenario.body).toContain('`status` and `hasActiveRun` remain the sole run-state authority');

    expect(workspaceScenario.body).toContain('return-target availability');
    expect(workspaceScenario.body).toContain('exact non-cascading deletion');

    expect(acpRule.body).toContain('ACP `session/list` is the sole lineage membership and title authority');
    expect(acpRule.body).toContain('accepted status, non-empty `runId`, and non-empty `childSessionKey`');
    expect(acpRule.body).toContain('only an invalidation signal');
    expect(acpRule.body).toContain('128 pages');
    expect(acpRule.body).toContain('archived, deleted, cleaned, or otherwise unlisted children');
    expect(acpRule.body).toContain('transcript, announcement, assistant prose, Gateway parent fields, or child UUIDs');

    expect(attentionRule.body).toContain('Latest exact-key Gateway catalog presence');
    expect(attentionRule.body).toContain('gates current child visibility and actionability');
    expect(attentionRule.body).toContain('return-target availability');
    expect(attentionRule.body).toContain('Presence MUST NOT create lineage membership or titles');
    expect(attentionRule.body).toContain('excluded from every implicit fallback candidate set');
    expect(attentionRule.body).toContain('exact and non-cascading');

    expect(acpReference).toContain('ACP `session/list` is the sole lineage membership and title authority');
    expect(acpReference).toContain('at most 128 pages');
    expect(acpReference).toContain('status: accepted');
    expect(acpReference).toContain('non-empty `runId` and `childSessionKey`');
    expect(acpReference).toContain('only an invalidation signal');
    expect(acpReference).toContain('no transcript, announcement, assistant-prose, Gateway-lineage, or UUID fallback');
    expect(acpReference).toContain('Latest exact-key Gateway catalog presence gates current child visibility and actionability');
    expect(acpReference).toContain('Presence does not create lineage membership or titles');

    expect(workspaceReference).toContain('Latest exact-key Gateway catalog presence');
    expect(workspaceReference).toContain('return-target availability');
    expect(workspaceReference).toContain('Gateway `status` and `hasActiveRun` remain the sole run-state authority');
    expect(workspaceReference).toContain('Presence does not invent lineage membership or titles');
    expect(workspaceReference).toContain('direct ACP parent');
    expect(workspaceReference).toContain('browser history');
    expect(workspaceReference).toContain('excluded from every implicit fallback candidate set');
    expect(workspaceReference).toContain('Deletion is exact and non-cascading');
    expect(workspaceReference).not.toContain('uses the exact Gateway catalog row only for `status` and `hasActiveRun`');

    const staleSidebarContract = 'remains selectable in the normal workspace session list';
    expect(taskBehavior).not.toContain(staleSidebarContract);
    expect(oldTaskBehavior).not.toContain(staleSidebarContract);
    expect(gatewayScenario.body).not.toContain(staleSidebarContract);
    expect(workspaceScenario.body).not.toContain(staleSidebarContract);
    expect(acpRule.body).not.toContain(staleSidebarContract);
    expect(attentionRule.body).not.toContain(staleSidebarContract);
    expect(acpReference).not.toContain(staleSidebarContract);
    expect(workspaceReference).not.toContain(staleSidebarContract);

    expect(englishReadme).toContain('embedded subagent status with child drill-down and direct-parent return');
    expect(chineseReadme).toContain('内嵌子 Agent 状态、下钻及直接返回父会话');
    expect(japaneseReadme).toContain('埋め込みサブエージェントの状態表示・子会話への移動・直接の親会話への復帰');
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
      const designOrPlanPaths = [...content.matchAll(/docs\/(?:specs|plans)\/[^\s)]+/g)].map((match) => match[0]);
      expect(designOrPlanPaths, `${file} must not depend on deleted design or plan documents`).toEqual([]);
    }
    const exists = async (p: string) => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    };
    expect(await exists('docs/plans')).toBe(false);
    expect(await exists('docs/specs')).toBe(false);
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
