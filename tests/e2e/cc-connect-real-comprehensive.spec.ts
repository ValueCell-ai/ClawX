import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import type { Page } from '@playwright/test';

const execFileAsync = promisify(execFile);

type HostInvokeResult<T = unknown> = {
  ok?: boolean;
  data?: T;
};

type HistoryPayload = {
  success?: boolean;
  messages?: Array<{
    role?: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
  }>;
};

type CronCompletion = {
  id?: string;
  lastRun?: {
    time?: string;
    success?: boolean;
    error?: string;
  };
};

async function collectCronCompletionDiagnostics(page: Page, cronId: string) {
  return await page.evaluate(async (id) => {
    const [cronList, health, snapshot, sessions] = await Promise.all([
      window.clawx.hostInvoke({
        id: `runtime-comprehensive-cron-list-diagnostics-${Date.now()}`,
        module: 'cron',
        action: 'list',
      }),
      window.clawx.hostInvoke({
        id: `runtime-comprehensive-health-diagnostics-${Date.now()}`,
        module: 'gateway',
        action: 'health',
        payload: { probe: true },
      }),
      window.clawx.hostInvoke({
        id: `runtime-comprehensive-snapshot-diagnostics-${Date.now()}`,
        module: 'diagnostics',
        action: 'gatewaySnapshot',
      }),
      window.clawx.hostInvoke({
        id: `runtime-comprehensive-sessions-diagnostics-${Date.now()}`,
        module: 'sessions',
        action: 'summaries',
        payload: {},
      }),
    ]);
    const jobs = Array.isArray(cronList.data) ? cronList.data : [];
    const runtime = snapshot.data && typeof snapshot.data === 'object'
      ? (snapshot.data as { runtime?: { ccConnect?: { logTail?: string } } }).runtime
      : undefined;
    return {
      job: jobs.find((job) => job && typeof job === 'object' && (job as { id?: string }).id === id) ?? null,
      health,
      sessions,
      logTail: runtime?.ccConnect?.logTail?.slice(-4_000) ?? '',
    };
  }, cronId);
}

async function waitForCronCompletion(page: Page, cronId: string, timeoutMs: number): Promise<CronCompletion> {
  const deadline = Date.now() + timeoutMs;
  let lastListError = 'no completion state observed';
  while (Date.now() < deadline) {
    const result = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: `runtime-cron-completion-research-real-comprehensive-${Date.now()}`,
        module: 'cron',
        action: 'list',
      });
    }) as HostInvokeResult<CronCompletion[]>;
    if (result.ok && Array.isArray(result.data)) {
      const job = result.data.find((candidate) => candidate.id === cronId);
      if (job?.lastRun) {
        if (!job.lastRun.success) {
          throw new Error(`cc-connect cron failed: ${job.lastRun.error || 'unknown runtime error'}`);
        }
        return job;
      }
      lastListError = job ? 'job has not completed' : 'job is absent from cron.list';
    } else {
      lastListError = `cron.list failed: ${JSON.stringify(result)}`;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`cc-connect cron did not complete within ${timeoutMs}ms: ${lastListError}`);
}

async function realRuntimeBundles(): Promise<{ ccConnectPath: string; codexPath: string } | null> {
  const platformArch = `${process.platform}-${process.arch}`;
  const ccConnectPath = join(
    process.cwd(),
    'build',
    'cc-connect',
    platformArch,
    process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect',
  );
  const codexPath = join(
    process.cwd(),
    'build',
    'codex',
    platformArch,
    'bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex',
  );
  try {
    await access(ccConnectPath);
    await access(codexPath);
    return { ccConnectPath, codexPath };
  } catch {
    return null;
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPortClosed(port: number): Promise<void> {
  await expect.poll(async () => await isPortOpen(port), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `cc-connect port ${port} should be free before real comprehensive smoke starts`,
  }).toBe(false);
}

async function listProcessCommandsContaining(needle: string): Promise<string[]> {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(needle))
    .filter((line) => !line.includes('ps -axo'));
}

async function waitForNoRuntimeProcesses(runtimeDir: string): Promise<void> {
  if (process.platform === 'win32') return;
  await expect.poll(async () => await listProcessCommandsContaining(runtimeDir), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `no real comprehensive runtime process should reference ${runtimeDir}`,
  }).toEqual([]);
}

