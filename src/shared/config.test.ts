import { describe, expect, it } from 'vitest';
import { sanitizeConfig, type ConfigField } from './config';

interface Example {
  count: number;
  ratio: number;
  enabled: boolean;
}

const DEFAULTS: Example = { count: 5, ratio: 1.5, enabled: true };

const FIELDS: ReadonlyArray<ConfigField<keyof Example & string>> = [
  { kind: 'number', key: 'count', label: 'Count', hint: '', min: 1, max: 10, integer: true },
  { kind: 'number', key: 'ratio', label: 'Ratio', hint: '', min: 0, max: 100 },
  { kind: 'boolean', key: 'enabled', label: 'Enabled', hint: '' },
];

const sanitize = (stored: unknown) => sanitizeConfig(stored, FIELDS, DEFAULTS);

describe('sanitizeConfig', () => {
  it('takes a complete, in-range record as given', () => {
    const stored = { count: 3, ratio: 2.5, enabled: false };

    expect(sanitize(stored)).toEqual(stored);
  });

  it('fills in whatever is missing', () => {
    // An older record, written before a field existed.
    expect(sanitize({ count: 3 })).toEqual({ ...DEFAULTS, count: 3 });
  });

  it('keeps the good fields when one is unusable', () => {
    // All-or-nothing would discard settings the user did choose because of one
    // they didn't.
    expect(sanitize({ count: 3, ratio: NaN })).toEqual({ ...DEFAULTS, count: 3 });
  });

  it('rejects numeric strings, which survive arithmetic and go wrong quietly', () => {
    expect(sanitize({ count: '3' }).count).toBe(DEFAULTS.count);
  });

  it('rejects NaN and both infinities', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(sanitize({ ratio: bad }).ratio).toBe(DEFAULTS.ratio);
    }
  });

  it('clamps rather than discarding an out-of-range number', () => {
    expect(sanitize({ count: 900 }).count).toBe(10);
    expect(sanitize({ count: -900 }).count).toBe(1);
  });

  it('rounds only the fields that say a fraction is meaningless', () => {
    expect(sanitize({ count: 3.4 }).count).toBe(3);
    expect(sanitize({ ratio: 2.25 }).ratio).toBe(2.25);
  });

  it('rounds after clamping, so a bound is never overshot', () => {
    expect(sanitize({ count: 10.6 }).count).toBe(10);
  });

  it('takes only real booleans', () => {
    // "false" is truthy, and a record through a careless serializer is exactly
    // where that turns up.
    expect(sanitize({ enabled: false }).enabled).toBe(false);
    for (const bad of ['false', 0, 1, null, {}]) {
      expect(sanitize({ enabled: bad }).enabled).toBe(DEFAULTS.enabled);
    }
  });

  it('ignores keys that are not declared fields', () => {
    expect(sanitize({ ...DEFAULTS, somethingElse: 9 })).toEqual(DEFAULTS);
  });

  it('returns the defaults for input that is not an object', () => {
    for (const bad of [undefined, null, 'nonsense', 42, []]) {
      expect(sanitize(bad)).toEqual(DEFAULTS);
    }
  });

  it('does not mutate the defaults it was handed', () => {
    // They're module-level constants shared by every caller.
    sanitize({ count: 9, enabled: false });

    expect(DEFAULTS).toEqual({ count: 5, ratio: 1.5, enabled: true });
  });
});
