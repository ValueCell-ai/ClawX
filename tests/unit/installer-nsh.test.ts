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

describe('installer.nsh directory existence checks', () => {
  it('never checks a directory with a trailing backslash, which FindFirstFile cannot match', () => {
    const checks = installerNsh
      .split('\n')
      .filter((line) => !line.trimStart().startsWith(';'))
      .flatMap((line) => [...line.matchAll(/IfFileExists\s+"([^"]*)"/g)].map((match) => match[1]));

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.filter((path) => path.endsWith('\\'))).toEqual([]);
  });

  it('moves the previous install directory out of the way before extracting', () => {
    expect(installerNsh).toContain('IfFileExists "$INSTDIR\\*.*" 0 _instdir_clean');
    expect(installerNsh).toContain('Rename "$INSTDIR" "$INSTDIR._stale_$R8"');
    expect(installerNsh).toContain('IfFileExists "$INSTDIR._stale_0\\*.*" 0 _ci_stale_cleaned');
  });
});
