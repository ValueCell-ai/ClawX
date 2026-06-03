import { dialog, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

export function createDialogApi(): CompleteHostServiceRegistry['dialog'] {
  return {
    open: (payload) => dialog.showOpenDialog(payload as OpenDialogOptions),
    message: (payload) => dialog.showMessageBox(payload as MessageBoxOptions),
  };
}
