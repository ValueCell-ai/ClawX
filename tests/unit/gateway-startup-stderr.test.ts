import { describe, expect, it } from 'vitest';
import {
  classifyGatewayStderrMessage,
  detectGatewayStartupDiagnostic,
  recordGatewayStartupStderrLine,
} from '@electron/gateway/startup-stderr';

describe('classifyGatewayStderrMessage', () => {
  it('drops empty and token-mismatch noise', () => {
    expect(classifyGatewayStderrMessage('').level).toBe('drop');
    expect(
      classifyGatewayStderrMessage('openclaw-control-ui something token_mismatch').level,
    ).toBe('drop');
  });

  it('downgrades common deprecation warnings to debug', () => {
    expect(classifyGatewayStderrMessage('(node:1234) DeprecationWarning: foo').level).toBe(
      'debug',
    );
    expect(classifyGatewayStderrMessage('Some ExperimentalWarning line').level).toBe('debug');
  });

  it('treats unrecognized lines as warnings', () => {
    expect(classifyGatewayStderrMessage('something unexpected happened').level).toBe('warn');
  });
});

describe('recordGatewayStartupStderrLine', () => {
  it('skips empty lines and caps buffer length', () => {
    const lines: string[] = [];
    recordGatewayStartupStderrLine(lines, '   ');
    expect(lines).toEqual([]);

    for (let i = 0; i < 150; i += 1) {
      recordGatewayStartupStderrLine(lines, `line-${i}`);
    }
    expect(lines.length).toBe(120);
    expect(lines[0]).toBe('line-30');
    expect(lines[lines.length - 1]).toBe('line-149');
  });
});

describe('detectGatewayStartupDiagnostic', () => {
  const ISSUE_884_LINE =
    '2026-04-21T15:57:00.111+08:00 [plugins] embedded acpx runtime backend probe failed: '
    + 'embedded ACP runtime probe failed '
    + '(agent=codex; command=npx @zed-industries/codex-acp@^0.11.1; '
    + 'cwd=C:\\Users\\xxx\\.openclaw\\workspace; '
    + 'ACP agent exited before initialize completed '
    + '(exit=3221225781, signal=null))';

  it('detects the issue #884 probe failure as ACPX_VC_REDIST_MISSING', () => {
    const diagnostic = detectGatewayStartupDiagnostic(ISSUE_884_LINE);
    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.code).toBe('ACPX_VC_REDIST_MISSING');
    expect(diagnostic?.rawLine).toContain('embedded acpx runtime backend probe failed');
  });

  it('also accepts the hex form of exit code 0xC0000135', () => {
    const hexLine = ISSUE_884_LINE.replace('exit=3221225781', 'exit=0xc0000135');
    expect(detectGatewayStartupDiagnostic(hexLine)?.code).toBe('ACPX_VC_REDIST_MISSING');
  });

  it('accepts the signed-int form -1073741515', () => {
    const signedLine = ISSUE_884_LINE.replace('exit=3221225781', 'exit=-1073741515');
    expect(detectGatewayStartupDiagnostic(signedLine)?.code).toBe('ACPX_VC_REDIST_MISSING');
  });

  it('returns null for probe failures unrelated to the DLL error', () => {
    const otherFailure = ISSUE_884_LINE.replace('exit=3221225781', 'exit=1');
    expect(detectGatewayStartupDiagnostic(otherFailure)).toBeNull();
  });

  it('returns null for unrelated stderr lines', () => {
    expect(detectGatewayStartupDiagnostic('')).toBeNull();
    expect(
      detectGatewayStartupDiagnostic('[plugins] some other plugin failed to start (exit=1)'),
    ).toBeNull();
    // The DLL exit code alone, without acpx/codex context, is not enough to
    // assert the diagnostic — other binaries can fail with the same code.
    expect(
      detectGatewayStartupDiagnostic(
        '[plugins] unrelated plugin crashed (exit=3221225781)',
      ),
    ).toBeNull();
  });

  it('matches when probe failure is reported with agent=codex even without the npm name', () => {
    const withoutNpmName = ISSUE_884_LINE.replace(
      'command=npx @zed-industries/codex-acp@^0.11.1; ',
      'command=/path/to/codex; ',
    );
    expect(detectGatewayStartupDiagnostic(withoutNpmName)?.code).toBe(
      'ACPX_VC_REDIST_MISSING',
    );
  });
});
