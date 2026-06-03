import type { BrowserWindow } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { syncMacTrafficLightPosition } from '../main/traffic-light-layout';

export function createWindowApi(mainWindow: BrowserWindow): CompleteHostServiceRegistry['window'] {
  return {
    syncTrafficLightPosition: (payload) => {
      syncMacTrafficLightPosition(mainWindow, payload.sidebarCollapsed);
    },
    minimize: () => {
      mainWindow.minimize();
    },
    maximize: () => {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    },
    close: () => {
      mainWindow.close();
    },
    isMaximized: () => mainWindow.isMaximized(),
  };
}
