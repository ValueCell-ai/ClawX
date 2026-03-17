export interface MainWindowFocusState {
  pendingSecondInstanceFocus: boolean;
}

export type SecondInstanceFocusRequest = 'focus-now' | 'defer';
export type MainWindowReadyAction = 'show' | 'focus';

export function createMainWindowFocusState(): MainWindowFocusState {
  return {
    pendingSecondInstanceFocus: false,
  };
}

export function requestSecondInstanceFocus(
  state: MainWindowFocusState,
  hasFocusableMainWindow: boolean,
): SecondInstanceFocusRequest {
  if (hasFocusableMainWindow) {
    state.pendingSecondInstanceFocus = false;
    return 'focus-now';
  }

  state.pendingSecondInstanceFocus = true;
  return 'defer';
}

export function consumeMainWindowReady(state: MainWindowFocusState): MainWindowReadyAction {
  if (state.pendingSecondInstanceFocus) {
    state.pendingSecondInstanceFocus = false;
    return 'focus';
  }

  return 'show';
}

export function clearPendingSecondInstanceFocus(state: MainWindowFocusState): void {
  state.pendingSecondInstanceFocus = false;
}
