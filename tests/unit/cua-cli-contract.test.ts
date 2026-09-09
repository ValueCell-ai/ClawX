// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = () => readFileSync(resolve('resources/skills/computer-use/SKILL.md'), 'utf8');
const blocks = (language: string) => [...skill().matchAll(new RegExp('```' + language + '\n([\\s\\S]*?)\n```', 'g'))].map((match) => match[1]);

describe('computer-use CLI guidance contract (no native driver)', () => {
  it('documents host ownership and recovery without another adapter or approval bypass', () => {
    const content = skill();
    for (const term of [
      'CLAWX_CUA_CONNECTION_FILE', 'binaryPath', 'socketPath', 'generation', 'driverVersion',
      'Electron Main', 'Developer Mode', 'takes precedence', 'MCP', 'autostart',
      'permissions grant', 'permission-policy', 'sandbox', 'no auto replay',
    ]) expect(content).toContain(term);
    expect(content).toMatch(/\{\s*"v":\s*2,/);
    const descriptor = JSON.parse(content.match(/`(\{"v":2,.*?\})`/)![1]);
    expect(descriptor.generation).toEqual(expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    expect(content).toMatch(/reread the descriptor/i);
    expect(content).toMatch(/not.*before every (action|command)/i);
  });

  it('overrides recording shorthand with session-scoped calls and verified cleanup', () => {
    const content = skill();
    for (const tool of ['start_recording', 'get_recording_state', 'stop_recording']) {
      expect(content).toContain(`call ${tool}`);
    }
    expect(content).toContain('Do not use `recording start/status/stop`');
    expect(content).toContain('0.21.0 shorthand omits the named session');
    expect(content).toMatch(/recording[\s\S]*explicit workflow `session`/);
    expect(content).toMatch(/stop_recording[\s\S]*verify recording is disabled before `end_session`/);
    expect(content).toContain('may outlive named-session cleanup');
  });

  it('uses the full native surface and explicit sessions across separate exec calls', () => {
    const content = skill();
    for (const tool of ['list_windows', 'get_window_state', 'element_token', 'invoke_menu', 'verify_state', 'get_browser_state', 'end_session']) {
      expect(content).toContain(tool);
    }
    expect(content).toContain('not `default`');
    expect(content).toContain('disposable');
    expect(content).toContain('same label');
    const commands = blocks('sh').flatMap((block) => block.split('\n')).filter((line) => line.startsWith("'/absolute/"));
    expect(commands.length).toBeGreaterThanOrEqual(3);
    for (const command of commands) {
      expect(command).toContain("--socket '/absolute/path/from/socketPath'");
      if (!command.includes(' call ')) continue;
      const payload = JSON.parse(command.match(/'(\{.*\})'$/)![1]);
      expect(payload.session).toBe('clawx-review-20260909-01');
      if (payload.screenshot_out_file) {
        expect(payload.screenshot_out_file).toMatch(/^\/absolute\/agent-workspace\/.*\.png$/);
        expect(payload).not.toHaveProperty('action');
      }
    }
  });

  it.skipIf(process.platform === 'win32')('runs the POSIX descriptor bootstrap with spaces and fails closed when unset', () => {
    const bootstrap = blocks('sh')[0];
    expect(bootstrap, 'POSIX bootstrap must be present in the entrypoint').toBeDefined();
    expect(bootstrap).toContain('CLAWX_CUA_CONNECTION_FILE');
    expect(bootstrap).not.toMatch(/\bjq\b|\bpython\b|\bnode\b/);
    const root = mkdtempSync(join(tmpdir(), 'cua CLI bootstrap '));
    try {
      const descriptor = { v: 2, generation: '550e8400-e29b-41d4-a716-446655440000', driverVersion: '0.21.0', binaryPath: '/App With Spaces/cua-driver', socketPath: '/private/host endpoint.sock' };
      const file = join(root, 'connection descriptor.json');
      writeFileSync(file, JSON.stringify(descriptor));
      const result = spawnSync('/bin/sh', ['-c', bootstrap], { encoding: 'utf8', env: { ...process.env, CLAWX_CUA_CONNECTION_FILE: file } });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(descriptor);
      const missing = spawnSync('/bin/sh', ['-c', bootstrap], { encoding: 'utf8', env: { ...process.env, CLAWX_CUA_CONNECTION_FILE: '' } });
      expect(missing.status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('provides PowerShell descriptor parsing and UTF-8 JSON stdin rather than fragile positional JSON', () => {
    const examples = blocks('powershell').join('\n');
    expect(examples).toContain('Get-Content -LiteralPath $env:CLAWX_CUA_CONNECTION_FILE -Raw');
    expect(examples).toContain('ConvertFrom-Json');
    expect(examples).toContain('ConvertTo-Json -Compress');
    expect(examples).toContain('$OutputEncoding');
    expect(examples).toContain('| & $c.binaryPath --socket $c.socketPath call list_windows');
    expect(skill()).toContain('omit the positional JSON argument');
  });

  it('separates semantic success and fresh image read from process exit or screenshot flags', () => {
    const content = skill();
    for (const term of ['zero exit', 'stdout', 'stderr', 'screenshot_out_file', '--screenshot-out-file',
      'fresh', 'parent', 'absolute', 'workspace', '`read`', '2000', '1200', 'resiz', 'base64',
      'unknown', 'effect', 'satisfied', 'unsatisfied', 'confirmation']) expect(content).toContain(term);
    expect(content).toContain('not equivalent');
    expect(content).toContain('do not replay');
    expect(content).toContain('not proof');
  });
});
