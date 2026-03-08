import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { createRuntimeEventActions } from './runtime-event-actions';
import { createRuntimeSendActions } from './runtime-send-actions';
import { createRuntimeUiActions } from './runtime-ui-actions';

export function createRuntimeActions(set: ChatSet, get: ChatGet): RuntimeActions {
  return {
    ...createRuntimeSendActions(set, get),
    ...createRuntimeEventActions(set, get),
    ...createRuntimeUiActions(set, get),
  };
}
