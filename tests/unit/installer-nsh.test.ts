import { readFileSync } from 'node:fs';

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const installerNsh = readFileSync(join(process.cwd(), 'scripts/installer.nsh'), 'utf8');

describe('installer.nsh running-app guard', () => {
  it('fails closed when ClawX.exe remains alive during overwrite install', () => {
    const guardStart = installerNsh.indexOf('Do not continue while the old UI process is still alive');
    const guardEnd = installerNsh.indexOf('!ifndef BUILD_UNINSTALLER', guardStart);
    const guard = installerNsh.slice(guardStart, guardEnd);

    expect(guardStart).toBeGreaterThan(-1);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(guard).toContain('Get-CimInstance -ClassName Win32_Process');
    expect(guard).toContain('tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}"');
    expect(guard).toContain('taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"');
    expect(guard).toContain('wmic process where "name=\'${APP_EXECUTABLE_FILENAME}\'" call terminate');
    expect(guard).toContain('SetErrorLevel 2');
    expect(guard).toContain('Quit');
    expect(guard).toContain('ClawX is still running and cannot be replaced safely');
    expect(guard).not.toContain('${nsProcess::FindProcess}');
  });
});
