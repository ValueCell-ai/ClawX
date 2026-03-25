export interface QuitLifecycleState {
  cleanupStarted: boolean;
  cleanupCompleted: boolean;
}

export type QuitLifecycleAction = 'start-cleanup' | 'cleanup-in-progress' | 'allow-quit';

export function createQuitLifecycleState(): QuitLifecycleState {
  return {
    cleanupStarted: false,
    cleanupCompleted: false,
  };
}

export function requestQuitLifecycleAction(state: QuitLifecycleState): QuitLifecycleAction {
  if (state.cleanupCompleted) {
    return 'allow-quit';
  }

  if (state.cleanupStarted) {
    return 'cleanup-in-progress';
  }

  state.cleanupStarted = true;
  return 'start-cleanup';
}

export function markQuitCleanupCompleted(state: QuitLifecycleState): void {
  state.cleanupCompleted = true;
}
