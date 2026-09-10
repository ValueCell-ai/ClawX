// @vitest-environment node
import { createWeComCliTool } from '../../node_modules/@wecom/wecom-openclaw-plugin/dist/src/cli/tool.js';
import { setWeComRuntime } from '../../node_modules/@wecom/wecom-openclaw-plugin/dist/src/runtime.js';
import { describe, expect, it } from 'vitest';

interface WeComAccountConfig {
  botId?: string;
  secret?: string;
}

function useWeComConfig(accounts: Record<string, WeComAccountConfig>, defaultAccount = 'default'): void {
  setWeComRuntime({
    config: {
      loadConfig: () => ({
        channels: {
          wecom: {
            enabled: true,
            defaultAccount,
            accounts,
          },
        },
      }),
    },
  } as never);
}

async function executeWithoutCredentials(accountId?: string): Promise<string> {
  const result = await createWeComCliTool({ accountId }).execute('test-call', {
    args: ['calendar', '--help'],
  });
  return (result.details as { error?: string }).error ?? '';
}

describe('WeCom desktop account fallback', () => {
  it('uses the sole configured account when desktop chat has no account context', async () => {
    useWeComConfig({ default: {} });

    const error = await executeWithoutCredentials();

    expect(error).toContain('企业微信账号 "default" 未配置 botId / secret');
    expect(error).not.toContain('当前会话缺少账号上下文');
  });

  it('rejects an account-less desktop chat when multiple accounts are configured', async () => {
    useWeComConfig({ default: {}, support: {} });

    const error = await executeWithoutCredentials();

    expect(error).toContain('当前会话缺少账号上下文');
    expect(error).toContain('存在多个企业微信账号');
  });

  it('honors an explicit account context when multiple accounts are configured', async () => {
    useWeComConfig({ default: {}, support: {} });

    const error = await executeWithoutCredentials('support');

    expect(error).toContain('企业微信账号 "support" 未配置 botId / secret');
    expect(error).not.toContain('当前会话缺少账号上下文');
  });
});
