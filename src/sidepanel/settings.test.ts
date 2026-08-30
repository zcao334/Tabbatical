// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSettings } from './settings';
import { savePromptConfig, saveStalenessConfig } from '../shared/storage';
import { STALENESS_WEIGHTS } from '../shared/staleness';
import { DEFAULT_PROMPT_CONFIG } from '../shared/prompt';
import { DEFAULT_STALENESS_CONFIG } from '../shared/types';

let store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderSettings(container);
  await flush();
  return container;
}

const fields = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('.setting-input'));

/**
 * By name rather than by position: the form has more than one section now, so
 * an index would silently point at a different field as sections are added.
 */
function fieldFor(container: HTMLElement, key: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`[data-setting="${key}"]`);
  if (!input) throw new Error(`No field named "${key}"`);
  return input;
}

const weightFields = (container: HTMLElement) =>
  STALENESS_WEIGHTS.map((weight) => fieldFor(container, weight.key));

function errorFor(input: HTMLInputElement): string {
  return input.closest('.setting')?.querySelector('.setting-error')?.textContent ?? '';
}

/** Type into a field and commit it the way blurring or pressing Enter would. */
async function enter(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('change'));
  await flush();
}

const savedConfig = () => store.stalenessConfig as Record<string, number> | undefined;

beforeEach(() => {
  store = {};
  document.body.innerHTML = '';
});

describe('renderSettings', () => {
  it('shows a field for every weight', async () => {
    const container = await mount();

    expect(weightFields(container)).toHaveLength(STALENESS_WEIGHTS.length);
  });

  it('starts from the stored weights, not the defaults', async () => {
    await saveStalenessConfig({ idleDayWeight: 20 });

    const container = await mount();

    expect(fieldFor(container, 'idleDayWeight').value).toBe('20');
  });

  it('starts from the defaults when nothing is stored', async () => {
    const container = await mount();

    expect(fieldFor(container, 'idleDayWeight').value).toBe(
      String(DEFAULT_STALENESS_CONFIG.idleDayWeight),
    );
  });

  it('carries each weight’s bounds onto its field', async () => {
    // Without these the browser offers no spinner limits and no native
    // validation — the check in the handler would be the only guard.
    const container = await mount();

    for (const weight of STALENESS_WEIGHTS) {
      expect(fieldFor(container, weight.key).min).toBe(String(weight.min));
      expect(fieldFor(container, weight.key).max).toBe(String(weight.max));
    }
  });
});

describe('saving', () => {
  it('saves a committed value', async () => {
    const container = await mount();

    await enter(fieldFor(container, 'idleDayWeight'), '20');

    expect(savedConfig()?.idleDayWeight).toBe(20);
  });

  it('does not save on every keystroke', async () => {
    // Typing "15" passes through 1, which would re-rank the digest to an
    // order the user never asked for.
    const container = await mount();
    const input = fieldFor(container, 'idleDayWeight');

    input.value = '1';
    input.dispatchEvent(new Event('input'));
    await flush();

    expect(savedConfig()).toBeUndefined();
  });

  it('leaves the other weights untouched', async () => {
    const container = await mount();

    await enter(fieldFor(container, 'idleDayWeight'), '20');

    expect(savedConfig()).toEqual({ ...DEFAULT_STALENESS_CONFIG, idleDayWeight: 20 });
  });

  it('accepts a value sitting exactly on a bound', async () => {
    const container = await mount();
    const weight = STALENESS_WEIGHTS[0];

    await enter(fieldFor(container, weight.key), String(weight.max));

    expect(savedConfig()?.[weight.key]).toBe(weight.max);
  });

  it('saves zero rather than treating it as empty', async () => {
    const container = await mount();

    await enter(fieldFor(container, 'revisitWeight'), '0');

    expect(savedConfig()?.revisitWeight).toBe(0);
  });
});

