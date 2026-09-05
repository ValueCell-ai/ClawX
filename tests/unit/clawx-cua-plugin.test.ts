// @vitest-environment node

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Writable, PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const pluginRoot = new URL('../../resources/openclaw-plugins/clawx-cua-computer/', import.meta.url);
const mcpClientModule = new URL('mcp-client.mjs', pluginRoot).href;
const computerToolModule = new URL('computer-tool.mjs', pluginRoot).href;
const pluginEntryModule = new URL('index.mjs', pluginRoot).href;

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3mIAAAAASUVORK5CYII=';
const DESCRIPTOR = {
  v: 1,
  generation: 'generation-1',
  mcpProtocolVersion: '2025-03-26',
  command: '/Applications/ClawX.app/Contents/Resources/cua-driver',
  args: ['mcp', '--connect', '/tmp/cua.sock'],
  environment: [{ name: 'CUA_TOKEN', value: 'opaque' }],
};
const TARGET = { kind: 'desktop', display_id: 'primary' };

function screenshotResult(width = 1440, height = 900) {
  return {
    content: [
      { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
      { type: 'text', text: 'desktop captured' },
    ],
    structuredContent: {
      platform: 'macos',
      display: 'primary',
      screenshot_width: width,
      screenshot_height: height,
      screen_width: width / 2,
      screen_height: height / 2,
      scale_factor: 2,
      screenshot_mime_type: 'image/png',
    },
  };
}

describe('ClawX CUA plugin manifest and registration', () => {
  it('declares an always-enabled startup computer tool contract', async () => {
    const manifest = JSON.parse(await readFile(new URL('openclaw.plugin.json', pluginRoot), 'utf8'));
    const pkg = JSON.parse(await readFile(new URL('package.json', pluginRoot), 'utf8'));

    expect(manifest).toMatchObject({
      id: 'clawx-cua-computer',
      enabledByDefault: true,
      activation: { onStartup: true },
      contracts: { tools: ['computer'] },
      configSchema: { type: 'object', additionalProperties: false, properties: {} },
    });
    expect(pkg).toMatchObject({ private: true, type: 'module', main: 'index.mjs' });
    expect(pkg.dependencies).toBeUndefined();
  });

  it('registers a non-optional factory and disposes it when Gateway stops', async () => {
    const { createPluginEntry } = await import(pluginEntryModule);
    const proxyManager = { execute: vi.fn(), dispose: vi.fn(async () => undefined) };
    const registerTool = vi.fn();
    const registerService = vi.fn();
    const entry = createPluginEntry({ proxyManager });

    entry.register({ registerTool, registerService });

    expect(registerTool).toHaveBeenCalledOnce();
    const [factory, options] = registerTool.mock.calls[0];
    expect(typeof factory).toBe('function');
    expect(options).toEqual({ name: 'computer' });
    expect(options).not.toHaveProperty('optional');
    expect(factory({}).name).toBe('computer');
    expect(registerService).toHaveBeenCalledOnce();
    const service = registerService.mock.calls[0][0];
    expect(service.id).toBe('clawx-cua-computer');
    await service.start({});
    await service.stop({});
    expect(proxyManager.dispose).toHaveBeenCalledOnce();
  });

  it('installs the plugin before starting CUA or Gateway', async () => {
    const source = await readFile(
      new URL('../../electron/main/index.ts', import.meta.url),
      'utf8',
    );
    const install = source.indexOf('await ensureClawXCuaPluginInstalled()');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(source.indexOf('await cuaRuntimeManager.start()'));
    expect(install).toBeLessThan(source.indexOf('await gatewayManager.start()'));
  });
});

describe('CUA descriptor validation', () => {
  it('accepts bounded Unix and Windows absolute commands', async () => {
    const { validateDescriptor } = await import(mcpClientModule);

    expect(validateDescriptor(DESCRIPTOR)).toEqual(DESCRIPTOR);
    expect(validateDescriptor({
      ...DESCRIPTOR,
      command: 'C:\\Program Files\\ClawX\\cua-driver.exe',
    }).command).toBe('C:\\Program Files\\ClawX\\cua-driver.exe');
  });

  it.each([
    [{ ...DESCRIPTOR, v: 2 }, 'v'],
    [{ ...DESCRIPTOR, generation: '' }, 'generation'],
    [{ ...DESCRIPTOR, mcpProtocolVersion: '' }, 'mcpProtocolVersion'],
    [{ ...DESCRIPTOR, command: 'cua-driver' }, 'absolute'],
    [{ ...DESCRIPTOR, args: new Array(257).fill('x') }, 'args'],
    [{ ...DESCRIPTOR, environment: [{ name: '', value: 'x' }] }, 'environment'],
    [{ ...DESCRIPTOR, environment: [{ name: 'A', value: 1 }] }, 'environment'],
  ])('rejects malformed descriptors as unavailable', async (value, message) => {
    const { validateDescriptor } = await import(mcpClientModule);
    expect(() => validateDescriptor(value)).toThrow(expect.objectContaining({
      code: 'COMPUTER_DRIVER_UNAVAILABLE',
      message: expect.stringContaining(message),
    }));
  });

  it('reads only the env-selected regular non-symlink file within 64 KiB', async () => {
    const { readConnectionDescriptor } = await import(mcpClientModule);
    const lstat = vi.fn(async () => ({
      size: 100,
      isFile: () => true,
      isSymbolicLink: () => false,
    }));
    const readFileMock = vi.fn(async () => JSON.stringify(DESCRIPTOR));

    await expect(readConnectionDescriptor({
      environment: { CLAWX_CUA_CONNECTION_FILE: '/private/descriptor.json' },
      lstat,
      readFile: readFileMock,
    })).resolves.toEqual(DESCRIPTOR);
    expect(lstat).toHaveBeenCalledWith('/private/descriptor.json');
    expect(readFileMock).toHaveBeenCalledWith('/private/descriptor.json');

    await expect(readConnectionDescriptor({
      environment: {},
      lstat,
      readFile: readFileMock,
    })).rejects.toMatchObject({ code: 'COMPUTER_DRIVER_UNAVAILABLE' });
    await expect(readConnectionDescriptor({
      environment: { CLAWX_CUA_CONNECTION_FILE: '/private/link.json' },
      lstat: vi.fn(async () => ({
        size: 100,
        isFile: () => true,
        isSymbolicLink: () => true,
      })),
      readFile: readFileMock,
    })).rejects.toMatchObject({ code: 'COMPUTER_DRIVER_UNAVAILABLE' });
    await expect(readConnectionDescriptor({
      environment: { CLAWX_CUA_CONNECTION_FILE: '/private/large.json' },
      lstat: vi.fn(async () => ({
        size: 65 * 1024,
        isFile: () => true,
        isSymbolicLink: () => false,
      })),
      readFile: readFileMock,
    })).rejects.toMatchObject({ code: 'COMPUTER_DRIVER_UNAVAILABLE' });
  });

  it('returns actionable guidance when Main has not published a descriptor', async () => {
    const { readConnectionDescriptor } = await import(mcpClientModule);
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });

    await expect(readConnectionDescriptor({
      environment: { CLAWX_CUA_CONNECTION_FILE: '/private/missing.json' },
      lstat: vi.fn(async () => { throw missing; }),
    })).rejects.toMatchObject({
      code: 'COMPUTER_DRIVER_UNAVAILABLE',
      message: expect.stringMatching(/Accessibility.*Screen Recording.*restart ClawX|reinstall ClawX/i),
    });
  });
});

