import { writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import {
  closeElectronApp,
  emitAcpSessionUpdates,
  expect,
  getStableWindow,
  installIpcMocks,
  startMainCpuProfile,
  stopMainCpuProfile,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:performance';
const WORKSPACE = '/synthetic-workspace';
const HISTORY_TURNS = 80;
const STREAM_CHUNKS = 300;
const STREAM_INTERVAL_MS = 2;
const STREAM_SENTINEL = 'STREAM-PROFILE-COMPLETE';
const INTERACTION_SECTIONS = 32;
const INTERACTION_SCROLL_STEPS = 32;

type PerformanceMetric = { name: string; value: number };

type FramePacing = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over20Ms: number;
  over34Ms: number;
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function metricMap(metrics: PerformanceMetric[]): Record<string, number> {
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(
  before: Record<string, number>,
  after: Record<string, number>,
  name: string,
): number | null {
  const start = before[name];
  const end = after[name];
  return typeof start === 'number' && typeof end === 'number' ? end - start : null;
}

async function openSyntheticChat(app: ElectronApplication): Promise<Page> {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: SESSION_KEY, displayName: 'Performance fixture', workspacePath: WORKSPACE }],
        },
      },
    },
    hostApi: {
      [stableStringify(['chat', 'loadAcpSession', {
        sessionKey: SESSION_KEY,
        workspaceRoot: WORKSPACE,
        cwd: WORKSPACE,
      }])]: { success: true, generation: 1 },
      [stableStringify(['chat', 'loadAcpSession', {
        sessionKey: SESSION_KEY,
        workspaceRoot: WORKSPACE,
        cwd: WORKSPACE,
        createIfMissing: true,
      }])]: { success: true, generation: 1 },
      [stableStringify(['/api/agents', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: {
            success: true,
            agents: [{ id: 'main', name: 'main', workspace: WORKSPACE, mainSessionKey: SESSION_KEY }],
          },
        },
      },
    },
  });

  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
  return page;
}

async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function startFrameSampling(page: Page, durationMs: number): Promise<void> {
  await page.evaluate((duration) => {
    const perfWindow = window as typeof window & { __clawxPerfFrameSamples?: number[] };
    const samples: number[] = [];
    let previous = performance.now();
    const deadline = previous + duration;
    const sample = (now: number) => {
      samples.push(now - previous);
      previous = now;
      if (now < deadline) requestAnimationFrame(sample);
    };
    perfWindow.__clawxPerfFrameSamples = samples;
    requestAnimationFrame(sample);
  }, durationMs);
}

async function readFramePacing(page: Page): Promise<FramePacing> {
  const samples = await page.evaluate(() => (
    (window as typeof window & { __clawxPerfFrameSamples?: number[] }).__clawxPerfFrameSamples ?? []
  ));
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    count: samples.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: Math.max(0, ...samples),
    over20Ms: samples.filter((duration) => duration > 20).length,
    over34Ms: samples.filter((duration) => duration > 34).length,
  };
}

function richStaticMarkdown(): string {
  return Array.from({ length: INTERACTION_SECTIONS }, (_, index) => `
## Rich Markdown section ${index + 1}

This paragraph contains **bold text**, *emphasis*, ~~strikethrough~~, a [safe link](https://example.com), and CJK punctuation：中文、日本語、한국어。

- Nested item ${index + 1}.1
- Nested item ${index + 1}.2 with \`inline code\`

| Column A | Column B | Column C |
| --- | ---: | :---: |
| row ${index + 1} | value ${index * 17} | $x_${index + 1}^2$ |

\`\`\`javascript
function section${index + 1}(value) {
  return value * ${index + 1};
}
\`\`\`
`).join('\n');
}

async function writeArtifact(testInfo: TestInfo, name: string, body: unknown): Promise<string> {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(body));
  await testInfo.attach(name, { path, contentType: 'application/json' });
  return path;
}

test.use({ trace: 'off', video: 'off' });

