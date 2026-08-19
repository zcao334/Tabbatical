/**
 * The scoring weights, made editable.
 *
 * Staleness is the one opinion this extension holds, and it is not a very
 * defensible one — how long a tab has to sit before it is worth surfacing
 * depends entirely on how the person works. This view is where the defaults
 * stop being an assertion and become a starting point.
 */

import { STALENESS_WEIGHTS, type StalenessWeight } from '../shared/staleness';
import { getStalenessConfig, resetStalenessConfig, saveStalenessConfig } from '../shared/storage';
import { REVIEW_STALENESS_THRESHOLD } from '../shared/review';
import type { StalenessConfig } from '../shared/types';
import { createRenderGuard } from './components';

/**
 * Saved on change rather than on every keystroke.
 *
 * A number field fires `input` for each character, so saving there would make
 * "15" pass through 1 on the way — re-ranking the digest to something the user
 * never asked for, and writing a value they never held. `change` fires on blur
 * and on Enter, which is when they have actually settled on a number.
 */
function createWeightField(
  weight: StalenessWeight,
  value: number,
  onSave: (value: number) => void,
): HTMLElement {
  const field = document.createElement('div');
  field.className = 'setting';

  const label = document.createElement('label');
  label.className = 'setting-label';
  label.textContent = weight.label;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'setting-input';
  input.value = String(value);
  input.min = String(weight.min);
  input.max = String(weight.max);
  input.step = '1';
  input.autocomplete = 'off';
  label.appendChild(input);

  const hint = document.createElement('p');
  hint.className = 'setting-hint';
  hint.textContent = weight.hint;

  const error = document.createElement('p');
  error.className = 'setting-error';

  field.append(label, hint, error);

  input.addEventListener('change', () => {
    // valueAsNumber is NaN for both an empty field and text the browser
    // refused to parse, which is exactly the set of things to reject.
    const next = input.valueAsNumber;

    if (!Number.isFinite(next)) {
      error.textContent = 'Enter a number.';
      return;
    }
    if (next < weight.min || next > weight.max) {
      error.textContent = `Must be between ${weight.min} and ${weight.max}.`;
      return;
    }

    error.textContent = '';
    onSave(next);
  });

  return field;
}

// renderSettings reads storage before it can build anything, so entering the
// view twice quickly can land two builds on the same container.
const renderGuard = createRenderGuard();

export async function renderSettings(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();
  const config = await getStalenessConfig();
  if (!isCurrent()) return;

  container.innerHTML = '';

  for (const weight of STALENESS_WEIGHTS) {
    container.appendChild(
      createWeightField(weight, config[weight.key], (value) => {
        // Deliberately not re-rendering afterwards: the field already shows
        // what was saved, and rebuilding would move the caret out of whichever
        // field the user tabbed into next.
        void saveStalenessConfig({ [weight.key]: value } as Partial<StalenessConfig>);
      }),
    );
  }

  const note = document.createElement('p');
  note.className = 'setting-note';
  note.textContent = `A tab counts as due for review — and toward the toolbar badge — at ${REVIEW_STALENESS_THRESHOLD} points.`;
  container.appendChild(note);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'row-button';
  reset.textContent = 'Reset to defaults';
  reset.addEventListener('click', () => {
    void resetStalenessConfig().then(() => renderSettings(container));
  });
  container.appendChild(reset);
}
