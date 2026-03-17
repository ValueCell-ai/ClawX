import { describe, expect, it } from 'vitest';
import {
  consumeMainWindowReady,
  createMainWindowFocusState,
  requestSecondInstanceFocus,
} from '@electron/main/main-window-focus';

describe('main window focus coordination', () => {
  it('defers second-instance focus until the main window is ready', () => {
    const state = createMainWindowFocusState();

    expect(requestSecondInstanceFocus(state, false)).toBe('defer');
    expect(state.pendingSecondInstanceFocus).toBe(true);
    expect(consumeMainWindowReady(state)).toBe('focus');
    expect(state.pendingSecondInstanceFocus).toBe(false);
  });

  it('shows the main window normally when no second-instance focus is pending', () => {
    const state = createMainWindowFocusState();

    expect(consumeMainWindowReady(state)).toBe('show');
    expect(state.pendingSecondInstanceFocus).toBe(false);
  });

  it('focuses immediately when the main window already exists', () => {
    const state = createMainWindowFocusState();
    requestSecondInstanceFocus(state, false);

    expect(requestSecondInstanceFocus(state, true)).toBe('focus-now');
    expect(state.pendingSecondInstanceFocus).toBe(false);
  });
});
