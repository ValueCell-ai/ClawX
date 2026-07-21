import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  closeElectronApp,
  expect,
  getRecordedLegacyIpcInvocations,
  getStableWindow,
  installAttachmentHostFixture,
  test,
  type AttachmentHostFixture,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const OFFICE_FIXTURE_DIR = resolve(process.cwd(), 'tests/e2e/fixtures/office');

type CanvasFingerprint = {
  clientHeight: number;
  clientWidth: number;
  digest: string;
  height: number;
  opaquePixels: number;
  width: number;
};

type CanvasBackingSize = Pick<CanvasFingerprint, 'height' | 'width'>;

async function fixtureBytes(name: 'sample.docx' | 'slides-a.pptx' | 'slides-b.pptx'): Promise<Uint8Array> {
  return await readFile(resolve(OFFICE_FIXTURE_DIR, name));
}

function fileActivityUpdates(): Array<Record<string, unknown> & { sessionUpdate: string }> {
  return [
    {
      sessionUpdate: 'user_message',
      messageId: 'office-user',
      content: [{ type: 'text', text: 'Create the independent presentation.' }],
    },
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'office-write',
      title: 'Write: slides-b.pptx',
      status: 'in_progress',
      rawInput: { path: 'slides-b.pptx', content: 'Deterministic binary fixture' },
      content: [{ type: 'content', content: { type: 'text', text: 'Writing slides-b.pptx' } }],
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'office-write',
      title: 'Write: slides-b.pptx',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'Write complete' } }],
    },
  ];
}

async function openChat(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

async function seedOfficeFiles(fixture: AttachmentHostFixture) {
  const [docxPath, deckAPath, deckBPath] = await Promise.all([
    fixture.createWorkspaceFile('sample.docx', await fixtureBytes('sample.docx')),
    fixture.createWorkspaceFile('slides-a.pptx', await fixtureBytes('slides-a.pptx')),
    fixture.createWorkspaceFile('slides-b.pptx', await fixtureBytes('slides-b.pptx')),
  ]);
  return { docxPath, deckAPath, deckBPath };
}

async function canvasFingerprint(canvas: Locator): Promise<CanvasFingerprint> {
  return await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext('2d');
    if (!context) throw new Error('PPTX canvas has no 2D context');
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let hash = 0x811c9dc5;
    let opaquePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      hash ^= pixels[index]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= pixels[index + 1]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= pixels[index + 2]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= pixels[index + 3]!;
      hash = Math.imul(hash, 0x01000193);
      if (pixels[index + 3] !== 0) opaquePixels += 1;
    }
    return {
      clientHeight: target.clientHeight,
      clientWidth: target.clientWidth,
      digest: (hash >>> 0).toString(16).padStart(8, '0'),
      height: target.height,
      opaquePixels,
      width: target.width,
    };
  });
}

async function waitForStableCanvas(canvas: Locator): Promise<CanvasFingerprint> {
  await expect(canvas).toBeVisible();
  let previous: CanvasFingerprint | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await canvasFingerprint(canvas);
    if (
      current.width > 0
      && current.height > 0
      && current.clientWidth > 0
      && current.clientHeight > 0
      && current.opaquePixels > 0
      && previous?.digest === current.digest
      && previous.width === current.width
      && previous.height === current.height
    ) {
      return current;
    }
    previous = current;
    await canvas.page().waitForTimeout(150);
  }
  throw new Error(`PPTX canvas did not stabilize: ${JSON.stringify(previous)}`);
}

async function waitForChangedStableCanvasBacking(
  canvas: Locator,
  before: CanvasBackingSize,
): Promise<CanvasBackingSize> {
  let changedCandidate: CanvasBackingSize | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      return { width: target.width, height: target.height };
    });
    const changed = current.width !== before.width || current.height !== before.height;
    if (
      changed
      && changedCandidate?.width === current.width
      && changedCandidate.height === current.height
    ) {
      return current;
    }
    changedCandidate = changed ? current : null;
    await canvas.page().waitForTimeout(150);
  }
  throw new Error(`PPTX canvas backing size did not change and stabilize from ${JSON.stringify(before)}`);
}

