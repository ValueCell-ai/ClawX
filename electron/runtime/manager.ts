import { EventEmitter } from 'node:events';
import { getSetting, setSetting } from '@electron/utils/store';
import type {
  RuntimeCapabilities,
  RuntimeEventName,
  RuntimeKind,
  RuntimeOperationCapabilities,
  RuntimeProvider,
  RuntimeStatus,
} from './types';

export type RuntimeManagerOptions = {
  openclaw: RuntimeProvider;
  ccConnect: RuntimeProvider;
};

function normalizeRuntimeKind(value: unknown): RuntimeKind {
  return value === 'cc-connect' ? 'cc-connect' : 'openclaw';
}

export class RuntimeManager extends EventEmitter {
  private activeKind: RuntimeKind | null = null;
  private readonly providers: Record<RuntimeKind, RuntimeProvider>;

  constructor(options: RuntimeManagerOptions) {
    super();
    this.providers = {
      openclaw: options.openclaw,
      'cc-connect': options.ccConnect,
    };
    this.forwardProviderEvents(options.openclaw);
    this.forwardProviderEvents(options.ccConnect);
  }

  async getActiveKind(): Promise<RuntimeKind> {
    if (!this.activeKind) {
      const persistedKind = normalizeRuntimeKind(await getSetting('runtimeKind'));
      const devModeUnlocked = await getSetting('devModeUnlocked');
      this.activeKind = devModeUnlocked === true ? persistedKind : 'openclaw';
      if (persistedKind !== this.activeKind) {
        await setSetting('runtimeKind', this.activeKind);
      }
    }
    return this.activeKind;
  }

  getActiveProvider(): RuntimeProvider {
    return this.providers[this.activeKind ?? 'openclaw'];
  }

  getProvider(kind: RuntimeKind): RuntimeProvider {
    return this.providers[kind];
  }

  async setActiveKind(kind: RuntimeKind): Promise<void> {
    const requestedKind = normalizeRuntimeKind(kind);
    const devModeUnlocked = await getSetting('devModeUnlocked');
    const nextKind = requestedKind === 'cc-connect' && devModeUnlocked !== true
      ? 'openclaw'
      : requestedKind;
    const previous = this.getActiveProvider();
    if ((this.activeKind ?? 'openclaw') !== nextKind) {
      await previous.stop();
    }
    this.activeKind = nextKind;
    await setSetting('runtimeKind', nextKind);
    this.emit('status', this.getStatus());
  }

  listCapabilities(): RuntimeCapabilities {
    return this.getActiveProvider().listCapabilities();
  }

  listOperationCapabilities(): RuntimeOperationCapabilities {
    return this.getActiveProvider().listOperationCapabilities();
  }

  getStatus(): RuntimeStatus {
    return this.getActiveProvider().getStatus();
  }

  start(): Promise<void> {
    return this.getActiveProvider().start();
  }

  stop(): Promise<void> {
    return this.getActiveProvider().stop();
  }

  restart(): Promise<void> {
    return this.getActiveProvider().restart();
  }

  checkHealth(options?: { probe?: boolean }) {
    return this.getActiveProvider().checkHealth(options);
  }

  rpc<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    return this.getActiveProvider().rpc(method, params, timeoutMs);
  }

  private forwardProviderEvents(provider: RuntimeProvider): void {
    const events: RuntimeEventName[] = [
      'status',
      'error',
      'notification',
      'gateway:health',
      'gateway:presence',
      'chat:message',
      'chat:runtime-event',
      'channel:status',
      'exit',
    ];
    for (const eventName of events) {
      provider.on(eventName, (payload: unknown) => {
        if (provider !== this.getActiveProvider()) return;
        if (eventName === 'status' && payload && typeof payload === 'object') {
          this.emit(eventName, {
            ...(payload as Record<string, unknown>),
            runtimeKind: provider.kind,
            capabilities: provider.listCapabilities(),
            operationCapabilities: provider.listOperationCapabilities(),
          });
          return;
        }
        this.emit(eventName, payload);
      });
    }
  }
}