describe('rejecting bad input', () => {
  it('refuses an empty field and says so', async () => {
    const container = await mount();
    const input = fieldFor(container, 'idleDayWeight');

    await enter(input, '');

    expect(savedConfig()).toBeUndefined();
    expect(errorFor(input)).not.toBe('');
  });

  it('refuses a value above the maximum', async () => {
    const container = await mount();
    const input = fieldFor(container, 'idleDayWeight');

    await enter(input, '10000');

    expect(savedConfig()).toBeUndefined();
    expect(errorFor(input)).toContain('between');
  });

  it('refuses a negative weight', async () => {
    const container = await mount();
    const input = fieldFor(container, 'idleDayWeight');

    await enter(input, '-5');

    expect(savedConfig()).toBeUndefined();
    expect(errorFor(input)).toContain('between');
  });

  it('keeps what was typed on screen rather than reverting it', async () => {
    // Rebuilding the field would discard the number mid-correction.
    const container = await mount();
    const input = fieldFor(container, 'idleDayWeight');

    await enter(input, '10000');

    expect(input.value).toBe('10000');
  });

  it('clears the error once a good value follows', async () => {
    const container = await mount();
    const input = fieldFor(container, 'idleDayWeight');

    await enter(input, '10000');
    await enter(input, '20');

    expect(errorFor(input)).toBe('');
    expect(savedConfig()?.idleDayWeight).toBe(20);
  });

  it('reports the error only on the field that has one', async () => {
    const container = await mount();

    await enter(fieldFor(container, 'idleDayWeight'), '10000');

    expect(errorFor(fieldFor(container, 'revisitWeight'))).toBe('');
  });
});

describe('reset', () => {
  const resetButton = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reset scoring to defaults',
    )!;

  it('restores the defaults in storage', async () => {
    await saveStalenessConfig({ idleDayWeight: 20 });
    const container = await mount();

    resetButton(container).click();
    await flush();

    expect(savedConfig()).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('puts the restored values back on the fields', async () => {
    // Without the re-render the form would still show the old numbers while
    // the digest ranked by the new ones.
    await saveStalenessConfig({ idleDayWeight: 20 });
    const container = await mount();

    resetButton(container).click();
    await flush();

    expect(fieldFor(container, 'idleDayWeight').value).toBe(
      String(DEFAULT_STALENESS_CONFIG.idleDayWeight),
    );
  });

  it('leaves one reset button after re-rendering', async () => {
    // The re-render rebuilds the container, so a stale button here would mean
    // the form was appended to rather than replaced.
    const container = await mount();

    resetButton(container).click();
    await flush();

    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});

describe('the daily prompt settings', () => {
  const savedPrompt = () => store.promptConfig as Record<string, unknown> | undefined;
  const toggle = (container: HTMLElement) => fieldFor(container, 'enabled');

  it('shows the prompt as on by default', async () => {
    const container = await mount();

    expect(toggle(container).checked).toBe(true);
  });

  it('reflects the prompt having been turned off', async () => {
    await savePromptConfig({ enabled: false });

    const container = await mount();

    expect(toggle(container).checked).toBe(false);
  });

  it('turns the prompt off', async () => {
    const container = await mount();

    toggle(container).checked = false;
    toggle(container).dispatchEvent(new Event('change'));
    await flush();

    expect(savedPrompt()?.enabled).toBe(false);
  });

  it('saves the batch size', async () => {
    const container = await mount();

    await enter(fieldFor(container, 'batchSize'), '10');

    expect(savedPrompt()?.batchSize).toBe(10);
  });

  it('refuses a batch size beyond what anyone would finish', async () => {
    const container = await mount();
    const input = fieldFor(container, 'batchSize');

    await enter(input, '500');

    expect(savedPrompt()).toBeUndefined();
    expect(errorFor(input)).toContain('between');
  });

  it('keeps the prompt settings out of the scoring config', async () => {
    // Two different stored records: resetting the weights must not silence
    // the prompt, and turning the prompt off must not disturb the ranking.
    const container = await mount();

    await enter(fieldFor(container, 'batchSize'), '10');

    expect(savedConfig()).toBeUndefined();
    expect(savedPrompt()?.batchSize).toBe(10);
  });

  it('survives a scoring reset with the prompt untouched', async () => {
    await savePromptConfig({ enabled: false });
    const container = await mount();

    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Reset scoring to defaults')!
      .click();
    await flush();

    expect(savedPrompt()?.enabled).toBe(false);
    expect(savedConfig()).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('leaves the batch default as something finishable', async () => {
    expect(DEFAULT_PROMPT_CONFIG.batchSize).toBeLessThanOrEqual(10);
  });
});
