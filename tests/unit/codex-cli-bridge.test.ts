// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

function createChild() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const stdoutHandlers: Array<(data: Buffer) => void> = [];
  const stderrHandlers: Array<(data: Buffer) => void> = [];
  return {
    stdout: { on: vi.fn((_event: string, handler: (data: Buffer) => void) => stdoutHandlers.push(handler)) },
    stderr: { on: vi.fn((_event: string, handler: (data: Buffer) => void) => stderrHandlers.push(handler)) },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return undefined;
    }),
    writeStdout: (data: string) => {
      for (const handler of stdoutHandlers) handler(Buffer.from(data));
    },
    writeStderr: (data: string) => {
      for (const handler of stderrHandlers) handler(Buffer.from(data));
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
}

describe('CodexCliBridge', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    spawnMock.mockReset();
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-codex-bridge-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('runs codex exec, stores transcript, and lists sessions', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });

    const sendPromise = bridge.send({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    const outputFile = args[args.indexOf('--output-last-message') + 1];
    await writeFile(outputFile, 'assistant ok\n', 'utf8');
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toMatchObject({
      runId: expect.stringMatching(/^codex-/),
      assistantMessage: { role: 'assistant', content: 'assistant ok' },
    });
    expect(spawnMock).toHaveBeenCalledWith('/mock/codex', expect.arrayContaining([
      'exec',
      '--json',
      '--ignore-user-config',
      '-C',
      '/tmp/project',
      '-c',
      'approval_policy="never"',
      '--sandbox',
      'workspace-write',
    ]), expect.objectContaining({ cwd: '/tmp/project' }));
    expect(args).not.toContain('--ask-for-approval');

    await expect(bridge.loadHistory('agent:main:main')).resolves.toMatchObject([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'assistant ok' },
    ]);
    await expect(bridge.listSessions()).resolves.toMatchObject([
      { key: 'agent:main:main', displayName: 'hello' },
    ]);
  });

  it('falls back to assistant text parsed from codex JSONL stdout', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });

    const sendPromise = bridge.send({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.writeStdout('not json\n');
    child.writeStdout(JSON.stringify({
      item: {
        role: 'assistant',
        content: [{ type: 'text', text: 'json assistant' }],
      },
    }) + '\n');
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toMatchObject({
      assistantMessage: { role: 'assistant', content: 'json assistant' },
    });
  });

  it('stores Codex tool calls and outputs as ClawX execution graph history', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });

    const sendPromise = bridge.send({
      sessionKey: 'agent:main:main',
      message: 'inspect files',
      idempotencyKey: 'idem-1',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.writeStdout(JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'call_exec',
        name: 'exec_command',
        arguments: JSON.stringify({ cmd: 'ls src' }),
      },
    }) + '\n');
    child.writeStdout(JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_exec',
        output: 'src/pages\nsrc/stores\n',
      },
    }) + '\n');
    child.writeStdout(JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      },
    }) + '\n');
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toMatchObject({
      assistantMessage: { role: 'assistant', content: 'done' },
    });
    await expect(bridge.loadHistory('agent:main:main')).resolves.toMatchObject([
      { role: 'user', content: 'inspect files' },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call_exec',
          name: 'exec_command',
          input: {
            input: { cmd: 'ls src' },
            result: 'src/pages\nsrc/stores\n',
          },
        }],
        stopReason: 'toolUse',
      },
      {
        role: 'toolresult',
        toolCallId: 'call_exec',
        toolName: 'exec_command',
        content: 'src/pages\nsrc/stores\n',
      },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('passes synced provider model args and environment to codex exec', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });
    bridge.setProviderProfile({
      providerId: 'openai-main',
      vendorId: 'openai',
      model: 'gpt-5.5',
      modelRef: 'openai/gpt-5.5',
      supported: true,
      codexArgs: ['--model', 'gpt-5.5'],
      env: { OPENAI_API_KEY: 'sk-test', CODEX_HOME: '/tmp/clawx-codex-home' },
      secretAvailable: true,
      updatedAt: '2026-06-07T00:00:00.000Z',
    });

    const sendPromise = bridge.send({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.writeStdout(JSON.stringify({
      item: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
      },
    }) + '\n');
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toMatchObject({
      assistantMessage: { role: 'assistant', content: 'ok' },
    });
    expect(spawnMock).toHaveBeenCalledWith('/mock/codex', expect.arrayContaining([
      '--model',
      'gpt-5.5',
    ]), expect.objectContaining({
      env: expect.objectContaining({
        OPENAI_API_KEY: 'sk-test',
        CODEX_HOME: '/tmp/clawx-codex-home',
      }),
    }));
  });

  it('passes ClawX proxy settings to codex child processes', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
      proxyEnvProvider: () => ({
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7891',
        ALL_PROXY: 'socks5://127.0.0.1:7892',
        http_proxy: 'http://127.0.0.1:7890',
        https_proxy: 'http://127.0.0.1:7891',
        all_proxy: 'socks5://127.0.0.1:7892',
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: 'localhost,127.0.0.1',
      }),
    });
    bridge.setProviderProfile({
      providerId: 'openai-main',
      vendorId: 'openai',
      model: 'gpt-5.5',
      modelRef: 'openai/gpt-5.5',
      supported: true,
      codexArgs: ['--model', 'gpt-5.5'],
      env: { OPENAI_API_KEY: 'sk-test', CODEX_HOME: '/tmp/clawx-codex-home' },
      secretAvailable: true,
      updatedAt: '2026-06-07T00:00:00.000Z',
    });

    const sendPromise = bridge.send({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.writeStdout(JSON.stringify({
      item: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
      },
    }) + '\n');
    child.emit('exit', 0);

    await expect(sendPromise).resolves.toMatchObject({
      assistantMessage: { role: 'assistant', content: 'ok' },
    });
    expect(spawnMock).toHaveBeenCalledWith('/mock/codex', expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({
        OPENAI_API_KEY: 'sk-test',
        CODEX_HOME: '/tmp/clawx-codex-home',
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7891',
        ALL_PROXY: 'socks5://127.0.0.1:7892',
        NO_PROXY: 'localhost,127.0.0.1',
      }),
    }));
  });

  it('rejects unsupported provider profiles before spawning codex', async () => {
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });
    bridge.setProviderProfile({
      providerId: 'anthropic-main',
      vendorId: 'anthropic',
      supported: false,
      unsupportedReason: 'anthropic is unsupported',
      codexArgs: [],
      secretAvailable: true,
      updatedAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(bridge.send({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    })).rejects.toThrow('anthropic is unsupported');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('stores a system error message when codex exits non-zero', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });

    const sendPromise = bridge.send({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.writeStderr('auth missing');
    child.emit('exit', 1);

    await expect(sendPromise).resolves.toMatchObject({
      assistantMessage: {
        role: 'system',
        content: 'auth missing',
        isError: true,
      },
    });
  });

  it('diagnoses codex CLI availability with --version', async () => {
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const { CodexCliBridge } = await import('@electron/runtime/codex-cli-bridge');
    const bridge = new CodexCliBridge({
      codexPath: '/mock/codex',
      sessionsDir: tempDir,
      workDir: '/tmp/project',
    });

    const resultPromise = bridge.diagnose();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    child.writeStdout('codex-cli 0.130.0\n');
    child.emit('exit', 0);

    await expect(resultPromise).resolves.toMatchObject({
      success: true,
      stdout: 'codex-cli 0.130.0\n',
    });
    expect(spawnMock).toHaveBeenCalledWith('/mock/codex', ['--version'], expect.any(Object));
  });
});
