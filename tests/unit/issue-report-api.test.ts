import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { exportIssueReport, redactDiagnosticText, redactOpenClawConfig } from '@electron/services/issue-report-api';

const temporaryDirectories: string[] = [];

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawx-issue-report-'));
  temporaryDirectories.push(root);
  const stateDir = join(root, 'state');
  const sessionsDir = join(stateDir, 'agents', 'main', 'sessions');
  const clawxLogDir = join(root, 'clawx-logs');
  const openClawLogDir = join(stateDir, 'logs');
  const outputDir = join(root, 'Desktop');
  const configPath = join(stateDir, 'openclaw.json');
  const transcriptPath = join(sessionsDir, 'conversation-1.jsonl');
  const secondTranscriptPath = join(sessionsDir, 'conversation-2.jsonl');
  await Promise.all([
    mkdir(sessionsDir, { recursive: true }),
    mkdir(clawxLogDir, { recursive: true }),
    mkdir(openClawLogDir, { recursive: true }),
  ]);
  await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({
    'agent:main:session-1': {
      sessionFile: transcriptPath,
      label: 'Broken conversation',
    },
    'agent:main:session-2': {
      sessionFile: secondTranscriptPath,
      label: 'Second conversation',
    },
  }));
  await writeFile(transcriptPath, '{"type":"message","message":{"role":"user","content":"keep transcript verbatim"}}\n');
  await writeFile(secondTranscriptPath, '{"type":"message","message":{"role":"user","content":"second transcript"}}\n');
  await writeFile(configPath, JSON.stringify({
    gateway: { auth: { token: 'gateway-secret' } },
    models: { providers: { custom: { apiKey: 'provider-secret', maxTokens: 8192 } } },
    ordinary: 'kept',
  }));
  await writeFile(join(clawxLogDir, 'clawx.log'), 'Authorization: Bearer abc123\npassword=hunter2\n');
  await writeFile(join(openClawLogDir, 'gateway.log'), 'token=runtime-secret status=failed\n');
  await writeFile(join(openClawLogDir, 'not-a-log.txt'), 'excluded');
  return {
    root,
    stateDir,
    sessionsDir,
    clawxLogDir,
    openClawLogDir,
    outputDir,
    configPath,
    transcriptPath,
    secondTranscriptPath,
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('issue report export', () => {
  it('packages available selected transcripts for the desktop and reports stale selections', async () => {
    const fixture = await makeFixture();
    const result = await exportIssueReport(
      { sessionKeys: ['agent:main:session-1', 'agent:main:stale', 'agent:main:session-2'] },
      {
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        clawxLogDir: fixture.clawxLogDir,
        openClawLogDir: fixture.openClawLogDir,
        outputDir: fixture.outputDir,
        now: () => new Date('2026-08-25T12:34:56.000Z'),
      },
    );

    expect(result).toMatchObject({
      success: true,
      path: join(fixture.outputDir, 'clawx-issue-report-20260825-123456Z.zip'),
      skippedSessionKeys: ['agent:main:stale'],
    });
    const zip = await JSZip.loadAsync(await readFile(result.path!));
    expect(Object.keys(zip.files).sort()).toEqual([
      'config/',
      'config/openclaw.json',
      'conversations/',
      'conversations/main/',
      'conversations/main/conversation-1.jsonl',
      'conversations/main/conversation-2.jsonl',
      'logs/',
      'logs/clawx/',
      'logs/clawx/clawx.log',
      'logs/openclaw/',
      'logs/openclaw/gateway.log',
      'manifest.json',
    ]);
    await expect(zip.file('conversations/main/conversation-1.jsonl')!.async('string'))
      .resolves.toContain('keep transcript verbatim');
    await expect(zip.file('conversations/main/conversation-2.jsonl')!.async('string'))
      .resolves.toContain('second transcript');

    const config = JSON.parse(await zip.file('config/openclaw.json')!.async('string'));
    expect(config.gateway.auth.token).toBe('[REDACTED]');
    expect(config.models.providers.custom.apiKey).toBe('[REDACTED]');
    expect(config.models.providers.custom.maxTokens).toBe(8192);
    expect(config.ordinary).toBe('kept');
    await expect(zip.file('logs/clawx/clawx.log')!.async('string')).resolves.not.toContain('abc123');
    await expect(zip.file('logs/clawx/clawx.log')!.async('string')).resolves.not.toContain('hunter2');
    await expect(zip.file('logs/openclaw/gateway.log')!.async('string')).resolves.not.toContain('runtime-secret');
    expect(zip.file('logs/openclaw/not-a-log.txt')).toBeNull();

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({
      formatVersion: 2,
      sessionKeys: ['agent:main:session-1', 'agent:main:session-2'],
      skippedSessionKeys: ['agent:main:stale'],
      privacy: {
        openClawConfigRedacted: true,
        logsRedacted: true,
        transcriptRedacted: false,
      },
    });
    expect(JSON.stringify(manifest)).not.toContain(fixture.root);
  });

  it('uses a unique archive name when an export already exists', async () => {
    const fixture = await makeFixture();
    const dependencies = {
      stateDir: fixture.stateDir,
      configPath: fixture.configPath,
      clawxLogDir: fixture.clawxLogDir,
      openClawLogDir: fixture.openClawLogDir,
      outputDir: fixture.outputDir,
      now: () => new Date('2026-08-25T12:34:56.000Z'),
    };
    const first = await exportIssueReport({ sessionKeys: ['agent:main:session-1'] }, dependencies);
    const second = await exportIssueReport({ sessionKeys: ['agent:main:session-1'] }, dependencies);
    expect(first.path).not.toBe(second.path);
    expect(second.path).toBe(join(fixture.outputDir, 'clawx-issue-report-20260825-123456Z-1.zip'));
  });

  it('rejects a transcript symlink that escapes the agent sessions directory', async () => {
    const fixture = await makeFixture();
    const outsideTranscript = join(fixture.root, 'outside.jsonl');
    await writeFile(outsideTranscript, '{}\n');
    await writeFile(join(fixture.sessionsDir, 'sessions.json'), JSON.stringify({
      'agent:main:session-escape': 'escape.jsonl',
    }));
    await symlink(outsideTranscript, join(fixture.sessionsDir, 'escape.jsonl'));

    await expect(exportIssueReport(
      { sessionKeys: ['agent:main:session-escape'] },
      {
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        clawxLogDir: fixture.clawxLogDir,
        openClawLogDir: fixture.openClawLogDir,
        outputDir: fixture.outputDir,
      },
    )).rejects.toThrow('outside its session directory');
    await expect(readdir(fixture.outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails when none of the selected conversations has an available transcript', async () => {
    const fixture = await makeFixture();
    await expect(exportIssueReport(
      { sessionKeys: ['agent:main:stale'] },
      { stateDir: fixture.stateDir, outputDir: fixture.outputDir },
    )).rejects.toThrow('None of the selected conversation transcripts could be found');
  });

  it('rejects an export with no selected conversations', async () => {
    const fixture = await makeFixture();
    await expect(exportIssueReport(
      { sessionKeys: [] },
      { stateDir: fixture.stateDir, outputDir: fixture.outputDir },
    )).rejects.toThrow('At least one session key is required');
  });

  it('redacts nested config credentials without redacting token limits', () => {
    expect(redactOpenClawConfig({
      OPENAI_API_KEY: 'secret',
      nested: { clientSecret: 'secret-2', maxTokens: 4096 },
    })).toEqual({
      OPENAI_API_KEY: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]', maxTokens: 4096 },
    });
    expect(redactDiagnosticText('Bearer secret token=another maxTokens=123 {"apiKey":"json-secret"}'))
      .toBe('Bearer [REDACTED] token=[REDACTED] maxTokens=123 {"apiKey":"[REDACTED]"}');
  });

  it('redacts quoted credentials with whitespace and complete authorization values', () => {
    const redacted = redactDiagnosticText([
      'password="hunter two" status=failed',
      "client_secret='secret with spaces' operation=login",
      'Authorization: Basic dXNlcjpwYXNz',
      'Proxy-Authorization=Bearer proxy-secret',
    ].join('\n'));

    expect(redacted).toBe([
      'password=[REDACTED] status=failed',
      'client_secret=[REDACTED] operation=login',
      'Authorization: [REDACTED]',
      'Proxy-Authorization=[REDACTED]',
    ].join('\n'));
    expect(redacted).not.toContain('hunter two');
    expect(redacted).not.toContain('dXNlcjpwYXNz');
    expect(redacted).not.toContain('proxy-secret');
  });
});
