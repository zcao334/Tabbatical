// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDigest } from './digest';
import { setTabActivity } from '../shared/storage';
import { SNOOZE_TAB_REQUEST } from '../shared/messages';
import { MS_PER_DAY, type TabActivity } from '../shared/types';

let store: Record<string, unknown> = {};

const sendMessage = vi.fn(async () => ({ status: 'snoozed', wakeAt: 0 }));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  tabGroups: { query: async () => [] },
  runtime: { sendMessage },
  permissions: { request: async () => true },
});

/** Lets queued renders and the deferred focus settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Tab ids are never reused across tests: the module holds the open picker and
 * the in-flight rows between renders, exactly as it does in the panel, so a
 * repeated id would let one test's state surface in the next.
 */
let nextTabId = 1;

async function mount(count = 1): Promise<{ container: HTMLElement; tabIds: number[] }> {
  store = {};
  const tabIds: number[] = [];

  for (let i = 0; i < count; i++) {
    const tabId = nextTabId++;
    tabIds.push(tabId);
    const activity: TabActivity = {
      tabId,
      url: `https://example.com/${tabId}`,
      title: `Tab ${tabId}`,
      // Descending idle time, so rows render in the order they were seeded.
      lastActiveAt: Date.now() - (count - i) * MS_PER_DAY,
      revisitCount: 0,
      groupId: null,
      pinned: false,
    };
    await setTabActivity(activity);
  }

  const container = document.createElement('ul');
  document.body.appendChild(container);
  await renderDigest(container);
  await flush();

  return { container, tabIds };
}

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLLIElement>('.entry-row'));

const labelsIn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('button')).map((button) => button.textContent);

async function click(row: HTMLElement, label: string): Promise<void> {
  const button = Array.from(row.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No "${label}" button among [${labelsIn(row).join(', ')}]`);
  button.dispatchEvent(new Event('click'));
  await flush();
}

async function typeCustomDuration(row: HTMLElement, value: string): Promise<void> {
  const input = row.querySelector<HTMLInputElement>('.row-input');
  const form = row.querySelector('form');
  if (!input || !form) throw new Error('The custom duration field is not open');
  input.value = value;
  form.dispatchEvent(new Event('submit'));
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ status: 'snoozed', wakeAt: 0 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('digest actions', () => {
  it('offers keep, snooze and archive on a row at rest', async () => {
    const { container } = await mount();

    expect(labelsIn(rows(container)[0])).toEqual(['Keep', 'Snooze', 'Archive']);
  });
});

describe('the snooze picker', () => {
  it('replaces the row actions with durations', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');

    // The panel is too narrow for a floating menu, so the picker takes over
    // the row rather than opening beside it.
    expect(labelsIn(rows(container)[0])).toEqual(['1 day', '1 week', 'Custom', 'Cancel']);
  });

  it('drops the staleness line, which the durations would otherwise overlap', async () => {
    const { container } = await mount();
    expect(rows(container)[0].querySelector('.row-meta')?.textContent).not.toBe('');

    await click(rows(container)[0], 'Snooze');

    expect(rows(container)[0].querySelector('.row-meta')?.textContent).toBe('');
  });

  it('keeps the staleness line in one truncatable piece, so no digit is lost', async () => {
    // Held as fixed segments, the tail was clipped mid-number and "score 50"
    // rendered as a perfectly plausible "score 5".
    const { container } = await mount();
    const meta = rows(container)[0].querySelector('.row-meta');

    expect(meta?.querySelectorAll('span')).toHaveLength(1);
    expect(meta?.textContent).toMatch(/idle · revisited 0x · score \d+$/);
  });

  it('puts the full line and the URL in the hover text', async () => {
    const { container } = await mount();

    expect(rows(container)[0].title).toContain('https://example.com/');
    expect(rows(container)[0].title).toMatch(/score \d+/);
  });

  it('brings the staleness line back on cancel', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Cancel');

    expect(rows(container)[0].querySelector('.row-meta')?.textContent).toMatch(/revisited/);
  });

  it('sends the chosen preset to the background', async () => {
    const { container, tabIds } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], '1 week');

    expect(sendMessage).toHaveBeenCalledWith({
      type: SNOOZE_TAB_REQUEST,
      tabId: tabIds[0],
      durationMs: 7 * MS_PER_DAY,
    });
  });

  it('backs out on cancel', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Cancel');

    expect(labelsIn(rows(container)[0])).toEqual(['Keep', 'Snooze', 'Archive']);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('moves to another row rather than opening twice', async () => {
    const { container } = await mount(2);
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[1], 'Snooze');

    expect(labelsIn(rows(container)[0])).toEqual(['Keep', 'Snooze', 'Archive']);
    expect(labelsIn(rows(container)[1])).toContain('1 day');
  });

  it('does not reopen on a later tab that inherits the same id', async () => {
    // Chrome recycles tab ids. A picker left armed on a closed tab would
    // otherwise spring open on whatever unrelated page next holds that id.
    const { container, tabIds } = await mount();
    await click(rows(container)[0], 'Snooze');

    const recycledId = tabIds[0];
    const seed = async (title: string, tabId: number) => {
      store = {};
      await setTabActivity({
        tabId,
        url: `https://example.com/${title}`,
        title,
        lastActiveAt: Date.now(),
        revisitCount: 0,
        groupId: null,
        pinned: false,
      });
      await renderDigest(container);
      await flush();
    };

    // The armed tab closes...
    await seed('Unrelated', nextTabId++);
    // ...and Chrome hands its id to something else.
    await seed('Recycled', recycledId);

    expect(rows(container)[0].querySelector('.row-title')?.textContent).toBe('Recycled');
    expect(labelsIn(rows(container)[0])).toEqual(['Keep', 'Snooze', 'Archive']);
  });
});

