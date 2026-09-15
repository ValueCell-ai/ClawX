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
    expect(getZoomShortcutAction(input({ control: true, key: '+', code: 'Equal', shift: true }), 'win32')).toBe('in');
    expect(getZoomShortcutAction(input({ control: true, key: '=', code: 'Equal' }), 'win32')).toBe('in');
    expect(getZoomShortcutAction(input({ control: true, key: '+', code: 'NumpadAdd' }), 'win32')).toBe('in');
  });

  it('recognizes zoom out and reset shortcuts', () => {
    expect(getZoomShortcutAction(input({ control: true, key: '-', code: 'Minus' }), 'win32')).toBe('out');
    expect(getZoomShortcutAction(input({ control: true, key: '-', code: 'NumpadSubtract' }), 'win32')).toBe('out');
    expect(getZoomShortcutAction(input({ control: true, key: '0', code: 'Digit0' }), 'win32')).toBe('reset');
  });

  it('requires the platform command modifier without alt', () => {
    expect(getZoomShortcutAction(input({ key: '+', code: 'Equal' }), 'win32')).toBeNull();
    expect(getZoomShortcutAction(input({ control: true, alt: true, key: '+', code: 'Equal' }), 'win32')).toBeNull();
    expect(getZoomShortcutAction(input({ control: true, key: '+', code: 'Equal' }), 'win32')).toBe('in');
    expect(getZoomShortcutAction(input({ meta: true, key: '+', code: 'Equal' }), 'darwin')).toBe('in');
  });

  it('does not treat the Windows key as a command modifier', () => {
    expect(getZoomShortcutAction(input({ meta: true, key: '0', code: 'Digit0' }), 'win32')).toBeNull();
  });

  it('ignores key-up events so one shortcut changes zoom only once', () => {
    expect(getZoomShortcutAction(input({
      type: 'keyUp',
      control: true,
      key: '-',
      code: 'Minus',
    }), 'win32')).toBeNull();
  });
});
