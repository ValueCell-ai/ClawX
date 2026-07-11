import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const accountId = 'openai-oauth';
const codexAccountId = 'acct_local_e2e';
const accessToken = 'local-oauth-access-e2e';
const refreshToken = 'local-oauth-refresh-e2e';
const idToken = 'local-oauth-id-e2e';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type CodexOAuthStatus = {
  success: boolean;
  managedCodexHome: string;
  authPath: string;
  managed: {
    path: string;
    exists: boolean;
    complete: boolean;
    accountId?: string;
  };
  user: {
    path: string;
    exists: boolean;
    complete: boolean;
    accountId?: string;
  };
  provider?: {
    accountId: string;
    vendorId: string;
    authMode?: string;
    hasOAuthSecret: boolean;
    managedMatchesAccount?: boolean;
    userMatchesAccount?: boolean;
  };
};

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toBeTruthy();
}

function expectNoTokenLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(accessToken);
  expect(serialized).not.toContain(refreshToken);
  expect(serialized).not.toContain(idToken);
}

async function invokeProviderAction<T>(
  page: Awaited<ReturnType<typeof getStableWindow>>,
  action: string,
  payload?: Record<string, unknown>,
): Promise<HostResponse<T>> {
  return await page.evaluate(async ({ actionName, actionPayload }) => {
    return await window.clawx.hostInvoke({
      id: `codex-oauth-${actionName}`,
      module: 'providers',
      action: actionName,
      payload: actionPayload,
    });
  }, { actionName: action, actionPayload: payload });
}

test.describe('cc-connect Codex OAuth Host API lifecycle', () => {
  test('imports, reports, and logs out managed Codex OAuth without leaking tokens', async ({
    homeDir,
    launchElectronApp,
    userDataDir,
  }) => {
    const createdAt = '2026-06-07T00:00:00.000Z';
    const userCodexDir = join(homeDir, '.codex');
    const userCodexAuthPath = join(userCodexDir, 'auth.json');
    await mkdir(userCodexDir, { recursive: true });
    await writeFile(userCodexAuthPath, JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: codexAccountId,
      },
      last_refresh: createdAt,
    }, null, 2), 'utf8');

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        [accountId]: {
          id: accountId,
          vendorId: 'openai',
          label: 'OpenAI Codex OAuth',
          authMode: 'oauth_browser',
          model: 'gpt-5.5',
          enabled: true,
          isDefault: true,
          metadata: {
            email: 'codex-oauth-e2e@example.invalid',
            resourceUrl: 'openai-codex',
          },
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {
        [accountId]: {
          type: 'oauth',
          accountId,
          accessToken,
          refreshToken,
          idToken,
          expiresAt: 1_820_000_000_000,
          email: 'codex-oauth-e2e@example.invalid',
          subject: codexAccountId,
        },
      },
      apiKeys: {},
      defaultProviderAccountId: accountId,
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_E2E_USER_CODEX_AUTH_JSON: userCodexAuthPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const beforeImport = await invokeProviderAction<CodexOAuthStatus>(page, 'codexOAuthStatus', { accountId });
      expect(beforeImport).toMatchObject({
        ok: true,
        data: {
          success: true,
          managed: { exists: false, complete: false },
          user: { exists: true, complete: true, accountId: codexAccountId },
          provider: {
            accountId,
            vendorId: 'openai',
            authMode: 'oauth_browser',
            hasOAuthSecret: true,
            userMatchesAccount: true,
          },
        },
      });
      expectNoTokenLeak(beforeImport);

      const imported = await invokeProviderAction<CodexOAuthStatus>(page, 'importCodexOAuth', { accountId });
      if (!imported.data?.success) {
        throw new Error(`Codex OAuth import failed: ${JSON.stringify(imported)}`);
      }
      expect(imported).toMatchObject({
        ok: true,
        data: {
          success: true,
          managed: {
            exists: true,
            complete: true,
            accountId: codexAccountId,
          },
          provider: {
            accountId,
            hasOAuthSecret: true,
            managedMatchesAccount: true,
          },
        },
      });
      expectNoTokenLeak(imported);

      const managedAuthPath = join(userDataDir, 'runtimes', 'cc-connect', 'codex-home', 'auth.json');
      const managedAuth = JSON.parse(await readFile(managedAuthPath, 'utf8')) as {
        tokens?: Record<string, string>;
      };
      expect(managedAuth.tokens).toMatchObject({
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: codexAccountId,
      });

      const publicProfilePath = join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json');
      const publicProfile = await readFile(publicProfilePath, 'utf8');
      expect(publicProfile).toContain('CODEX_HOME');
      expect(publicProfile).not.toContain(accessToken);
      expect(publicProfile).not.toContain(refreshToken);
      expect(publicProfile).not.toContain(idToken);

      const afterImportStatus = await invokeProviderAction<CodexOAuthStatus>(page, 'codexOAuthStatus', { accountId });
      expect(afterImportStatus).toMatchObject({
        ok: true,
        data: {
          managed: { exists: true, complete: true, accountId: codexAccountId },
          provider: { managedMatchesAccount: true },
        },
      });
      expectNoTokenLeak(afterImportStatus);

      const loggedOut = await invokeProviderAction<CodexOAuthStatus>(page, 'logoutCodexOAuth', { accountId });
      expect(loggedOut).toMatchObject({
        ok: true,
        data: {
          success: true,
          managed: { exists: false, complete: false },
          user: { exists: true, complete: true, accountId: codexAccountId },
          provider: {
            accountId,
            hasOAuthSecret: false,
            userMatchesAccount: true,
          },
        },
      });
      expectNoTokenLeak(loggedOut);
      await expectMissing(managedAuthPath);

      const providerStore = await readFile(join(userDataDir, 'clawx-providers.json'), 'utf8');
      expect(providerStore).not.toContain(accessToken);
      expect(providerStore).not.toContain(refreshToken);
      expect(providerStore).not.toContain(idToken);
      expect(providerStore).toContain(accountId);
    } finally {
      await closeElectronApp(app);
    }
  });
});
