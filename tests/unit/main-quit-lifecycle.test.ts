import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
function setupQuit(isE2EMode = false, hasAcpService = true) {
  const source = readFileSync('electron/main/index.ts', 'utf8');
  const start = source.indexOf("  app.on('before-quit',");
  const end = source.indexOf('\n  // Best-effort Gateway cleanup', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const gateway = Promise.withResolvers<void>();
  const computerUse = Promise.withResolvers<void>();
  const acp = Promise.withResolvers<void>();
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
    app, gatewayManager, computerUseApi, logger, isE2EMode, setTimeout,
    getActiveAcpChatService: () => hasAcpService ? acpChatService : null,
    setQuitting: vi.fn(),
    extensionRegistry: { teardownAll: vi.fn() },
    quitLifecycleState: createQuitLifecycleState(),
    requestQuitLifecycleAction, markQuitCleanupCompleted,
  });
  const quit = () => app.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  return { quit, app, logger, gatewayManager, computerUseApi, acpChatService, gateway, computerUse, acp };
}

describe('Main before-quit cleanup', () => {
  afterEach(() => vi.useRealTimers());

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
    ctx.quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).toHaveBeenCalledOnce();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    expect(ctx.logger.warn).toHaveBeenCalledWith('AcpChatService.stop() error during quit:', error);
    expect(ctx.logger.warn).toHaveBeenCalledWith('gatewayManager.stop() error during quit:', error);
    expect(ctx.logger.warn).toHaveBeenCalledWith('cuaRuntimeManager.stop() error during quit:', error);
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

  it.each(['acp', 'gateway'] as const)('keeps the shared five-second deadline while %s is pending without restarting cleanup', async (pending) => {
    vi.useFakeTimers();
    const ctx = setupQuit();
    ctx.quit();
    ctx.quit();
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).not.toHaveBeenCalled();
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
    if (pending === 'gateway') ctx.acp.resolve();
    await vi.advanceTimersByTimeAsync(4999);
    expect(ctx.app.quit).not.toHaveBeenCalled();
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.gatewayManager.forceTerminateOwnedProcessForQuit).toHaveBeenCalledOnce();
    expect(ctx.app.quit).toHaveBeenCalledOnce();
    ctx.quit();
    expect(ctx.acpChatService.stop).toHaveBeenCalledOnce();
    expect(ctx.gatewayManager.stop).toHaveBeenCalledTimes(pending === 'gateway' ? 1 : 0);
    expect(ctx.computerUseApi.stop).toHaveBeenCalledOnce();
  });
});
