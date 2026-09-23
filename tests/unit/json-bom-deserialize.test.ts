import { describe, expect, it } from 'vitest';
import { bomTolerantDeserialize } from '../../electron/utils/json-bom-deserialize';

describe('bomTolerantDeserialize', () => {
  it('parses plain JSON like JSON.parse', () => {
    expect(bomTolerantDeserialize('{"a":1}')).toEqual({ a: 1 });
    expect(bomTolerantDeserialize('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON prefixed with a UTF-8 BOM (U+FEFF)', () => {
    const bom = '\uFEFF';
    expect(bomTolerantDeserialize(`${bom}{"authGatewayUrl":"http://x"}`)).toEqual({
      authGatewayUrl: 'http://x',
    });
  });

  it('only strips a leading BOM, leaving in-body U+FEFF untouched', () => {
    // A literal BOM inside a string value must survive.
    const payload = '{"label":"\uFEFFweird"}';
    expect(bomTolerantDeserialize(`\uFEFF${payload}`)).toEqual({ label: '\uFEFFweird' });
  });

  it('throws on genuinely invalid JSON even after BOM removal', () => {
    expect(() => bomTolerantDeserialize('\uFEFF{not json')).toThrow(SyntaxError);
  });
});
