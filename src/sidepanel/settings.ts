/**
 * The scoring weights and the daily prompt, made editable.
 *
 * Staleness is the one opinion this extension holds, and it is not a very
 * defensible one — how long a tab has to sit before it is worth surfacing
 * depends entirely on how the person works. This view is where the defaults
 * stop being an assertion and become a starting point. The prompt settings sit
 * here for the same reason: an interruption the user cannot turn off is not a
 * feature, it is something to be uninstalled.
 */

import { STALENESS_WEIGHTS } from '../shared/staleness';
import { PROMPT_FIELDS } from '../shared/prompt';
import type { ConfigField, NumberField } from '../shared/config';
import {
  getPromptConfig,
  getStalenessConfig,
  resetStalenessConfig,
  savePromptConfig,
  saveStalenessConfig,
} from '../shared/storage';
import { REVIEW_STALENESS_THRESHOLD } from '../shared/review';
import type { StalenessConfig } from '../shared/types';
import { createRenderGuard } from './components';

/** Builds the label / control / hint / error scaffold every field shares. */
function createField(label: string, hint: string, control: HTMLElement): {
  field: HTMLElement;
  error: HTMLElement;
} {
  const field = document.createElement('div');
  field.className = 'setting';

  const labelEl = document.createElement('label');
  labelEl.className = 'setting-label';
  labelEl.textContent = label;
  labelEl.appendChild(control);

  const hintEl = document.createElement('p');
  hintEl.className = 'setting-hint';
  hintEl.textContent = hint;

  const error = document.createElement('p');
  error.className = 'setting-error';

  field.append(labelEl, hintEl, error);
  return { field, error };
}

/**
 * Saved on change rather than on every keystroke.
 *
 * A number field fires `input` for each character, so saving there would make
 * "15" pass through 1 on the way — re-ranking the digest to something the user
 * never asked for, and writing a value they never held. `change` fires on blur
 * and on Enter, which is when they have actually settled on a number.
 */
function createNumberField(
  spec: NumberField<string>,
  value: number,
  onSave: (value: number) => void,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'setting-input';
  input.value = String(value);
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = '1';
  input.autocomplete = 'off';
  input.dataset.setting = spec.key;

  const { field, error } = createField(spec.label, spec.hint, input);

  input.addEventListener('change', () => {
    // valueAsNumber is NaN for both an empty field and text the browser
    // refused to parse, which is exactly the set of things to reject.
    const next = input.valueAsNumber;

    if (!Number.isFinite(next)) {
      error.textContent = 'Enter a number.';
      return;
    }
    if (next < spec.min || next > spec.max) {
      error.textContent = `Must be between ${spec.min} and ${spec.max}.`;
      return;
    }

    error.textContent = '';
    onSave(next);
  });

  return field;
}

/** A checkbox has nothing to validate and no half-typed state, so it saves at once. */
function createToggleField(
  spec: { key: string; label: string; hint: string },
  checked: boolean,
  onSave: (checked: boolean) => void,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'setting-toggle';
  input.checked = checked;
  input.dataset.setting = spec.key;

  const { field } = createField(spec.label, spec.hint, input);
  input.addEventListener('change', () => onSave(input.checked));
  return field;
}

function createHeading(text: string): HTMLElement {
  const heading = document.createElement('h2');
  heading.className = 'setting-heading';
  heading.textContent = text;
  return heading;
}

/**
 * Render one config's fields, each saving only itself.
 *
 * Deliberately does not re-render after a save: the field already shows what
 * was stored, and rebuilding would move the caret out of whichever field the
 * user tabbed into next.
 */
function appendFields<T extends object>(
  container: HTMLElement,
  fields: ReadonlyArray<ConfigField<Extract<keyof T, string>>>,
  values: T,
  save: (patch: Partial<T>) => void,
): void {
  for (const field of fields) {
    const patchWith = (value: unknown) => save({ [field.key]: value } as Partial<T>);

    container.appendChild(
      field.kind === 'boolean'
        ? createToggleField(field, values[field.key] as boolean, patchWith)
        : createNumberField(field, values[field.key] as number, patchWith),
    );
  }
}

// renderSettings reads storage before it can build anything, so entering the
// view twice quickly can land two builds on the same container.
const renderGuard = createRenderGuard();

export async function renderSettings(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();
  const [config, prompt] = await Promise.all([getStalenessConfig(), getPromptConfig()]);
  if (!isCurrent()) return;

  container.innerHTML = '';

  container.appendChild(createHeading('Daily prompt'));
  appendFields(container, PROMPT_FIELDS, prompt, (patch) => savePromptConfig(patch));

  container.appendChild(createHeading('Scoring'));
  appendFields(container, STALENESS_WEIGHTS, config, (patch) => saveStalenessConfig(patch));

  const note = document.createElement('p');
  note.className = 'setting-note';
  note.textContent = `A tab counts as due for review — and toward the toolbar badge — at ${REVIEW_STALENESS_THRESHOLD} points.`;
  container.appendChild(note);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'row-button';
  reset.textContent = 'Reset scoring to defaults';
  reset.addEventListener('click', () => {
    void resetStalenessConfig().then(() => renderSettings(container));
  });
  container.appendChild(reset);
}