describe('a custom snooze duration', () => {
  it('swaps the presets for a field', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Custom');

    expect(rows(container)[0].querySelector('.row-input')).not.toBeNull();
    expect(labelsIn(rows(container)[0])).toEqual(['Snooze', 'Cancel']);
  });

  it('leaves the staleness line out for the custom field too', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Custom');

    expect(rows(container)[0].querySelector('.row-meta')?.textContent).toBe('');
  });

  it('sends the parsed duration', async () => {
    const { container, tabIds } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Custom');
    await typeCustomDuration(rows(container)[0], '90m');

    expect(sendMessage).toHaveBeenCalledWith({
      type: SNOOZE_TAB_REQUEST,
      tabId: tabIds[0],
      durationMs: 90 * 60_000,
    });
  });

  it('explains a duration it cannot read, without discarding what was typed', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Custom');
    await typeCustomDuration(rows(container)[0], 'tomorrow');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(rows(container)[0].querySelector('.row-hint')?.textContent).toMatch(/30m/);
    // Re-rendering the row to report the error would take the text with it.
    expect(rows(container)[0].querySelector<HTMLInputElement>('.row-input')?.value).toBe('tomorrow');
  });

  it('rejects a duration Chrome would throttle', async () => {
    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], 'Custom');
    await typeCustomDuration(rows(container)[0], '10s');

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('while a snooze is in flight', () => {
  it('names the operation and takes the buttons away', async () => {
    // "Archiving…" on a row that is snoozing would be worse than no label.
    let release = () => {};
    sendMessage.mockReturnValueOnce(new Promise((resolve) => {
      release = () => resolve({ status: 'snoozed', wakeAt: 0 });
    }));

    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], '1 day');

    expect(labelsIn(rows(container)[0])).toEqual(['Snoozing…']);
    expect(rows(container)[0].querySelector('button')?.disabled).toBe(true);

    release();
    await flush();
  });

  it('reports a failure on the row and gives the actions back', async () => {
    sendMessage.mockResolvedValueOnce({ status: 'failed' } as never);

    const { container } = await mount();
    await click(rows(container)[0], 'Snooze');
    await click(rows(container)[0], '1 day');

    expect(rows(container)[0].querySelector('.row-error')?.textContent).toBe("Couldn't snooze");
    expect(labelsIn(rows(container)[0])).toEqual(['Keep', 'Snooze', 'Archive']);
  });
});
