import { describe, expect, it } from 'vitest';
import { getZoomShortcutAction } from '@electron/main/zoom-shortcuts';

function input(overrides: Partial<Electron.Input>): Electron.Input {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    isAutoRepeat: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...overrides,
  };
}

describe('zoom shortcuts', () => {
  it('recognizes zoom in from plus and equal keys', () => {
    expect(getZoomShortcutAction(input({ control: true, key: '+', code: 'Equal', shift: true }))).toBe('in');
    expect(getZoomShortcutAction(input({ control: true, key: '=', code: 'Equal' }))).toBe('in');
    expect(getZoomShortcutAction(input({ control: true, key: '+', code: 'NumpadAdd' }))).toBe('in');
  });

  it('recognizes zoom out and reset shortcuts', () => {
    expect(getZoomShortcutAction(input({ control: true, key: '-', code: 'Minus' }))).toBe('out');
    expect(getZoomShortcutAction(input({ control: true, key: '-', code: 'NumpadSubtract' }))).toBe('out');
    expect(getZoomShortcutAction(input({ control: true, key: '0', code: 'Digit0' }))).toBe('reset');
  });

  it('requires a command modifier without alt', () => {
    expect(getZoomShortcutAction(input({ key: '+', code: 'Equal' }))).toBeNull();
    expect(getZoomShortcutAction(input({ control: true, alt: true, key: '+', code: 'Equal' }))).toBeNull();
    expect(getZoomShortcutAction(input({ meta: true, key: '+', code: 'Equal' }))).toBe('in');
  });
});