describe('bounded MCP client', () => {
  it('uses the documented bounds and performs initialize before tool calls', async () => {
    const {
      MCP_LIMITS,
      createMcpClient,
    } = await import(mcpClientModule);
    expect(MCP_LIMITS).toEqual({
      maxDescriptorBytes: 64 * 1024,
      maxLineBytes: 256 * 1024 * 1024,
      maxPending: 64,
      startupTimeoutMs: 10_000,
      requestTimeoutMs: 120_000,
      shutdownTimeoutMs: 2_000,
      maxStderrBytes: 32 * 1024,
    });

    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: Writable;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    const requests: Array<Record<string, unknown>> = [];
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk).trim()) as Record<string, unknown>;
        requests.push(request);
        if (request.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { protocolVersion: DESCRIPTOR.mcpProtocolVersion, capabilities: {} },
          })}\n`);
        } else if (request.method === 'tools/call') {
          child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: screenshotResult() })}\n`);
        } else if (request.method === 'shutdown') {
          child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} })}\n`);
        }
        callback();
      },
    });
    const spawn = vi.fn(() => child);

    const client = await createMcpClient(DESCRIPTOR, {
      spawn,
      baseEnvironment: { PATH: '/bin', CUA_TOKEN: 'old' },
    });
    expect(child.stdin.listenerCount('error')).toBe(1);
    await client.callTool('get_desktop_state', { session: 'clawx' });

    expect(spawn).toHaveBeenCalledWith(
      DESCRIPTOR.command,
      DESCRIPTOR.args,
      expect.objectContaining({
        shell: false,
        env: { PATH: '/bin', CUA_TOKEN: 'opaque' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    await client.dispose();
  });

  it('normalizes MCP tool failures without retrying the action', async () => {
    const { createMcpClient } = await import(mcpClientModule);
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: Writable;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    let toolCalls = 0;
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk).trim()) as Record<string, unknown>;
        if (request.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { protocolVersion: DESCRIPTOR.mcpProtocolVersion },
          })}\n`);
        } else if (request.method === 'tools/call') {
          toolCalls += 1;
          child.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'permission denied' }],
              structuredContent: { code: 'permission_required' },
            },
          })}\n`);
        } else if (request.method === 'shutdown') {
          child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} })}\n`);
        }
        callback();
      },
    });
    const client = await createMcpClient(DESCRIPTOR, { spawn: vi.fn(() => child) });

    await expect(client.callTool('click', { x: 1, y: 2 })).rejects.toMatchObject({
      code: 'COMPUTER_DRIVER_ERROR',
      message: expect.stringContaining('permission denied'),
    });
    expect(toolCalls).toBe(1);
    await client.dispose();
  });

  it('rejects an incompatible negotiated protocol version', async () => {
    const { createMcpClient } = await import(mcpClientModule);
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: Writable;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk).trim()) as Record<string, unknown>;
        child.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: { protocolVersion: 'incompatible' },
        })}\n`);
        callback();
      },
    });

    await expect(createMcpClient(DESCRIPTOR, { spawn: vi.fn(() => child) })).rejects.toMatchObject({
      code: 'COMPUTER_DRIVER_UNAVAILABLE',
      message: expect.stringContaining('incompatible protocol version'),
    });
    expect(child.kill).toHaveBeenCalled();
  });

  it('fails closed and kills the proxy when a request times out', async () => {
    const { createMcpClient } = await import(mcpClientModule);
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: Writable;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk).trim()) as Record<string, unknown>;
        if (request.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { protocolVersion: DESCRIPTOR.mcpProtocolVersion },
          })}\n`);
        }
        callback();
      },
    });
    const client = await createMcpClient(DESCRIPTOR, { spawn: vi.fn(() => child) });

    await expect(client.callTool('click', { x: 1, y: 2 }, 1)).rejects.toMatchObject({
      code: 'COMPUTER_DRIVER_UNAVAILABLE',
      message: expect.stringContaining('timed out'),
    });
    expect(child.kill).toHaveBeenCalled();
    await expect(client.callTool('click', { x: 1, y: 2 })).rejects.toMatchObject({
      code: 'COMPUTER_DRIVER_UNAVAILABLE',
    });
  });

  it('disposes a failed proxy and reconnects only for a later explicit operation', async () => {
    const { createProxyManager } = await import(mcpClientModule);
    const first = {
      callTool: vi.fn(async (name: string) => {
        if (name === 'start_session') return {};
        throw Object.assign(new Error('proxy failed'), { code: 'COMPUTER_DRIVER_UNAVAILABLE' });
      }),
      dispose: vi.fn(async () => undefined),
    };
    const second = {
      callTool: vi.fn(async () => ({})),
      dispose: vi.fn(async () => undefined),
    };
    const createProxy = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const manager = createProxyManager({
      readDescriptor: vi.fn(async () => DESCRIPTOR),
      createProxy,
    });

    await expect(manager.execute(({ callTool }) => callTool('click', {}))).rejects.toThrow('proxy failed');
    expect(first.dispose).toHaveBeenCalledOnce();
    await expect(manager.execute(({ callTool }) => callTool('get_desktop_state', {}))).resolves.toEqual({});
    expect(createProxy).toHaveBeenCalledTimes(2);
  });

  it('disposes the current proxy when its descriptor disappears', async () => {
    const { createProxyManager, computerDriverError } = await import(mcpClientModule);
    const proxy = {
      callTool: vi.fn(async () => ({})),
      dispose: vi.fn(async () => undefined),
    };
    const readDescriptor = vi.fn()
      .mockResolvedValueOnce(DESCRIPTOR)
      .mockRejectedValueOnce(computerDriverError('COMPUTER_DRIVER_UNAVAILABLE', 'descriptor removed'));
    const manager = createProxyManager({
      readDescriptor,
      createProxy: vi.fn(async () => proxy),
    });
    await manager.execute(({ callTool }) => callTool('get_desktop_state', {}));

    await expect(manager.execute(({ callTool }) => callTool('get_desktop_state', {}))).rejects.toThrow(
      'descriptor removed',
    );
    expect(proxy.dispose).toHaveBeenCalledOnce();
  });
});