async function copyLocalCodexAuthToManagedHome(userDataDir: string): Promise<string> {
  const source = process.env.CLAWX_REAL_CODEX_AUTH_JSON?.trim();
  test.skip(!source, 'Set CLAWX_REAL_CODEX_AUTH_JSON to the auth.json that may be copied into the managed CODEX_HOME.');
  const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
  await mkdir(managedCodexHome, { recursive: true });
  await copyFile(source, join(managedCodexHome, 'auth.json'));
  return source ?? '';
}

function historyContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (!block || typeof block !== 'object') return '';
    const record = block as { text?: unknown; content?: unknown };
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    return '';
  }).filter(Boolean).join('\n');
}

async function expectAssistantText(page: Page, text: string, timeout = 180_000): Promise<void> {
  await expect(page.getByTestId('chat-message-role-assistant').filter({ hasText: text }).last()).toBeVisible({ timeout });
}

test.describe('cc-connect real comprehensive runtime smoke', () => {
  test('validates chat, sessions, project workspace, skills, and cron through real cc-connect + Codex OAuth', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }, testInfo) => {
    test.setTimeout(900_000);
    test.skip(process.env.CLAWX_REAL_OAUTH_E2E !== '1', 'Set CLAWX_REAL_OAUTH_E2E=1 with an explicit CLAWX_REAL_CODEX_AUTH_JSON.');
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const authSource = await copyLocalCodexAuthToManagedHome(userDataDir);
    await access(authSource);

    const skillDir = join(homeDir, '.agents', 'skills', 'real-smoke-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: real-smoke-skill',
      'description: Real cc-connect smoke skill.',
      '---',
      'Use this skill only as a local sync sentinel.',
      '',
    ].join('\n'), 'utf8');

    const openClawConfigDir = join(homeDir, '.openclaw');
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
    const mainWorkspace = join(userDataDir, 'real-workspaces', 'main');
    const researchWorkspace = join(userDataDir, 'real-workspaces', 'research');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(mainWorkspace, { recursive: true });
    await mkdir(researchWorkspace, { recursive: true });

    const createdAt = new Date().toISOString();
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-oauth': {
          id: 'openai-oauth',
          vendorId: 'openai',
          label: 'OpenAI Codex OAuth',
          authMode: 'oauth_browser',
          model: 'gpt-5.5',
          enabled: true,
          isDefault: true,
          metadata: { resourceUrl: 'openai-codex' },
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {},
      apiKeys: {},
      defaultProviderAccountId: 'openai-oauth',
    }, null, 2), 'utf8');
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: mainWorkspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: mainWorkspace },
          { id: 'research', name: 'Research Agent', workspace: researchWorkspace },
        ],
      },
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __ccConnectRuntimeEvents?: Array<{ type?: unknown; runId?: unknown }>;
        };
        testWindow.__ccConnectRuntimeEvents = [];
        window.electron.ipcRenderer.on('chat:runtime-event', (payload) => {
          testWindow.__ccConnectRuntimeEvents!.push(payload as { type?: unknown; runId?: unknown });
        });
      });

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-comprehensive',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill('Reply exactly: CLAWX_REAL_COMPREHENSIVE_CHAT_OK');
      await page.getByTestId('chat-composer-send').click();
      await expectAssistantText(page, 'CLAWX_REAL_COMPREHENSIVE_CHAT_OK');

      const uiArtifactFile = join(mainWorkspace, 'clawx-real-ui-artifact.md');
      await page.getByTestId('chat-composer-input').fill([
        'Use the apply_patch tool to create a file named clawx-real-ui-artifact.md in the current workspace.',
        'The file content must be exactly two lines:',
        '# ClawX UI Artifact',
        'CLAWX_REAL_UI_ARTIFACT_OK',
        'After creating the file, finish the turn.',
      ].join('\n'));
      await page.getByTestId('chat-composer-send').click();
      await expect.poll(async () => (await readFile(uiArtifactFile, 'utf8').catch(() => '')).trim(), {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000, 10_000],
      }).toBe('# ClawX UI Artifact\nCLAWX_REAL_UI_ARTIFACT_OK');
      await expect(page.getByTestId('generated-files-panel')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('generated-file-card-clawx-real-ui-artifact.md')).toBeVisible({ timeout: 60_000 });

      const sessionsResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-sessions-real-comprehensive',
          module: 'sessions',
          action: 'summaries',
          payload: {},
        });
      });
      expect(sessionsResult).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({ key: 'agent:main:main' }),
          ]),
        },
      });

      const readHistory = async () => await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-history-real-comprehensive',
          module: 'sessions',
          action: 'history',
          payload: { sessionKey: 'agent:main:main', limit: 20 },
        });
      });
      await expect.poll(readHistory, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_REAL_COMPREHENSIVE_CHAT_OK' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        },
      });

      const restartResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-restart-real-comprehensive',
          module: 'gateway',
          action: 'restart',
        });
      });
      expect(restartResult).toMatchObject({ ok: true, data: { success: true } });
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await expect.poll(readHistory, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_REAL_COMPREHENSIVE_CHAT_OK' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        },
      });

      await access(mainWorkspace);
      await access(researchWorkspace);
      const managedConfig = await readFile(join(runtimeDir, 'config.toml'), 'utf8');
      expect(managedConfig).toContain(`work_dir = "${mainWorkspace}"`);
      expect(managedConfig).toContain('name = "clawx-research"');
      expect(managedConfig).toContain(`work_dir = "${researchWorkspace}"`);
      const workDirLines = managedConfig.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      expect(workDirLines).not.toContain(process.cwd());

      const researchChat = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-chat-send-research-real-comprehensive',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'chat.send',
            params: {
              sessionKey: 'agent:research:main',
              message: 'Reply exactly: CLAWX_REAL_RESEARCH_CHAT_OK',
            },
            timeoutMs: 60_000,
          },
        });
      });
      expect(researchChat).toMatchObject({
        ok: true,
        data: expect.objectContaining({ runId: expect.any(String) }),
      });

      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
              id: 'runtime-history-research-chat-real-comprehensive',
              module: 'sessions',
              action: 'history',
              payload: { sessionKey: 'agent:research:main', limit: 20 },
          });
        });
      }, {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_REAL_RESEARCH_CHAT_OK' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        },
      });

      const crossAgentSessions = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cross-agent-sessions-real-comprehensive',
          module: 'sessions',
          action: 'summaries',
          payload: {},
        });
      });
      expect(crossAgentSessions).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              key: 'agent:research:main',
              agentId: 'research',
              derivedTitle: expect.stringContaining('CLAWX_REAL_RESEARCH_CHAT_OK'),
              lastMessagePreview: expect.any(String),
            }),
          ]),
        },
      });

      const renameResearchSession = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-session-rename-research-real-comprehensive',
          module: 'sessions',
          action: 'rename',
          payload: {
            sessionKey: 'agent:research:main',
            title: 'Renamed research runtime session',
          },
        });
      });
      expect(renameResearchSession).toMatchObject({ ok: true, data: { success: true } });

      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-sessions-after-rename-real-comprehensive',
            module: 'sessions',
            action: 'summaries',
            payload: {},
          });
        });
      }, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              key: 'agent:research:main',
              displayName: 'Renamed research runtime session',
              derivedTitle: 'Renamed research runtime session',
            }),
          ]),
        },
      });

      const toolSmokeFile = join(researchWorkspace, 'clawx-real-tool-smoke.txt');
      const toolSmokePrompt = [
        'Use the apply_patch tool to create or overwrite a file named clawx-real-tool-smoke.txt in the current workspace.',
        'The file content must be exactly: CLAWX_REAL_TOOL_FILE_OK',
        'After writing the file, reply exactly: CLAWX_REAL_TOOL_FILE_DONE',
      ].join(' ');
      const toolSmoke = await page.evaluate(async (message) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-chat-send-tool-smoke-real-comprehensive',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'chat.send',
            params: {
              sessionKey: 'agent:research:tool-smoke',
              message,
            },
            timeoutMs: 60_000,
          },
        });
      }, toolSmokePrompt);
      expect(toolSmoke).toMatchObject({
        ok: true,
        data: expect.objectContaining({ runId: expect.any(String) }),
      });
      const toolSmokeRunId = (toolSmoke as { data?: { runId?: string } }).data?.runId;
      expect(toolSmokeRunId).toBeTruthy();

      await expect.poll(async () => {
        const [historyResult, fileContent] = await Promise.all([
          page.evaluate(async () => {
            return await window.clawx.hostInvoke({
              id: 'runtime-history-tool-smoke-real-comprehensive',
              module: 'sessions',
              action: 'history',
              payload: { sessionKey: 'agent:research:tool-smoke', limit: 50 },
            });
          }) as Promise<HostInvokeResult<HistoryPayload>>,
          readFile(toolSmokeFile, 'utf8').catch(() => ''),
        ]);
        return {
          fileContent: fileContent.trim(),
          hasFinalReply: (historyResult.data?.messages ?? []).some((message) =>
            historyContentText(message.content).includes('CLAWX_REAL_TOOL_FILE_DONE')
          ),
        };
      }, {
        timeout: 180_000,
        intervals: [2_000, 5_000, 10_000],
      }).toEqual({
        fileContent: 'CLAWX_REAL_TOOL_FILE_OK',
        hasFinalReply: true,
      });
      await expect.poll(async () => await page.evaluate((runId) => {
        const testWindow = window as typeof window & {
          __ccConnectRuntimeEvents?: Array<{ type?: unknown; runId?: unknown }>;
        };
        const eventTypes = (testWindow.__ccConnectRuntimeEvents ?? [])
          .filter((event) => event.runId === runId)
          .map((event) => event.type);
        return eventTypes.includes('tool.started') && eventTypes.includes('tool.completed');
      }, toolSmokeRunId), {
        timeout: 60_000,
        message: 'the direct research tool turn should expose run-correlated cc-connect Bridge tool events',
      }).toBe(true);

      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-token-usage-real-comprehensive',
            module: 'usage',
            action: 'recentTokenHistory',
            payload: { limit: 50 },
          });
        });
      }, {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'agent:main:main',
            agentId: 'main',
            totalTokens: expect.any(Number),
          }),
          expect.objectContaining({
            sessionId: 'agent:research:main',
            agentId: 'research',
            totalTokens: expect.any(Number),
          }),
        ]),
      });

      const skillsStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-skills-real-comprehensive',
          module: 'skills',
          action: 'status',
        });
      });
      expect(skillsStatus).toMatchObject({
        ok: true,
        data: {
          skills: expect.arrayContaining([
            expect.objectContaining({ skillKey: 'real-smoke-skill' }),
          ]),
        },
      });
      const accountCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
      await expect(readFile(join(skillDir, 'SKILL.md'), 'utf8'))
        .resolves.toContain('Real cc-connect smoke skill');
      const skillManifest = await readFile(join(accountCodexHome, 'skills', 'manifest.json'), 'utf8');
      expect(skillManifest).toContain('real-smoke-skill');
      expect(skillManifest).toContain('codex-native');
      expect(skillManifest).toContain(skillDir);

      const cronCreate = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-real-comprehensive',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real cc-connect smoke cron',
            message: 'Reply exactly: CLAWX_REAL_COMPREHENSIVE_CRON_OK',
            schedule: { kind: 'cron', expr: '0 9 * * *' },
            enabled: true,
            delivery: { mode: 'none' },
          },
        });
      });
      expect(cronCreate).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real cc-connect smoke cron',
          enabled: true,
        }),
      });
      const cronId = (cronCreate as { data?: { id?: string } }).data?.id;
      expect(cronId).toBeTruthy();

      const cronList = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-real-comprehensive',
          module: 'cron',
          action: 'list',
        });
      });
      expect(cronList).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: cronId }),
        ]),
      });

      const cronRun = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-run-real-comprehensive',
          module: 'cron',
          action: 'trigger',
          payload: { id },
        });
      }, cronId);
      if (!cronRun.ok) {
        throw new Error(`cron trigger failed: ${JSON.stringify(cronRun)}`);
      }
      expect(cronRun).toMatchObject({ ok: true, data: { success: true } });

      const cronToggle = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-toggle-real-comprehensive',
          module: 'cron',
          action: 'toggle',
          payload: { id, enabled: false },
        });
      }, cronId);
      expect(cronToggle).toMatchObject({
        ok: true,
        data: expect.objectContaining({ id: cronId, enabled: false }),
      });

      const cronDelete = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-delete-real-comprehensive',
          module: 'cron',
          action: 'delete',
          payload: { id },
        });
      }, cronId);
      expect(cronDelete).toMatchObject({ ok: true, data: { success: true } });

      const researchCronCreate = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-research-real-comprehensive',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real cc-connect research cron',
            message: 'Reply exactly: CLAWX_REAL_RESEARCH_CRON_OK',
            schedule: { kind: 'cron', expr: '0 10 * * *' },
            enabled: true,
            delivery: { mode: 'none' },
            agentId: 'research',
            timeoutMins: 3,
          },
        });
      });
      expect(researchCronCreate).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real cc-connect research cron',
          enabled: true,
          agentId: 'research',
        }),
      });
      const researchCronId = (researchCronCreate as { data?: { id?: string } }).data?.id;
      expect(researchCronId).toBeTruthy();

      const researchCronList = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-research-real-comprehensive',
          module: 'cron',
          action: 'list',
        });
      });
      expect(researchCronList).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: researchCronId, agentId: 'research' }),
        ]),
      });

      const researchCronRun = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-run-research-real-comprehensive',
          module: 'cron',
          action: 'trigger',
          payload: { id },
        });
      }, researchCronId);
      if (!researchCronRun.ok) {
        throw new Error(`research cron trigger failed: ${JSON.stringify(researchCronRun)}`);
      }
      expect(researchCronRun).toMatchObject({ ok: true, data: { success: true } });

      let completedResearchCron: CronCompletion | undefined;
      try {
        completedResearchCron = await waitForCronCompletion(page, researchCronId!, 210_000);
      } catch (error) {
        const diagnostics = await collectCronCompletionDiagnostics(page, researchCronId!);
        await testInfo.attach('research-cron-completion-diagnostics', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json',
        });
        throw error;
      }
      expect(completedResearchCron?.lastRun?.error).toBeUndefined();

      try {
        await expect.poll(async () => {
          return await page.evaluate(async () => {
            return await window.clawx.hostInvoke({
              id: 'runtime-history-research-cron-real-comprehensive',
              module: 'sessions',
              action: 'history',
              payload: { sessionKey: 'agent:research:cron:scheduled', limit: 20 },
            });
          });
        }, {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        }).toMatchObject({
          ok: true,
          data: {
            success: true,
            messages: expect.arrayContaining([
              expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_REAL_RESEARCH_CRON_OK' }),
              expect.objectContaining({ role: 'assistant' }),
            ]),
          },
        });
      } catch (error) {
        const diagnostics = await collectCronCompletionDiagnostics(page, researchCronId!);
        await testInfo.attach('research-cron-history-diagnostics', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json',
        });
        throw error;
      }

      const researchCronDelete = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-delete-research-real-comprehensive',
          module: 'cron',
          action: 'delete',
          payload: { id },
        });
      }, researchCronId);
      expect(researchCronDelete).toMatchObject({ ok: true, data: { success: true } });

      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CODEX_HOME');
      expect(publicProfile).not.toContain('access_token');
      expect(publicProfile).not.toContain('refresh_token');
      expect(publicProfile).not.toContain('id_token');

      const deleteSession = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-session-delete-real-comprehensive',
          module: 'sessions',
          action: 'delete',
          payload: { sessionKey: 'agent:main:main' },
        });
      });
      expect(deleteSession).toMatchObject({ ok: true, data: { success: true } });

      await expect.poll(async () => {
        const [sessionsAfterDelete, historyAfterDelete] = await Promise.all([
          page.evaluate(async () => {
            return await window.clawx.hostInvoke({
              id: 'runtime-sessions-after-delete-real-comprehensive',
              module: 'sessions',
              action: 'summaries',
              payload: {},
            });
          }),
          page.evaluate(async () => {
            return await window.clawx.hostInvoke({
              id: 'runtime-history-after-delete-real-comprehensive',
              module: 'sessions',
              action: 'history',
              payload: { sessionKey: 'agent:main:main', limit: 20 },
            });
          }),
        ]);
        const sessions = (sessionsAfterDelete as { data?: { sessions?: Array<{ key?: string }> } }).data?.sessions ?? [];
        const messages = (historyAfterDelete as { data?: { messages?: unknown[] } }).data?.messages ?? [];
        return {
          sessionRemoved: !sessions.some((session) => session.key === 'agent:main:main'),
          historyEmpty: messages.length === 0,
        };
      }, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toEqual({ sessionRemoved: true, historyEmpty: true });
    } finally {
      await closeElectronApp(app);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });
});
