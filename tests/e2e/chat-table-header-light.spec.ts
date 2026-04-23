import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const tableMarkdown = [
  '| 账号 | 内容 | 热度 |',
  '|------|------|------|',
  '| @OpenAI | ChatGPT 推出 Workspace Agents（共享智能体），可跨团队处理复杂工作流 | 15K 2.2K转 4.4M浏览 |',
  '| @oran_ge | GPT Images 2 限时免费一周，每人100张，Labnana平台 | 68 |',
  '| @caiyue5 | X平台能自动识别"由AI生成"的图片，GPT Images 2引发讨论 | 74 |',
  '| @fkysly | "GPT Image2团队全是华人？" 引发热议 | 482 |',
  '| @binghe | 分析Claude封号的可能原因 | 620 |',
  '| @turingou | "GPT Images 2水平完全可以替代Claude design" | 187 |',
  '| @DashHuang | "OpenAI也开始KYC了" 截图引发讨论 | — |',
].join('\n');

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: '请汇总今日 X 上的 AI 新闻。' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '好，全部都查完了，给你汇总一下 👇',
        '',
        '🐦 **X（Twitter）关注列表 AI 新闻**',
        '',
        '点击 **Following（关注）** 标签后，过滤掉了推荐内容，看到了你关注账号的真实动态：',
        '',
        '🔥 **热门 AI 推文**',
        '',
        tableMarkdown,
        '',
        '**主要趋势：** X上今日AI圈最热的三个话题是 ① GPT Images 2 / GPT Image2 ② Claude账号被封 ③ OpenAI Workspace Agents',
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat table header styling', () => {
  test('renders markdown table headers with transparent background and bold text in light theme', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });

      const header = page.locator('.prose table thead th').first();
      await expect(header).toBeVisible({ timeout: 30_000 });

      const headerStyles = await header.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return { backgroundColor: style.backgroundColor, fontWeight: style.fontWeight };
      });

      expect(headerStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(Number(headerStyles.fontWeight)).toBeGreaterThanOrEqual(700);

      const tableEl = page.locator('.prose table').first();
      await tableEl.scrollIntoViewIfNeeded();
      await tableEl.screenshot({ path: '/opt/cursor/artifacts/chat_table_header_light.png' });
    } finally {
      await closeElectronApp(app);
    }
  });
});
