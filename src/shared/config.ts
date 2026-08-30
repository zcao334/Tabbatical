/**
 * Describing a stored setting once, for everything that needs to know about it.
 *
 * A setting has to be rendered as a control, validated on the way in, and
 * validated again on the way out of storage — and those three had drifted into
 * three separate statements of the same facts. Declaring the field once means
 * a new setting can't be given a bound the form enforces and the sanitizer
 * doesn't, or the reverse.
 */

export interface NumberField<K extends string> {
  kind: 'number';
  key: K;
  label: string;
  hint: string;
  min: number;
  max: number;
  /**
   * Round to a whole number.
   *
   * For fields where a fraction is not a smaller version of the thing but a
   * nonsense version of it — "review 4.5 tabs" — as opposed to a scoring
   * weight, where 4.5 is a perfectly good weight.
   */
  integer?: boolean;
}

export interface BooleanField<K extends string> {
  kind: 'boolean';
  key: K;
  label: string;
  hint: string;
}

export type ConfigField<K extends string> = NumberField<K> | BooleanField<K>;

/**
 * Coerce whatever is in storage into a usable config.
 *
 * Per-key rather than all-or-nothing: one unreadable field falls back to its
 * own default and leaves the rest as the user set them. Storage outlives any
 * single version of the extension — it survives downgrades, and a field added
 * later is simply absent from an older record — so "some of this is missing or
 * wrong" is the normal case, not a corrupt one.
 */
export function sanitizeConfig<T extends object>(
  stored: unknown,
  fields: ReadonlyArray<ConfigField<Extract<keyof T, string>>>,
  defaults: T,
): T {
  const source = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;

  const config = { ...defaults } as Record<string, unknown>;

  for (const field of fields) {
    const value = source[field.key];

    if (field.kind === 'boolean') {
      // Only a real boolean. The string "false" is truthy, and a record that
      // has been through a bad serializer is exactly where that turns up.
      if (typeof value === 'boolean') config[field.key] = value;
      continue;
    }

    // Number.isFinite rejects NaN and both infinities, and the typeof guard
    // rejects the numeric strings a hand-edited record would hold — "10" * 2
    // would otherwise compute silently and wrongly.
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;

    // Clamped rather than discarded: the intent behind an out-of-range number
    // is legible, so honour it at the limit instead of silently reverting to a
    // default the user didn't choose.
    const clamped = Math.min(Math.max(value, field.min), field.max);
    config[field.key] = field.integer ? Math.round(clamped) : clamped;
  }

  return config as T;
}
