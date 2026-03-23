import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { HostEventBus } from './event-bus';
import type { Mem0Service } from '../services/mem0/service';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  mem0Service: Mem0Service;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
