import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';
import { createHistoryActions } from './history-actions';
import { createSessionActions } from './session-actions';

export function createSessionHistoryActions(set: ChatSet, get: ChatGet): SessionHistoryActions {
  return {
    ...createSessionActions(set, get),
    ...createHistoryActions(set, get),
  };
}
