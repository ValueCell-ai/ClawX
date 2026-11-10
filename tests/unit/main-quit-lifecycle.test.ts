import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_QUIT_CLEANUP_TIMEOUT_MS,
  createQuitLifecycleState,
  markQuitCleanupCompleted,
  requestQuitLifecycleAction,
} from '@electron/main/quit-lifecycle';

describe('main quit lifecycle coordination', () => {
  it('starts cleanup only once', () => {
    const state = createQuitLifecycleState();

    expect(requestQuitLifecycleAction(state)).toBe('start-cleanup');
    expect(requestQuitLifecycleAction(state)).toBe('cleanup-in-progress');
  });

  it('allows quit after cleanup is marked complete', () => {
    const state = createQuitLifecycleState();

    expect(requestQuitLifecycleAction(state)).toBe('start-cleanup');
    markQuitCleanupCompleted(state);
    expect(requestQuitLifecycleAction(state)).toBe('allow-quit');
  });
});

// Execute the registered callback itself without importing Main startup side effects.
function setupQuit(isE2EMode = false, hasAcpService = true, waitForExtensions = false) {
  const source = readFileSync('electron/main/index.ts', 'utf8');
  const start = source.indexOf("  app.on('before-quit',");
  const end = source.indexOf('\n  // Best-effort Gateway cleanup', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const gateway = Promise.withResolvers<void>();
  const computerUse = Promise.withResolvers<void>();
  const acp = Promise.withResolvers<void>();
  const extensions = Promise.withResolvers<void>();
  if (!waitForExtensions) extensions.resolve();
  const extensionRegistry = { teardownAll: vi.fn(() => extensions.promise) };
  const setQuitting = vi.fn();
  const acpChatService = { stop: vi.fn(() => acp.promise) };
  const gatewayManager = {
    stop: vi.fn(() => gateway.promise),
    forceTerminateOwnedProcessForQuit: vi.fn().mockResolvedValue(true),
  };
  const computerUseApi = { stop: vi.fn(() => computerUse.promise) };
  const app = { on: vi.fn(), quit: vi.fn() };
  const logger = { debug: vi.fn(), warn: vi.fn() };
  runInNewContext(ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    app, gatewayManager, computerUseApi, logger, isE2EMode, setTimeout, APP_QUIT_CLEANUP_TIMEOUT_MS,
    getActiveAcpChatService: () => hasAcpService ? acpChatService : null,
    setQuitting,
    cancelDingTalkDwsOAuth: vi.fn(),
    extensionRegistry,
    quitLifecycleState: createQuitLifecycleState(),
    requestQuitLifecycleAction, markQuitCleanupCompleted,
  });
  const quit = () => app.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  return { quit, app, logger, gatewayManager, computerUseApi, acpChatService, gateway, computerUse, acp, extensions, extensionRegistry, setQuitting };
}

