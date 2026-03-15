import { describe, expect, it } from 'vitest';
import { resolveSupportedLanguage } from '../../shared/language';

describe('resolveSupportedLanguage', () => {
  it('uses the base language for supported regional locales', () => {
    expect(resolveSupportedLanguage('zh-CN')).toBe('zh');
    expect(resolveSupportedLanguage('ja_JP')).toBe('ja');
    expect(resolveSupportedLanguage('en-US')).toBe('en');
  });

  it('falls back to English for unsupported locales', () => {
    expect(resolveSupportedLanguage('fr-FR')).toBe('en');
    expect(resolveSupportedLanguage('ko')).toBe('en');
  });

  it('falls back to English when locale is missing', () => {
    expect(resolveSupportedLanguage('')).toBe('en');
    expect(resolveSupportedLanguage(undefined)).toBe('en');
  });
});