describe('computer action mapping', () => {
  it('maps the complete action surface to CUA tools and primary desktop args', async () => {
    const { COMPUTER_ACTIONS, mapComputerAction } = await import(computerToolModule);
    expect(COMPUTER_ACTIONS).toEqual([
      'screenshot',
      'left_click',
      'right_click',
      'middle_click',
      'double_click',
      'triple_click',
      'mouse_move',
      'left_click_drag',
      'scroll',
      'type',
      'key',
      'wait',
    ]);
    expect(mapComputerAction({ action: 'screenshot' })).toEqual({
      toolName: 'get_desktop_state',
      arguments: {},
    });
    expect(mapComputerAction({ action: 'left_click', coordinate: [10, 20] })).toEqual({
      toolName: 'click',
      arguments: { x: 10, y: 20, button: 'left', count: 1, target: TARGET },
    });
    expect(mapComputerAction({ action: 'right_click', coordinate: [11, 21] }).arguments).toMatchObject({ button: 'right', count: 1, target: TARGET });
    expect(mapComputerAction({ action: 'middle_click', coordinate: [12, 22] }).arguments).toMatchObject({ button: 'middle', count: 1, target: TARGET });
    expect(mapComputerAction({ action: 'double_click', coordinate: [13, 23] }).arguments).toMatchObject({ button: 'left', count: 2, target: TARGET });
    expect(mapComputerAction({ action: 'triple_click', coordinate: [14, 24] }).arguments).toMatchObject({ button: 'left', count: 3, target: TARGET });
    expect(mapComputerAction({ action: 'mouse_move', coordinate: [15, 25] })).toEqual({
      toolName: 'move_cursor',
      arguments: { x: 15, y: 25, target: TARGET },
    });
    expect(mapComputerAction({
      action: 'left_click_drag',
      startCoordinate: [1, 2],
      coordinate: [30, 40],
      duration: 1.25,
    })).toEqual({
      toolName: 'drag',
      arguments: {
        from_x: 1,
        from_y: 2,
        to_x: 30,
        to_y: 40,
        duration_ms: 1250,
        target: TARGET,
      },
    });
    expect(mapComputerAction({
      action: 'scroll',
      coordinate: [16, 26],
      scrollDirection: 'down',
      scrollAmount: 500,
    })).toEqual({
      toolName: 'scroll',
      arguments: { x: 16, y: 26, direction: 'down', by: 'line', amount: 50, target: TARGET },
    });
    expect(mapComputerAction({ action: 'type', text: 'hello' })).toEqual({
      toolName: 'type_text',
      arguments: { text: 'hello', target: TARGET },
    });
  });

  it('normalizes key aliases and rejects layout-dependent punctuation', async () => {
    const { parseKeyCombination } = await import(computerToolModule);
    expect(parseKeyCombination('meta+Shift+T')).toEqual({ key: 't', modifiers: ['meta', 'shift'] });
    expect(parseKeyCombination('control+option+Return')).toEqual({ key: 'enter', modifiers: ['ctrl', 'alt'] });
    expect(parseKeyCombination('win+F12')).toEqual({ key: 'f12', modifiers: ['meta'] });
    expect(parseKeyCombination('cmd+PageUp')).toEqual({ key: 'pageup', modifiers: ['meta'] });
    expect(() => parseKeyCombination('ctrl+/')).toThrow(/layout-dependent punctuation/i);
    expect(() => parseKeyCombination('ctrl+1')).toThrow(/layout-dependent/i);
    expect(() => parseKeyCombination('ctrl+a+b')).toThrow(/one non-modifier/i);
  });

  it('requires a coordinate and direction for scroll', async () => {
    const { mapComputerAction } = await import(computerToolModule);
    expect(() => mapComputerAction({ action: 'scroll', scrollDirection: 'down' })).toThrow(/coordinate/i);
    expect(() => mapComputerAction({ action: 'scroll', coordinate: [1, 2] })).toThrow(/scrollDirection/i);
  });
});

