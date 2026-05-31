/**
 * Electron API Type Declarations
 * Types for the APIs exposed via contextBridge
 */

export interface IpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, callback: (...args: unknown[]) => void): (() => void) | void;
  once(channel: string, callback: (...args: unknown[]) => void): void;
  off(channel: string, callback?: (...args: unknown[]) => void): void;
}

export interface ElectronAPI {
  ipcRenderer: IpcRenderer;
  openExternal: (url: string) => Promise<void>;
  getPathForFile: (file: File) => string;
  platform: NodeJS.Platform;
  isDev: boolean;
}

export type HostInvokeRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

export type HostInvokeErrorCode = 'VALIDATION' | 'UNSUPPORTED' | 'INTERNAL';

export type HostInvokeResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | {
    id?: string;
    ok: false;
    error: { code: HostInvokeErrorCode; message: string; details?: unknown };
  };

declare global {
  interface Window {
    electron: ElectronAPI;
    clawx?: {
      hostInvoke: <T = unknown>(request: HostInvokeRequest) => Promise<HostInvokeResponse<T>>;
    };
  }
}

export {};
