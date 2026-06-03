import { dialog, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import type { HostApiContract } from '@shared/host-api/contract';

export function createDialogApi(): HostApiContract['dialog'] {
  return {
    open: (payload) => dialog.showOpenDialog(payload as OpenDialogOptions),
    message: (payload) => dialog.showMessageBox(payload as MessageBoxOptions),
  };
}
