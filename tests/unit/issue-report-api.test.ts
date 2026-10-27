// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
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
  const runtimeLogDir = join(root, 'tmp', 'openclaw');
  const outputDir = join(root, 'Desktop');
  const configPath = join(stateDir, 'openclaw.json');
  const transcriptPath = join(sessionsDir, 'conversation-1.jsonl');
  const secondTranscriptPath = join(sessionsDir, 'conversation-2.jsonl');
  await Promise.all([
    mkdir(sessionsDir, { recursive: true }),
    mkdir(clawxLogDir, { recursive: true }),
    mkdir(openClawLogDir, { recursive: true }),
    mkdir(runtimeLogDir, { recursive: true }),
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
  await writeFile(
    join(runtimeLogDir, 'openclaw-2026-08-25.log'),
    '{"0":"Doctor could not enter maintenance","apiKey":"runtime-log-secret"}\n',
  );
  await writeFile(join(runtimeLogDir, 'unrelated.log'), 'excluded');
  return {
    root,
    stateDir,
    sessionsDir,
    clawxLogDir,
    openClawLogDir,
    runtimeLogDir,
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
        openClawRuntimeLogDirs: [fixture.runtimeLogDir],
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
      'logs/openclaw-runtime/',
      'logs/openclaw-runtime/openclaw-2026-08-25.log',
      'logs/openclaw/',
      'logs/openclaw/gateway.log',
      'manifest.json',
    ]);
    const runtimeLog = await zip.file('logs/openclaw-runtime/openclaw-2026-08-25.log')!.async('string');
    expect(runtimeLog).toContain('Doctor could not enter maintenance');
    expect(runtimeLog).not.toContain('runtime-log-secret');
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

  it('keeps only the newest runtime logs and the tail of oversized ones', async () => {
    const fixture = await makeFixture();
    const secondRuntimeDir = join(fixture.root, 'tmp', 'openclaw-501');
    await mkdir(secondRuntimeDir, { recursive: true });
    const oversized = `${'old line\n'.repeat(1024 * 1024)}newest failure line\n`;
    await writeFile(join(secondRuntimeDir, 'openclaw-2026-08-25.log'), oversized);
    await writeFile(join(fixture.runtimeLogDir, 'openclaw-2026-08-24.log'), 'yesterday\n');
    await writeFile(join(fixture.runtimeLogDir, 'openclaw-2026-08-23.log'), 'two days ago\n');
    const day = (date: string) => new Date(`${date}T12:00:00.000Z`);
    await Promise.all([
      utimes(join(fixture.runtimeLogDir, 'openclaw-2026-08-23.log'), day('2026-08-23'), day('2026-08-23')),
      utimes(join(fixture.runtimeLogDir, 'openclaw-2026-08-24.log'), day('2026-08-24'), day('2026-08-24')),
      utimes(join(fixture.runtimeLogDir, 'openclaw-2026-08-25.log'), day('2026-08-25'), day('2026-08-25')),
      utimes(join(secondRuntimeDir, 'openclaw-2026-08-25.log'), day('2026-08-26'), day('2026-08-26')),
    ]);

    const result = await exportIssueReport({ sessionKeys: [] }, {
      stateDir: fixture.stateDir,
      configPath: fixture.configPath,
      clawxLogDir: fixture.clawxLogDir,
      openClawLogDir: fixture.openClawLogDir,
      openClawRuntimeLogDirs: [fixture.runtimeLogDir, secondRuntimeDir],
      outputDir: fixture.outputDir,
    });

    const zip = await JSZip.loadAsync(await readFile(result.path!));
    expect(Object.keys(zip.files).filter((name) => name.startsWith('logs/openclaw-runtime/')).sort()).toEqual([
      'logs/openclaw-runtime/',
      'logs/openclaw-runtime/openclaw-2026-08-24.log',
      'logs/openclaw-runtime/openclaw-2026-08-25-2.log',
      'logs/openclaw-runtime/openclaw-2026-08-25.log',
    ]);
    const tail = await zip.file('logs/openclaw-runtime/openclaw-2026-08-25.log')!.async('string');
    expect(tail.startsWith('[clawx] truncated: kept the last 8388608 of')).toBe(true);
    expect(tail.endsWith('newest failure line\n')).toBe(true);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(8 * 1024 * 1024 + 100);
  });

  it('records a missing runtime log directory in the manifest', async () => {
    const fixture = await makeFixture();
    const result = await exportIssueReport({ sessionKeys: [] }, {
      stateDir: fixture.stateDir,
      configPath: fixture.configPath,
      clawxLogDir: fixture.clawxLogDir,
      openClawLogDir: fixture.openClawLogDir,
      openClawRuntimeLogDirs: [join(fixture.root, 'missing-runtime-logs')],
      outputDir: fixture.outputDir,
    });

    const zip = await JSZip.loadAsync(await readFile(result.path!));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.missingFiles).toContain('logs/openclaw-runtime/');
  });

  it('uses a unique archive name when an export already exists', async () => {
    const fixture = await makeFixture();
    const dependencies = {
      stateDir: fixture.stateDir,
      configPath: fixture.configPath,
      clawxLogDir: fixture.clawxLogDir,
      openClawLogDir: fixture.openClawLogDir,
      openClawRuntimeLogDirs: [fixture.runtimeLogDir],
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
        openClawRuntimeLogDirs: [fixture.runtimeLogDir],
        outputDir: fixture.outputDir,
      },
    )).rejects.toThrow('outside its session directory');
    await expect(readdir(fixture.outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exports SQLite transcripts when sessions.json no longer points at a JSONL file', async () => {
    const fixture = await makeFixture();
    const plain = JSON.stringify({ type: 'session', id: 'sess-1' });
    const compressedText = JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'sqlite transcript verbatim' },
    });
    const older = JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'older window' },
    });
    const dbPath = join(fixture.stateDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite');
    await mkdir(join(fixture.stateDir, 'agents', 'main', 'agent'), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session_nodes (
        session_key TEXT PRIMARY KEY,
        current_session_id TEXT NOT NULL
      );
      CREATE TABLE session_windows (
        session_id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE transcript_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT,
        event_zstd BLOB,
        event_utf8_bytes INTEGER,
        PRIMARY KEY (session_id, seq)
      );
    `);
    db.prepare('INSERT INTO session_nodes (session_key, current_session_id) VALUES (?, ?)').run(
      'agent:main:session-sqlite',
      'sess-2',
    );
    const insertWindow = db.prepare(
      'INSERT INTO session_windows (session_id, session_key, created_at) VALUES (?, ?, ?)',
    );
    insertWindow.run('sess-1', 'agent:main:session-sqlite', 1);
    insertWindow.run('sess-2', 'agent:main:session-sqlite', 2);
    const insertEvent = db.prepare(
      'INSERT INTO transcript_events (session_id, seq, event_json, event_zstd, event_utf8_bytes) VALUES (?, ?, ?, ?, ?)',
    );
    insertEvent.run('sess-1', 1, older, null, null);
    insertEvent.run('sess-2', 1, plain, null, null);
    insertEvent.run(
      'sess-2',
      2,
      null,
      zstdCompressSync(Buffer.from(compressedText, 'utf8')),
      Buffer.byteLength(compressedText),
    );
    db.close();
    await rm(join(fixture.sessionsDir, 'sessions.json'));

    const result = await exportIssueReport(
      { sessionKeys: ['agent:main:session-sqlite'] },
      {
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        clawxLogDir: fixture.clawxLogDir,
        openClawLogDir: fixture.openClawLogDir,
        openClawRuntimeLogDirs: [fixture.runtimeLogDir],
        outputDir: fixture.outputDir,
      },
    );

    expect(result.skippedSessionKeys).toEqual([]);
    const zip = await JSZip.loadAsync(await readFile(result.path!));
    await expect(zip.file('conversations/main/sess-1.jsonl')!.async('string')).resolves.toBe(`${older}\n`);
    const current = await zip.file('conversations/main/sess-2.jsonl')!.async('string');
    expect(current).toBe(`${plain}\n${compressedText}\n`);
    expect(current).toContain('sqlite transcript verbatim');
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.sessionKeys).toEqual(['agent:main:session-sqlite']);
    expect(JSON.stringify(manifest)).not.toContain(fixture.root);
  });

  it('still rejects an escaping transcript symlink when a SQLite copy exists', async () => {
    const fixture = await makeFixture();
    const outsideTranscript = join(fixture.root, 'outside.jsonl');
    await writeFile(outsideTranscript, '{}\n');
    await writeFile(join(fixture.sessionsDir, 'sessions.json'), JSON.stringify({
      'agent:main:session-escape': 'escape.jsonl',
    }));
    await symlink(outsideTranscript, join(fixture.sessionsDir, 'escape.jsonl'));
    const dbPath = join(fixture.stateDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite');
    await mkdir(join(fixture.stateDir, 'agents', 'main', 'agent'), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session_nodes (
        session_key TEXT PRIMARY KEY,
        current_session_id TEXT NOT NULL
      );
      CREATE TABLE transcript_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT,
        PRIMARY KEY (session_id, seq)
      );
    `);
    db.prepare('INSERT INTO session_nodes (session_key, current_session_id) VALUES (?, ?)').run(
      'agent:main:session-escape',
      'sess-escape',
    );
    db.prepare('INSERT INTO transcript_events (session_id, seq, event_json) VALUES (?, ?, ?)').run(
      'sess-escape',
      1,
      '{"type":"message","message":{"role":"user","content":"should not export"}}',
    );
    db.close();

    await expect(exportIssueReport(
      { sessionKeys: ['agent:main:session-escape'] },
      {
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        clawxLogDir: fixture.clawxLogDir,
        openClawLogDir: fixture.openClawLogDir,
        openClawRuntimeLogDirs: [fixture.runtimeLogDir],
        outputDir: fixture.outputDir,
      },
    )).rejects.toThrow('outside its session directory');
  });

  it('exports diagnostics when none of the selected conversations has an available transcript', async () => {
    const fixture = await makeFixture();
    const result = await exportIssueReport(
      { sessionKeys: ['agent:main:stale'] },
      {
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        clawxLogDir: fixture.clawxLogDir,
        openClawLogDir: fixture.openClawLogDir,
        openClawRuntimeLogDirs: [fixture.runtimeLogDir],
        outputDir: fixture.outputDir,
      },
    );

    expect(result.skippedSessionKeys).toEqual(['agent:main:stale']);
    const zip = await JSZip.loadAsync(await readFile(result.path!));
    expect(Object.keys(zip.files)).not.toContain('conversations/');
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.sessionKeys).toEqual([]);
    expect(manifest.skippedSessionKeys).toEqual(['agent:main:stale']);
  });

  it('exports configuration, logs, and a manifest with no selected conversations', async () => {
    const fixture = await makeFixture();
    const result = await exportIssueReport(
      { sessionKeys: [] },
      {
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        clawxLogDir: fixture.clawxLogDir,
        openClawLogDir: fixture.openClawLogDir,
        openClawRuntimeLogDirs: [fixture.runtimeLogDir],
        outputDir: fixture.outputDir,
      },
    );

    const zip = await JSZip.loadAsync(await readFile(result.path!));
    expect(Object.keys(zip.files)).not.toContain('conversations/');
    expect(zip.file('config/openclaw.json')).not.toBeNull();
    expect(zip.file('logs/clawx/clawx.log')).not.toBeNull();
    expect(zip.file('logs/openclaw/gateway.log')).not.toBeNull();
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.sessionKeys).toEqual([]);
    expect(manifest.skippedSessionKeys).toEqual([]);
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
