import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { patchNsisInstallSectionTemplate } from '../../scripts/patch-nsis-install-section.mjs';

const SAMPLE_INSTALL_SECTION = `!ifdef ONE_CLICK
  !insertmacro CHECK_APP_RUNNING
!else
  \${ifNot} \${UAC_IsInnerInstance}
    !insertmacro CHECK_APP_RUNNING
  \${endif}
!endif

!insertmacro installApplicationFiles
`;

describe('patchNsisInstallSectionTemplate', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('runs CHECK_APP_RUNNING for assisted UAC inner installs', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-install-section-'));
    const target = join(tempDir, 'installSection.nsh');
    writeFileSync(target, SAMPLE_INSTALL_SECTION, 'utf8');

    expect(patchNsisInstallSectionTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('ClawX-patched-v2: run app-running guard in assisted UAC inner instance');
    expect(result).toContain('!insertmacro CHECK_APP_RUNNING');
    expect(result).not.toContain('${ifNot} ${UAC_IsInnerInstance}\n    !insertmacro CHECK_APP_RUNNING');
    expect(patchNsisInstallSectionTemplate(target)).toBe(true);
  });
});