describe('Main before-quit cleanup', () => {
  afterEach(() => vi.useRealTimers());

  it('stops ACP and Gateway before awaiting extension cleanup once while Computer Use finishes independently', async () => {
    vi.useFakeTimers();
    const ctx = setupQuit(false, true, true);
    ctx.quit();
    ctx.quit();
    expect(ctx.extensionRegistry.teardownAll).not.toHaveBeenCalled();
    expect(ctx.setQuitting.mock.invocationCallOrder[0]).toBeLessThan(ctx.acpChatService.stop.mock.invocationCallOrder[0]);
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).not.toHaveBeenCalled();
    ctx.acp.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    expect(ctx.extensionRegistry.teardownAll).not.toHaveBeenCalled();
    ctx.gateway.resolve();
    ctx.computerUse.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.extensionRegistry.teardownAll).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop.mock.invocationCallOrder[0]).toBeLessThan(ctx.extensionRegistry.teardownAll.mock.invocationCallOrder[0]);
    expect(ctx.app.quit).not.toHaveBeenCalled();
    ctx.extensions.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.app.quit).toHaveBeenCalledOnce();
  });

  it.each(['gateway', 'computerUse'] as const)('stops ACP before Gateway while independently awaiting %s cleanup', async (pending) => {
    vi.useFakeTimers();
    const ctx = setupQuit();
    ctx.quit();
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).not.toHaveBeenCalled();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    ctx.acp.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    ctx[pending === 'gateway' ? 'computerUse' : 'gateway'].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.app.quit).not.toHaveBeenCalled();
    ctx[pending].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.app.quit).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).not.toHaveBeenCalled();
  });

  it('keeps the Gateway alive only until its stop finishes, then permits offline extension cleanup', async () => {
    vi.useFakeTimers();
    const ctx = setupQuit();
    let gatewayRunning = true;
    ctx.gatewayManager.stop.mockImplementation(async () => {
      await ctx.gateway.promise;
      gatewayRunning = false;
    });
    ctx.extensionRegistry.teardownAll.mockImplementation(async () => {
      if (gatewayRunning) throw new Error('config.get unavailable during gateway restart');
    });
    ctx.quit();
    ctx.acp.resolve();
    ctx.computerUse.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.extensionRegistry.teardownAll).not.toHaveBeenCalled();
    ctx.gateway.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.extensionRegistry.teardownAll).toHaveBeenCalledOnce();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
    expect(ctx.app.quit).toHaveBeenCalledOnce();
  });

  it.each([false, true])('logs each stop failure (synchronous: %s) and still quits', async (synchronous) => {
    vi.useFakeTimers();
    const ctx = setupQuit();
    const error = new Error('stop failed');
    for (const owner of [ctx.acpChatService, ctx.gatewayManager, ctx.computerUseApi]) {
      owner.stop.mockImplementation(() => {
        if (synchronous) throw error;
        return Promise.reject(error);
      });
    }
    ctx.extensionRegistry.teardownAll.mockImplementation(() => {
      if (synchronous) throw error;
      return Promise.reject(error);
    });
    ctx.quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    expect(ctx.logger.warn).toHaveBeenCalledWith('AcpChatService.stop() error during quit:', error);
    expect(ctx.logger.warn).toHaveBeenCalledWith('gatewayManager.stop() error during quit:', error);
    expect(ctx.logger.warn).toHaveBeenCalledWith('cuaRuntimeManager.stop() error during quit:', error);
    expect(ctx.logger.warn).toHaveBeenCalledWith('extensionRegistry.teardownAll() error during quit:', error);
    expect(ctx.app.quit).toHaveBeenCalledOnce();
  });

  it('skips Computer Use in E2E mode', async () => {
    vi.useFakeTimers();
    const ctx = setupQuit(true);
    ctx.quit();
    ctx.acp.resolve();
    ctx.gateway.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.computerUseApi.stop).not.toHaveBeenCalled();
    expect(ctx.app.quit).toHaveBeenCalledOnce();
  });

  it('still stops Gateway and Computer Use when no ACP service exists', async () => {
    vi.useFakeTimers();
    const ctx = setupQuit(false, false);
    ctx.quit();
    ctx.gateway.resolve();
    ctx.computerUse.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.acpChatService.stop).not.toHaveBeenCalled();
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    expect(ctx.app.quit).toHaveBeenCalledOnce();
  });

  it('allows normal Gateway cleanup beyond the old five-second app quit deadline', async () => {
    vi.useFakeTimers();
    const ctx = setupQuit();
    ctx.quit();
    await vi.advanceTimersByTimeAsync(4_000);
    ctx.acp.resolve();
    ctx.computerUse.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    expect(ctx.app.quit).not.toHaveBeenCalled();
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).not.toHaveBeenCalled();
    ctx.gateway.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.app.quit).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).not.toHaveBeenCalled();
  });

  it.each(['acp', 'gateway', 'extensions'] as const)('keeps the bounded shared deadline while %s is pending without restarting cleanup', async (pending) => {
    vi.useFakeTimers();
    const ctx = setupQuit(false, true, pending === 'extensions');
    ctx.quit();
    ctx.quit();
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).not.toHaveBeenCalled();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    ctx.computerUse.resolve();
    if (pending !== 'acp') ctx.acp.resolve();
    if (pending === 'extensions') ctx.gateway.resolve();
    await vi.advanceTimersByTimeAsync(APP_QUIT_CLEANUP_TIMEOUT_MS - 1);
    expect(ctx.app.quit).not.toHaveBeenCalled();
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).toHaveBeenCalledOnce();
    expect(ctx.app.quit).toHaveBeenCalledOnce();
    ctx.quit();
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).toHaveBeenCalledTimes(pending !== 'acp' ? 1 : 0);
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    expect(ctx.extensionRegistry.teardownAll).toHaveBeenCalledTimes(pending === 'extensions' ? 1 : 0);
  });
});
