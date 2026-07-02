import { describe, it, expect } from 'vitest';
import { stripProcessMessagePrefix } from '../../src/pages/Chat/message-utils';

describe('stripProcessMessagePrefix — regex edge cases (#1128)', () => {
  it('handles segments with regex special characters without throwing', () => {
    const text = 'Hello (world) + test * value [array]';
    const segments = ['Hello (world) + test'];
    // Should strip the matching prefix and return the remainder
    const result = stripProcessMessagePrefix(text, segments);
    expect(result).toBe('* value [array]');
  });

  it('handles segments with lone surrogates without crashing', () => {
    // Lone surrogate — in some environments this would cause SyntaxError with 'u' flag.
    // In current Node.js it matches; either way the function must not throw.
    const textWithSurrogate = '\uD800 rest of text';
    const segments = ['\uD800'];
    const result = stripProcessMessagePrefix(textWithSurrogate, segments);
    // Function must return a string (not throw)
    expect(typeof result).toBe('string');
    // Either strips the surrogate (match) or returns original (catch fallback)
    expect([textWithSurrogate, 'rest of text']).toContain(result);
  });

  it('handles segments with emoji and surrogate pairs normally', () => {
    const text = '🎉 celebration time';
    const segments = ['🎉 celebration'];
    // Valid surrogate pairs should work, stripping the prefix
    const result = stripProcessMessagePrefix(text, segments);
    expect(result).toBe('time');
  });

  it('still strips valid prefix normally', () => {
    const text = 'Hello world this is the rest';
    const segments = ['Hello world'];
    const result = stripProcessMessagePrefix(text, segments);
    expect(result).toBe('this is the rest');
  });

  it('returns original text when no match', () => {
    const text = 'Something completely different';
    const segments = ['No match here'];
    const result = stripProcessMessagePrefix(text, segments);
    expect(result).toBe('Something completely different');
  });
});
