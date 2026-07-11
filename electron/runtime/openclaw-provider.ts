import { EventEmitter } from 'node:events';
import type { GatewayManager } from '../gateway/manager';
import type {
  RuntimeControlUiPayload,
  RuntimeProvider,
  RuntimeConfigRefreshPayload,
  RuntimeSendWithMediaPayload,
} from './types';
import {
  OPENCLAW_RUNTIME_CAPABILITIES,
  withRuntimeStatus,
} from './types';
import { getRuntimeOperationCapabilities } from './rpc-contract';
import { createChatSendWithMediaHandler } from '../services/chat-api';
import {
  createOpenClawCronJob,
  deleteOpenClawCronJob,
  listCronJobs,
  toggleOpenClawCronJob,
  triggerOpenClawCronJob,
  updateOpenClawCronJob,
} from '../services/cron-api';
import { createSessionsApi } from '../services/sessions-api';
import { logger } from '../utils/logger';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { PORTS } from '../utils/config';
import { scheduleControlUiDeviceAutoApproval } from '../utils/control-ui-device-pairing';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { getSetting } from '../utils/store';
import type { OpenClawDoctorMode } from '@shared/host-api/contract';

export class OpenClawRuntimeProvider extends EventEmitter implements RuntimeProvider {
  readonly kind = 'openclaw' as const;
  private readonly sessionsApi = createSessionsApi();

  constructor(private readonly gatewayManager: GatewayManager) {
    super();
    const forward = (eventName: string) => (payload: unknown) => {
      this.emit(eventName, payload);
    };
    for (const eventName of [
      'status',
      'error',
      'notification',
      'gateway:health',
      'gateway:presence',
      'chat:message',
      'chat:runtime-event',
      'channel:status',
      'exit',
    ]) {
      this.gatewayManager.on(eventName, forward(eventName));
    }
  }

  listCapabilities() {
    return OPENCLAW_RUNTIME_CAPABILITIES;
  }

  listOperationCapabilities() {
    return getRuntimeOperationCapabilities(this.kind);
  }

  getStatus() {
    return withRuntimeStatus(
      this.gatewayManager.getStatus(),
      this.kind,
      this.listCapabilities(),
      undefined,
      this.listOperationCapabilities(),
    );
  }

  start() {
    return this.gatewayManager.start();
  }

  stop() {
    return this.gatewayManager.stop();
  }

  restart() {
    return this.gatewayManager.restart();
  }

  checkHealth(options?: { probe?: boolean }) {
    return this.gatewayManager.checkHealth(options);
  }

  rpc<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    switch (method) {
      case 'cron.list':
        return listCronJobs(this.gatewayManager) as Promise<T>;
      case 'cron.create':
      case 'cron.add':
        return createOpenClawCronJob(this.gatewayManager, params as never) as Promise<T>;
      case 'cron.update': {
        const body = params && typeof params === 'object' ? params as Record<string, unknown> : {};
        if ('input' in body) {
          return updateOpenClawCronJob(this.gatewayManager, body as never) as Promise<T>;
        }
        return this.gatewayManager.rpc(method, params, timeoutMs);
      }
      case 'cron.delete':
      case 'cron.remove':
        return deleteOpenClawCronJob(this.gatewayManager, params) as Promise<T>;
      case 'cron.toggle':
        return toggleOpenClawCronJob(this.gatewayManager, params as never) as Promise<T>;
      case 'cron.run':
        return triggerOpenClawCronJob(this.gatewayManager, params) as Promise<T>;
      case 'runtime.controlUi':
        return this.getControlUi(params as never) as Promise<T>;
      case 'sessions.rename':
      case 'session.rename':
        return this.sessionsApi.rename(params as never) as Promise<T>;
      default:
        return this.gatewayManager.rpc(method, params, timeoutMs);
    }
  }

  async sendMessageWithMedia(payload: RuntimeSendWithMediaPayload) {
    const handler = createChatSendWithMediaHandler(this.gatewayManager, logger);
    const response = await handler(payload);
    if (!response.success) {
      throw new Error(response.error || 'OpenClaw chat send failed');
    }
    return response.result ?? {};
  }

  async listSessions(payload?: unknown) {
    return await this.sessionsApi.summaries(payload as never);
  }

  async loadHistory(payload?: unknown) {
    return await this.sessionsApi.history(payload as never);
  }

  async deleteSession(payload?: unknown) {
    return await this.sessionsApi.delete(payload as never);
  }

  async listLogs() {
    return { content: logger.getRecentLogs().join('\n') };
  }

  runDoctor(mode: OpenClawDoctorMode) {
    return mode === 'fix' ? runOpenClawDoctorFix() : runOpenClawDoctor();
  }

  async refreshConfig(payload: RuntimeConfigRefreshPayload): Promise<void> {
    if (this.gatewayManager.getStatus().state === 'stopped') return;
    if (payload.forceRestart) {
      this.gatewayManager.debouncedRestart(150);
      return;
    }
    this.gatewayManager.debouncedReload(150);
  }

  async getControlUi(payload?: RuntimeControlUiPayload) {
    if (!this.listCapabilities().controlUi) {
      return { success: false, error: 'openclaw runtime does not support Control UI' };
    }
    const token = await getSetting('gatewayToken');
    const port = this.getStatus().port || PORTS.OPENCLAW_GATEWAY;
    const url = buildOpenClawControlUiUrl(port, token, { view: payload?.view });
    scheduleControlUiDeviceAutoApproval(this.gatewayManager);
    return { success: true, url, token, port };
  }
}