test('profiles a populated timeline during a growing Markdown stream', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    const page = await openSyntheticChat(app);
    const historicalUpdates = Array.from({ length: HISTORY_TURNS * 2 }, (_, index) => ({
      sessionUpdate: index % 2 === 0 ? 'user_message' : 'agent_message',
      messageId: `profile-history-${index}`,
      content: [{
        type: 'text',
        text: index % 2 === 0
          ? `Synthetic question ${Math.floor(index / 2) + 1}`
          : `Synthetic answer ${Math.floor(index / 2) + 1} with **Markdown** and \`inline code\`.`,
      }],
    }));
    await emitAcpSessionUpdates(app, {
      sessionKey: SESSION_KEY,
      updates: historicalUpdates,
      generation: 1,
      historical: true,
    });
    await expect(page.getByText(`Synthetic answer ${HISTORY_TURNS} with`)).toBeVisible({ timeout: 30_000 });
    await waitForPaint(page);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const beforeMetrics = metricMap((await cdp.send('Performance.getMetrics')).metrics as PerformanceMetric[]);
    await page.evaluate(() => {
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      try {
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        // Some Electron builds do not expose the Long Tasks API.
      }
      Object.assign(window, { __clawxPerfLongTasks: longTasks, __clawxPerfObserver: observer });
    });

    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1_000 });
    await startMainCpuProfile(app);
    await cdp.send('Profiler.start');
    const startedAt = Date.now();

    const liveUpdates = [
      {
        sessionUpdate: 'user_message',
        messageId: 'profile-live-user',
        content: [{ type: 'text', text: 'Generate the synthetic streaming profile.' }],
      },
      ...Array.from({ length: STREAM_CHUNKS }, (_, index) => ({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'profile-live-assistant',
        content: {
          type: 'text',
          text: index === STREAM_CHUNKS - 1
            ? `\n\n${STREAM_SENTINEL}`
            : `Chunk ${index + 1}: **bold** value ${index % 17}\n\n`,
        },
      })),
    ];
    await emitAcpSessionUpdates(app, {
      sessionKey: SESSION_KEY,
      updates: liveUpdates,
      generation: 1,
      intervalMs: STREAM_INTERVAL_MS,
    });
    await expect(page.getByTestId('acp-assistant-message').filter({ hasText: STREAM_SENTINEL })).toBeVisible({
      timeout: 30_000,
    });
    await waitForPaint(page);

    const elapsedMs = Date.now() - startedAt;
    const rendererProfile = (await cdp.send('Profiler.stop')).profile;
    const mainProfile = await stopMainCpuProfile(app);
    const afterMetrics = metricMap((await cdp.send('Performance.getMetrics')).metrics as PerformanceMetric[]);
    const longTasks = await page.evaluate(() => {
      const perfWindow = window as typeof window & {
        __clawxPerfLongTasks?: number[];
        __clawxPerfObserver?: PerformanceObserver;
      };
      perfWindow.__clawxPerfObserver?.disconnect();
      return perfWindow.__clawxPerfLongTasks ?? [];
    });
    await cdp.detach();

    const benchmark = {
      schemaVersion: 1,
      scope: {
        renderer: 'production-renderer-store-and-render-path',
        main: 'synthetic-main-to-renderer-ipc-fanout',
      },
      workload: {
        historyTurns: HISTORY_TURNS,
        streamChunks: STREAM_CHUNKS,
        streamIntervalMs: STREAM_INTERVAL_MS,
      },
      runtime: {
        platform: process.platform,
        arch: process.arch,
        electron: await app.evaluate(async () => process.versions.electron),
        chrome: await app.evaluate(async () => process.versions.chrome),
      },
      elapsedMs,
      renderer: {
        taskDurationMs: metricDelta(beforeMetrics, afterMetrics, 'TaskDuration')! * 1_000,
        scriptDurationMs: metricDelta(beforeMetrics, afterMetrics, 'ScriptDuration')! * 1_000,
        layoutDurationMs: metricDelta(beforeMetrics, afterMetrics, 'LayoutDuration')! * 1_000,
        recalcStyleDurationMs: metricDelta(beforeMetrics, afterMetrics, 'RecalcStyleDuration')! * 1_000,
        jsHeapUsedSizeDelta: metricDelta(beforeMetrics, afterMetrics, 'JSHeapUsedSize'),
        nodesDelta: metricDelta(beforeMetrics, afterMetrics, 'Nodes'),
        longTasks: {
          count: longTasks.length,
          totalDurationMs: longTasks.reduce((total, duration) => total + duration, 0),
          maxDurationMs: Math.max(0, ...longTasks),
        },
      },
    };

    await Promise.all([
      writeArtifact(testInfo, 'renderer-benchmark.json', benchmark),
      writeArtifact(testInfo, 'renderer.cpuprofile', rendererProfile),
      writeArtifact(testInfo, 'main.cpuprofile', mainProfile),
    ]);
    console.log(`ClawX chat performance: ${JSON.stringify(benchmark)}`);

    expect(liveUpdates).toHaveLength(STREAM_CHUNKS + 1);
    const streamedMessage = page.getByTestId('acp-assistant-message').filter({ hasText: STREAM_SENTINEL });
    await expect(streamedMessage).toHaveCount(1);
    const renderedText = await streamedMessage.textContent() ?? '';
    let previousChunkOffset = -1;
    for (let index = 1; index <= STREAM_CHUNKS - 1; index += 1) {
      const offset = renderedText.indexOf(`Chunk ${index}:`);
      expect(offset, `stream chunk ${index} should be present and ordered`).toBeGreaterThan(previousChunkOffset);
      previousChunkOffset = offset;
    }
  } finally {
    await closeElectronApp(app);
  }
});