describe('computer tool execution', () => {
  it('returns native PNG geometry with non-outbound media metadata', async () => {
    const { createProxyManager } = await import(mcpClientModule);
    const { createComputerTool } = await import(computerToolModule);
    const proxy = {
      callTool: vi.fn(async (name: string) => (
        name === 'start_session' ? { structuredContent: { active: true } } : screenshotResult(2880, 1800)
      )),
      dispose: vi.fn(async () => undefined),
    };
    const manager = createProxyManager({
      readDescriptor: vi.fn(async () => DESCRIPTOR),
      createProxy: vi.fn(async () => proxy),
    });
    const tool = createComputerTool({ proxyManager: manager, sleep: vi.fn() });

    const result = await tool.execute('call-1', { action: 'screenshot' });

    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('2880x1800') }),
      { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
    ]);
    expect(result.details).toMatchObject({
      generation: 'generation-1',
      action: 'screenshot',
      width: 2880,
      height: 1800,
      nativeWidth: 2880,
      nativeHeight: 1800,
      screenWidth: 1440,
      screenHeight: 900,
      media: { outbound: false },
    });
    expect(proxy.callTool).toHaveBeenNthCalledWith(1, 'start_session', { session: 'clawx-primary-desktop' }, expect.anything());
    expect(proxy.callTool).toHaveBeenNthCalledWith(2, 'get_desktop_state', { session: 'clawx-primary-desktop' }, expect.anything());
  });

  it('requires a same-generation screenshot and rejects out-of-frame coordinates', async () => {
    const { createProxyManager } = await import(mcpClientModule);
    const { createComputerTool } = await import(computerToolModule);
    let descriptor = DESCRIPTOR;
    const proxies: Array<{ callTool: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
    const createProxy = vi.fn(async () => {
      const proxy = {
        callTool: vi.fn(async (name: string) => (
          name === 'get_desktop_state' ? screenshotResult(100, 50) : { structuredContent: { effect: 'unverifiable' } }
        )),
        dispose: vi.fn(async () => undefined),
      };
      proxies.push(proxy);
      return proxy;
    });
    const manager = createProxyManager({
      readDescriptor: vi.fn(async () => descriptor),
      createProxy,
    });
    const tool = createComputerTool({ proxyManager: manager, sleep: vi.fn() });

    await expect(tool.execute('call-1', { action: 'left_click', coordinate: [1, 1] })).rejects.toThrow(/screenshot/i);
    await tool.execute('call-2', { action: 'screenshot' });
    await expect(tool.execute('call-3', { action: 'left_click', coordinate: [-1, 1] })).rejects.toThrow(/non-negative/i);
    await expect(tool.execute('call-4', { action: 'left_click', coordinate: [100, 1] })).rejects.toThrow(/outside.*100x50/i);

    descriptor = { ...DESCRIPTOR, generation: 'generation-2' };
    await expect(tool.execute('call-5', { action: 'left_click', coordinate: [1, 1] })).rejects.toThrow(/same descriptor generation/i);
    expect(proxies[0].dispose).toHaveBeenCalledOnce();
    expect(createProxy).toHaveBeenCalledOnce();
  });

  it('serializes all tool instances through the proxy manager', async () => {
    const { createProxyManager } = await import(mcpClientModule);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const proxy = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'start_session') return {};
        const marker = String(args.text);
        order.push(`start-${marker}`);
        if (marker === 'one') await firstBlocked;
        order.push(`end-${marker}`);
        return {};
      }),
      dispose: vi.fn(async () => undefined),
    };
    const manager = createProxyManager({
      readDescriptor: vi.fn(async () => DESCRIPTOR),
      createProxy: vi.fn(async () => proxy),
    });

    const first = manager.execute(({ callTool }: { callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> }) => callTool('type_text', { text: 'one' }));
    const second = manager.execute(({ callTool }: { callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> }) => callTool('type_text', { text: 'two' }));
    await vi.waitFor(() => expect(order).toEqual(['start-one']));
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['start-one', 'end-one', 'start-two', 'end-two']);
  });

  it('does not turn a successful input into a failure when follow-up capture fails', async () => {
    const { createProxyManager } = await import(mcpClientModule);
    const { createComputerTool } = await import(computerToolModule);
    let captures = 0;
    const proxy = {
      callTool: vi.fn(async (name: string) => {
        if (name === 'get_desktop_state') {
          captures += 1;
          if (captures === 1) return screenshotResult(100, 50);
          throw Object.assign(new Error('capture crashed'), { code: 'COMPUTER_DRIVER_ERROR' });
        }
        return { content: [{ type: 'text', text: 'input delivered' }] };
      }),
      dispose: vi.fn(async () => undefined),
    };
    const sleep = vi.fn(async () => undefined);
    const manager = createProxyManager({
      readDescriptor: vi.fn(async () => DESCRIPTOR),
      createProxy: vi.fn(async () => proxy),
    });
    const tool = createComputerTool({ proxyManager: manager, sleep });
    await tool.execute('call-1', { action: 'screenshot' });

    const result = await tool.execute('call-2', { action: 'left_click', coordinate: [10, 10] });

    expect(sleep).toHaveBeenCalledWith(500);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringMatching(/input delivered.*follow-up screenshot failed/s),
      }),
    ]);
    expect(result.content).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image' })]));
    await expect(tool.execute('call-3', { action: 'left_click', coordinate: [10, 10] })).rejects.toThrow(/screenshot/i);
  });

  it('invalidates the prior screenshot before attempting an input with unknown completion', async () => {
    const { createComputerTool } = await import(computerToolModule);
    let calls = 0;
    const proxyManager = {
      execute: (operation: (context: unknown) => Promise<unknown>) => operation({
        generation: DESCRIPTOR.generation,
        callTool: vi.fn(async (name: string) => {
          calls += 1;
          if (name === 'get_desktop_state') return screenshotResult(100, 50);
          throw Object.assign(new Error('request timed out'), { code: 'COMPUTER_DRIVER_UNAVAILABLE' });
        }),
      }),
    };
    const tool = createComputerTool({ proxyManager, sleep: vi.fn() });
    await tool.execute('call-1', { action: 'screenshot' });

    await expect(tool.execute('call-2', { action: 'left_click', coordinate: [10, 10] })).rejects.toThrow('timed out');
    await expect(tool.execute('call-3', { action: 'left_click', coordinate: [10, 10] })).rejects.toThrow(/screenshot/i);
    expect(calls).toBe(2);
  });

  it('bounds wait then captures and disposes the named session', async () => {
    const { createProxyManager } = await import(mcpClientModule);
    const { createComputerTool } = await import(computerToolModule);
    const proxy = {
      callTool: vi.fn(async (name: string) => (
        name === 'get_desktop_state' ? screenshotResult() : {}
      )),
      dispose: vi.fn(async () => undefined),
    };
    const sleep = vi.fn(async () => undefined);
    const manager = createProxyManager({
      readDescriptor: vi.fn(async () => DESCRIPTOR),
      createProxy: vi.fn(async () => proxy),
    });
    const tool = createComputerTool({ proxyManager: manager, sleep });

    await tool.execute('call-1', { action: 'wait', duration: 100 });
    await expect(tool.execute('call-2', { action: 'wait', duration: 101 })).rejects.toThrow(/0-100/);
    await manager.dispose();

    expect(sleep).toHaveBeenCalledWith(100_000);
    expect(proxy.callTool).toHaveBeenCalledWith('end_session', { session: 'clawx-primary-desktop' }, 2_000);
    expect(proxy.dispose).toHaveBeenCalledOnce();
  });
});
