import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the WhatsApp login cancel cleanup logic.
 *
 * WhatsAppLoginManager uses createRequire() at module top level to load
 * Baileys and QR code libraries, making it impractical to import directly
 * in a test environment. Instead, we:
 *
 * 1. Test cleanupWhatsAppLoginCredentials() — a standalone function that
 *    mirrors the cleanup logic in WhatsAppLoginManager.stop()
 * 2. Test listConfiguredChannels() to verify the end-to-end behavior:
 *    that WhatsApp only appears as "configured" when a valid credential
 *    directory exists, and does NOT appear after cleanup.
 */

const { testHome, testUserData, mockLoggerWarn, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-whatsapp-login-${suffix}`,
    testUserData: `/tmp/clawx-whatsapp-login-user-data-${suffix}`,
    mockLoggerWarn: vi.fn(),
    mockLoggerInfo: vi.fn(),
    mockLoggerError: vi.fn(),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp',
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: mockLoggerWarn,
  info: mockLoggerInfo,
  error: mockLoggerError,
}));

/**
 * Standalone implementation of the cleanup logic from WhatsAppLoginManager.stop().
 * This mirrors the exact logic added in the fix, enabling us to unit-test it
 * without importing the full WhatsAppLoginManager (which has heavy Baileys deps).
 *
 * Uses testHome directly since vi.mock('os') only affects ESM imports, not
 * CommonJS require('os') calls.
 */
function cleanupWhatsAppLoginCredentials(accountId: string): void {
  const authDir = join(testHome, '.openclaw', 'credentials', 'whatsapp', accountId);
  if (existsSync(authDir)) {
    rmSync(authDir, { recursive: true, force: true });
    const parentDir = join(testHome, '.openclaw', 'credentials', 'whatsapp');
    if (existsSync(parentDir)) {
      const remaining = readdirSync(parentDir);
      if (remaining.length === 0) {
        rmSync(parentDir, { recursive: true, force: true });
      }
    }
  }
}

describe('WhatsApp login cancel cleanup logic', () => {
  const whatsappCredsDir = () => join(testHome, '.openclaw', 'credentials', 'whatsapp');
  const accountAuthDir = (accountId: string) => join(whatsappCredsDir(), accountId);

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes credentials directory and empty parent on cleanup', () => {
    const authDir = accountAuthDir('default');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, 'creds.json'), '{}', 'utf8');
    expect(existsSync(authDir)).toBe(true);

    cleanupWhatsAppLoginCredentials('default');

    expect(existsSync(authDir)).toBe(false);
    expect(existsSync(whatsappCredsDir())).toBe(false);
  });

  it('does not remove other accounts when cleaning up one account', () => {
    // Pre-existing account
    const existingDir = accountAuthDir('existing-account');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'creds.json'), '{"valid": true}', 'utf8');

    // New account to be cancelled
    const newDir = accountAuthDir('new-account');
    mkdirSync(newDir, { recursive: true });

    cleanupWhatsAppLoginCredentials('new-account');

    expect(existsSync(newDir)).toBe(false);
    expect(existsSync(existingDir)).toBe(true);
    expect(existsSync(whatsappCredsDir())).toBe(true);

    const remaining = readdirSync(whatsappCredsDir());
    expect(remaining).toEqual(['existing-account']);
  });

  it('handles missing auth dir gracefully', () => {
    // Should not throw when directory doesn't exist
    expect(() => cleanupWhatsAppLoginCredentials('nonexistent')).not.toThrow();
  });
});

describe('listConfiguredChannels WhatsApp detection', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('reports WhatsApp as configured when credentials directory has a session', async () => {
    const authDir = join(testHome, '.openclaw', 'credentials', 'whatsapp', 'default');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, 'creds.json'), '{}', 'utf8');

    const { listConfiguredChannels } = await import('@electron/utils/channel-config');
    const channels = await listConfiguredChannels();

    expect(channels).toContain('whatsapp');
  });

  it('does NOT report WhatsApp as configured when credentials directory is empty', async () => {
    // Create parent dir but no account subdirectories
    const whatsappDir = join(testHome, '.openclaw', 'credentials', 'whatsapp');
    mkdirSync(whatsappDir, { recursive: true });

    const { listConfiguredChannels } = await import('@electron/utils/channel-config');
    const channels = await listConfiguredChannels();

    expect(channels).not.toContain('whatsapp');
  });

  it('does NOT report WhatsApp as configured when credentials directory does not exist', async () => {
    // Ensure the openclaw dir exists but no whatsapp credentials
    mkdirSync(join(testHome, '.openclaw'), { recursive: true });

    const { listConfiguredChannels } = await import('@electron/utils/channel-config');
    const channels = await listConfiguredChannels();

    expect(channels).not.toContain('whatsapp');
  });

  it('does NOT report WhatsApp after cleanup removes the credentials directory', async () => {
    // Simulate start(): create the auth dir
    const authDir = join(testHome, '.openclaw', 'credentials', 'whatsapp', 'default');
    mkdirSync(authDir, { recursive: true });

    const { listConfiguredChannels } = await import('@electron/utils/channel-config');

    // Before cleanup: WhatsApp should be reported
    const channelsBefore = await listConfiguredChannels();
    expect(channelsBefore).toContain('whatsapp');

    // Simulate cancel: cleanup removes the directory
    cleanupWhatsAppLoginCredentials('default');

    // After cleanup: WhatsApp should NOT be reported
    const channelsAfter = await listConfiguredChannels();
    expect(channelsAfter).not.toContain('whatsapp');
  });
});