test('profiles sidebar animation and scrolling with rich static Markdown', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    const page = await openSyntheticChat(app);
    const markdown = richStaticMarkdown();
    await emitAcpSessionUpdates(app, {
      sessionKey: SESSION_KEY,
      generation: 1,
      historical: true,
      updates: [
        {
          sessionUpdate: 'user_message',
          messageId: 'interaction-user',
          content: [{ type: 'text', text: 'Render a comprehensive Markdown fixture.' }],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'interaction-assistant',
          content: [{ type: 'text', text: markdown }],
        },
      ],
    });
    const terminalSection = page.getByRole('heading', { name: `Rich Markdown section ${INTERACTION_SECTIONS}` });
    await expect(terminalSection).toBeAttached({ timeout: 30_000 });
    await expect(page.locator('.clawx-streamdown [data-streamdown="code-block-body"] pre').first()).toBeAttached({ timeout: 30_000 });
    await waitForPaint(page);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1_000 });
    await startMainCpuProfile(app);
    await cdp.send('Profiler.start');
    const beforeMetrics = metricMap((await cdp.send('Performance.getMetrics')).metrics as PerformanceMetric[]);

    const sidebar = page.getByTestId('sidebar');
    await startFrameSampling(page, 500);
    await page.getByTestId('sidebar-collapse-toggle').click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBe(68);
    await page.waitForTimeout(550);
    const sidebarCollapseFrames = await readFramePacing(page);

    await startFrameSampling(page, 500);
    await page.getByTestId('sidebar-collapse-toggle').click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    await page.waitForTimeout(550);
    const sidebarExpandFrames = await readFramePacing(page);
    const scrollContainer = page.getByTestId('chat-scroll-container');
    const scrollStart = await scrollContainer.evaluate((element) => {
      element.scrollTop = 0;
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });
    expect(scrollStart.scrollHeight).toBeGreaterThan(scrollStart.clientHeight);
    const scrollBox = await scrollContainer.boundingBox();
    if (!scrollBox) throw new Error('Rich Markdown scroll container has no layout box');

    await startFrameSampling(page, 1_600);
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    for (let index = 0; index < INTERACTION_SCROLL_STEPS; index += 1) {
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(650);
    const scrollFrames = await readFramePacing(page);
    const scrollEnd = await scrollContainer.evaluate((element) => element.scrollTop);

    const rendererProfile = (await cdp.send('Profiler.stop')).profile;
    const mainProfile = await stopMainCpuProfile(app);
    const afterMetrics = metricMap((await cdp.send('Performance.getMetrics')).metrics as PerformanceMetric[]);
    const gpu = await app.evaluate(async ({ app: electronApp }) => ({
      hardwareAccelerationEnabled: electronApp.isHardwareAccelerationEnabled(),
      gpuCompositing: electronApp.getGPUFeatureStatus().gpu_compositing,
      rasterization: electronApp.getGPUFeatureStatus().rasterization,
    }));
    const dom = await page.evaluate(() => ({
      nodes: document.getElementsByTagName('*').length,
      markdownNodes: document.querySelectorAll('.clawx-streamdown *').length,
    }));
    await cdp.detach();

    const benchmark = {
      schemaVersion: 1,
      workload: {
        markdownCharacters: markdown.length,
        markdownSections: INTERACTION_SECTIONS,
        scrollSteps: INTERACTION_SCROLL_STEPS,
      },
      gpu,
      dom,
      sidebarCollapseFrames,
      sidebarExpandFrames,
      scrollFrames,
      scrollDistance: scrollEnd - scrollStart.scrollTop,
      renderer: {
        taskDurationMs: metricDelta(beforeMetrics, afterMetrics, 'TaskDuration')! * 1_000,
        scriptDurationMs: metricDelta(beforeMetrics, afterMetrics, 'ScriptDuration')! * 1_000,
        layoutDurationMs: metricDelta(beforeMetrics, afterMetrics, 'LayoutDuration')! * 1_000,
        recalcStyleDurationMs: metricDelta(beforeMetrics, afterMetrics, 'RecalcStyleDuration')! * 1_000,
      },
    };

    await Promise.all([
      writeArtifact(testInfo, 'renderer-interaction-benchmark.json', benchmark),
      writeArtifact(testInfo, 'renderer-interaction.cpuprofile', rendererProfile),
      writeArtifact(testInfo, 'main-interaction.cpuprofile', mainProfile),
    ]);
    console.log(`ClawX interaction performance: ${JSON.stringify(benchmark)}`);

    expect(markdown.length).toBeGreaterThan(10_000);
    expect(sidebarCollapseFrames.count).toBeGreaterThan(0);
    expect(sidebarExpandFrames.count).toBeGreaterThan(0);
    expect(scrollFrames.count).toBeGreaterThan(0);
    expect(scrollEnd - scrollStart.scrollTop).toBeGreaterThan(1_000);
  } finally {
    await closeElectronApp(app);
  }
});
