import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDevelopmentProfile } from '@electron/utils/development-profile';
import { expandPath, getClawXConfigDir, getOpenClawConfigDir, resolveOpenClawConfigPath } from '@electron/utils/paths';

const root = join(homedir(), '.clawx-dev', 'unit-legacy');
function env() {
  return { CLAWX_DEV_PROFILE: 'legacy', CLAWX_DEV_PROFILE_ROOT: root,
    OPENCLAW_STATE_DIR: join(root, 'openclaw'), OPENCLAW_CONFIG_PATH: join(root, 'openclaw/openclaw.json'),
    CLAWX_CONFIG_DIR: join(root, 'clawx'), CLAWX_USER_DATA_DIR: join(root, 'clawx'), CLAWX_PORT_OPENCLAW_GATEWAY: '19789' };
}
afterEach(() => vi.unstubAllEnvs());

describe('development runtime paths', () => {
  it('leaves default launches unchanged', () => {
    expect(getDevelopmentProfile({})).toBeNull();
    expect(getOpenClawConfigDir()).toBe(join(homedir(), '.openclaw'));
  });
  it('keeps all managed roots and the default-workspace alias inside the profile', () => {
    for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value);
    expect(getDevelopmentProfile()?.gatewayPort).toBe(19789);
    expect(getOpenClawConfigDir()).toBe(join(root, 'openclaw'));
    expect(getClawXConfigDir()).toBe(join(root, 'clawx'));
    expect(resolveOpenClawConfigPath()).toBe(join(root, 'openclaw/openclaw.json'));
    expect(expandPath('~/.openclaw/workspace')).toBe(join(root, 'openclaw/workspace'));
  });
  it('supports the existing OpenClaw state override without a development profile', () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'custom-state'));
    expect(getOpenClawConfigDir()).toBe(join(root, 'custom-state'));
  });
  it.each(['OPENCLAW_STATE_DIR', 'OPENCLAW_CONFIG_PATH', 'CLAWX_CONFIG_DIR', 'CLAWX_USER_DATA_DIR'])('refuses an incomplete or redirected %s', key => {
    expect(() => getDevelopmentProfile({ ...env(), [key]: '' })).toThrow();
    expect(() => getDevelopmentProfile({ ...env(), [key]: join(homedir(), '.openclaw') })).toThrow();
  });
  it('refuses shared roots, unknown profiles and the default port', () => {
    expect(() => getDevelopmentProfile({ ...env(), CLAWX_DEV_PROFILE_ROOT: join(homedir(), '.openclaw/dev') })).toThrow();
    expect(() => getDevelopmentProfile({ ...env(), CLAWX_DEV_PROFILE: 'unknown' })).toThrow();
    expect(() => getDevelopmentProfile({ ...env(), CLAWX_PORT_OPENCLAW_GATEWAY: '18789' })).toThrow();
  });
});
