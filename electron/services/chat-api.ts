import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createAcpChatService } from './acp-chat-service';
import type { AcpSessionAccessRegistry } from './acp-session-access-registry';

export function createChatApi({
  gatewayManager,
  mainWindow,
  acpSessionAccessRegistry,
}: {
  gatewayManager: GatewayManager;
  mainWindow: BrowserWindow;
  acpSessionAccessRegistry: AcpSessionAccessRegistry;
}): CompleteHostServiceRegistry['chat'] {
  const acpChat = createAcpChatService(mainWindow, acpSessionAccessRegistry, gatewayManager);

  return {
    loadAcpSession: (payload) => acpChat.loadSession(payload),
    sendAcpPrompt: (payload) => acpChat.sendPrompt(payload),
    cancelAcpSession: (payload) => acpChat.cancelSession(payload),
    respondAcpPermission: (payload) => acpChat.respondPermission(payload),
  };
}