async function assertSinglePptxViewer(page: Page): Promise<void> {
  await expect(page.getByTestId('pptx-viewer')).toHaveCount(1);
  expect(await page.evaluate(() => (
    (window as typeof window & { __officePptxMaxMounted?: number }).__officePptxMaxMounted ?? 0
  ))).toBeLessThanOrEqual(1);
}

test.describe('real Office document previews', () => {
  test('renders DOCX and isolated PPTX decks through real Electron Host APIs', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Office preview session' }],
      });
      const paths = await seedOfficeFiles(fixture);
      await fixture.setSessionReplay(MAIN_SESSION_KEY, fileActivityUpdates());
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      await page.evaluate(() => {
        const trackedWindow = window as typeof window & {
          __officePptxChartCompletions?: number;
          __officePptxMaxMounted?: number;
        };
        const updateCount = () => {
          trackedWindow.__officePptxMaxMounted = Math.max(
            trackedWindow.__officePptxMaxMounted ?? 0,
            document.querySelectorAll('[data-testid="pptx-viewer"]').length,
          );
        };
        updateCount();
        new MutationObserver(updateCount).observe(document.body, { childList: true, subtree: true });
        trackedWindow.__officePptxChartCompletions = 0;
        window.addEventListener('chartRenderingComplete', () => {
          trackedWindow.__officePptxChartCompletions = (trackedWindow.__officePptxChartCompletions ?? 0) + 1;
        });
      });

      await page.getByTestId('chat-toolbar-workspace').click();
      const panel = page.getByTestId('artifact-panel');
      const workspaceTree = panel.getByTestId('workspace-tree');
      await expect(workspaceTree).toBeVisible();

      await workspaceTree.getByTitle('sample.docx', { exact: true }).click();
      const docxHost = panel.getByTestId('docx-preview-host');
      await expect(docxHost).toBeVisible();
      await expect.poll(async () => docxHost.evaluate((host) => {
        const root = host.shadowRoot;
        return {
          pageCount: root?.querySelectorAll('section.clawx-docx').length ?? 0,
          tableCount: root?.querySelectorAll('table').length ?? 0,
          text: root?.textContent ?? '',
        };
      })).toMatchObject({ pageCount: 2, tableCount: 1 });
      const renderedDocxText = await docxHost.evaluate((host) => host.shadowRoot?.textContent ?? '');
      expect(renderedDocxText).toContain('ClawX Office Preview Header');
      expect(renderedDocxText).toContain('Quarterly Office Preview');
      expect(renderedDocxText).toContain('This deterministic document verifies real DOCX rendering in Electron.');
      expect(renderedDocxText).toContain('North');
      expect(renderedDocxText).toContain('Ready');
      expect(renderedDocxText).toContain('Second Preview Page');
      expect(renderedDocxText).toContain('ClawX Office Preview Footer');

      await workspaceTree.getByTitle('slides-a.pptx', { exact: true }).click();
      const canvas = page.getByTestId('pptx-canvas');
      const previous = page.getByRole('button', { name: 'Previous slide' });
      const next = page.getByRole('button', { name: 'Next slide' });
      await expect(panel.getByText('1 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      await assertSinglePptxViewer(page);
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      const deckAFirst = await waitForStableCanvas(canvas);

      await next.click();
      await expect(panel.getByText('2 / 2', { exact: true })).toBeVisible();
      await expect(previous).toBeEnabled();
      await expect(next).toBeDisabled();
      const deckASecond = await waitForStableCanvas(canvas);
      expect(deckASecond.digest).not.toBe(deckAFirst.digest);
      await expect.poll(async () => page.evaluate(() => (
        (window as typeof window & { __officePptxChartCompletions?: number })
          .__officePptxChartCompletions ?? 0
      ))).toBeGreaterThan(0);

      await previous.click();
      await expect(panel.getByText('1 / 2', { exact: true })).toBeVisible();
      expect((await waitForStableCanvas(canvas)).digest).toBe(deckAFirst.digest);
      await next.click();
      await expect(panel.getByText('2 / 2', { exact: true })).toBeVisible();
      expect((await waitForStableCanvas(canvas)).digest).toBe(deckASecond.digest);

      const deckBActivity = page.getByTestId('acp-file-button').filter({ hasText: 'slides-b.pptx' });
      await expect(deckBActivity).toHaveAccessibleName('Created slides-b.pptx');
      await deckBActivity.click();
      await expect(panel.getByTestId('artifact-panel-tab-preview')).toHaveAttribute('class', /bg-foreground\/10/);
      await expect(panel.getByText('1 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      await assertSinglePptxViewer(page);
      const deckBFirst = await waitForStableCanvas(canvas);
      expect(deckBFirst.digest).not.toBe(deckAFirst.digest);
      expect(deckBFirst.digest).not.toBe(deckASecond.digest);

      await panel.getByTestId('artifact-panel-tab-browser').click();
      await expect(panel.getByText('2 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      await assertSinglePptxViewer(page);
      expect((await waitForStableCanvas(canvas)).digest).toBe(deckASecond.digest);

      await panel.getByTestId('artifact-panel-tab-preview').click();
      await expect(panel.getByText('1 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      await assertSinglePptxViewer(page);
      expect((await waitForStableCanvas(canvas)).digest).toBe(deckBFirst.digest);

      await next.click();
      await expect(panel.getByText('2 / 2', { exact: true })).toBeVisible();
      const deckBSecond = await waitForStableCanvas(canvas);
      expect(deckBSecond.digest).not.toBe(deckBFirst.digest);
      await panel.getByTestId('artifact-panel-tab-browser').click();
      await expect(panel.getByText('2 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      await assertSinglePptxViewer(page);
      await panel.getByTestId('artifact-panel-tab-preview').click();
      await expect(panel.getByText('2 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      await assertSinglePptxViewer(page);
      expect((await waitForStableCanvas(canvas)).digest).toBe(deckBSecond.digest);

      const beforeResize = await canvasFingerprint(canvas);
      const beforeResizeBacking = { width: beforeResize.width, height: beforeResize.height };
      const divider = page.getByRole('separator', { name: 'Drag to resize width' });
      const [dividerBounds, panelBounds] = await Promise.all([
        divider.boundingBox(),
        page.getByTestId('artifact-panel-aside').boundingBox(),
      ]);
      if (!dividerBounds || !panelBounds) throw new Error('Artifact panel resize controls have no bounds');
      await page.mouse.move(dividerBounds.x + dividerBounds.width / 2, dividerBounds.y + dividerBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(panelBounds.x + panelBounds.width - 2, dividerBounds.y + dividerBounds.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => {
        const aside = await page.getByTestId('artifact-panel-aside').boundingBox();
        return aside?.width ?? Number.POSITIVE_INFINITY;
      }).toBeLessThan(panelBounds.width - 50);
      const afterResizeBacking = await waitForChangedStableCanvasBacking(canvas, beforeResizeBacking);
      expect(afterResizeBacking).not.toEqual(beforeResizeBacking);
      const panelWidthPct = await divider.evaluate((element) => {
        const containerWidth = element.parentElement?.getBoundingClientRect().width ?? 0;
        const aside = element.nextElementSibling?.getBoundingClientRect();
        return containerWidth > 0 && aside ? (aside.width / containerWidth) * 100 : 0;
      });
      expect(panelWidthPct).toBeGreaterThanOrEqual(27.5);
      expect(panelWidthPct).toBeLessThanOrEqual(28.5);
      await assertSinglePptxViewer(page);

      const hostCalls = await fixture.getHostInvocations();
      expect(hostCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          module: 'files',
          action: 'readBinary',
          payload: expect.objectContaining({ path: paths.docxPath }),
        }),
        expect.objectContaining({
          module: 'files',
          action: 'readBinary',
          payload: expect.objectContaining({ path: paths.deckAPath }),
        }),
        expect.objectContaining({
          module: 'files',
          action: 'readWorkspaceBinary',
          payload: expect.objectContaining({
            workspaceRoot: fixture.workspaceDir,
            relativePath: 'slides-b.pptx',
          }),
        }),
      ]));
      expect(hostCalls.some((call) => (
        call.module === 'files'
        && call.action === 'readBinary'
        && call.payload?.path === paths.deckBPath
      ))).toBe(false);
      expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
      expect(await page.evaluate(() => (
        (window as typeof window & { __officePptxMaxMounted?: number }).__officePptxMaxMounted ?? 0
      ))).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
