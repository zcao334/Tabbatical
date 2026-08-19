// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSnoozed } from './snoozed';
import { addSnoozedTab } from '../shared/storage';
import { SNOOZE_ACTION_REQUEST } from '../shared/messages';
import type { SnoozedTab } from '../shared/types';

const NOW = new Date('2026-08-18T09:00:00Z').getTime();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let store: Record<string, unknown> = {};

const sendMessage = vi.fn(async () => ({ status: 'ok' }));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  runtime: { sendMessage },
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function entry(overrides: Partial<SnoozedTab> = {}): SnoozedTab {
  return {
    id: 'a',
    url: 'https://example.com/a',
    title: 'Page A',
    snoozedAt: NOW - HOUR,
    wakeAt: NOW + DAY,
    ...overrides,
  };
}

async function mount(seed: SnoozedTab[]): Promise<HTMLElement> {
  store = {};
  for (const item of seed) await addSnoozedTab(item);

  const container = document.createElement('ul');
  document.body.appendChild(container);
  await renderSnoozed(container);
  await flush();
  return container;
}

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLLIElement>('.entry-row'));

const labelsIn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('button')).map((button) => button.textContent);

function rowByTitle(container: HTMLElement, title: string): HTMLLIElement {
  const row = rows(container).find(
    (candidate) => candidate.querySelector('.row-title')?.textContent === title,
  );
  if (!row) throw new Error(`No row titled "${title}"`);
  return row;
}

async function click(row: HTMLElement, label: string): Promise<void> {
  const button = Array.from(row.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No "${label}" button among [${labelsIn(row).join(', ')}]`);
  button.dispatchEvent(new Event('click'));
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ status: 'ok' });
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the snoozed list', () => {
  it('explains itself when nothing is snoozed', async () => {
    const container = await mount([]);

    expect(container.textContent).toContain('Nothing snoozed');
    expect(rows(container)).toHaveLength(0);
  });

  it('orders by what comes back next, not by what was put away first', async () => {
    const container = await mount([
      entry({ id: 'later', title: 'Later', snoozedAt: NOW - 5 * DAY, wakeAt: NOW + 5 * DAY }),
      entry({ id: 'sooner', title: 'Sooner', snoozedAt: NOW, wakeAt: NOW + HOUR }),
    ]);

    expect(rows(container).map((row) => row.querySelector('.row-title')?.textContent)).toEqual([
      'Sooner',
      'Later',
    ]);
  });

  it('says when each tab returns', async () => {
    const container = await mount([entry({ wakeAt: NOW + 3 * DAY })]);

    expect(rows(container)[0].querySelector('.row-meta')?.textContent).toBe('back in 3d');
  });

  it('puts the full URL and exact return time in the hover text', async () => {
    const container = await mount([entry()]);

    expect(rows(container)[0].title).toContain('https://example.com/a');
    expect(rows(container)[0].title).toContain('Back ');
  });
});

describe('open now', () => {
  it('asks the background to wake the tab', async () => {
    const container = await mount([entry()]);
    await click(rows(container)[0], 'Open now');

    expect(sendMessage).toHaveBeenCalledWith({
      type: SNOOZE_ACTION_REQUEST,
      action: 'wake',
      id: 'a',
    });
  });

  it('reports a failure on the row', async () => {
    sendMessage.mockResolvedValueOnce({ status: 'failed' } as never);
    const container = await mount([entry()]);

    await click(rows(container)[0], 'Open now');

    expect(rows(container)[0].querySelector('.row-error')?.textContent).toBe(
      "Couldn't reopen this tab",
    );
  });
});

describe('cancelling a snooze', () => {
  it('takes two clicks, since nothing about the page was captured', async () => {
    const container = await mount([entry()]);

    await click(rows(container)[0], 'Cancel');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(labelsIn(rows(container)[0])).toEqual(['Open now', 'Cancel?']);

    await click(rows(container)[0], 'Cancel?');
    expect(sendMessage).toHaveBeenCalledWith({
      type: SNOOZE_ACTION_REQUEST,
      action: 'cancel',
      id: 'a',
    });
  });

  it('moves the confirmation when another row arms', async () => {
    const container = await mount([
      entry({ id: 'a', title: 'Page A', wakeAt: NOW + HOUR }),
      entry({ id: 'b', title: 'Page B', wakeAt: NOW + DAY }),
    ]);

    await click(rowByTitle(container, 'Page A'), 'Cancel');
    await click(rowByTitle(container, 'Page B'), 'Cancel');

    expect(labelsIn(rowByTitle(container, 'Page A'))).toEqual(['Open now', 'Cancel']);
    expect(labelsIn(rowByTitle(container, 'Page B'))).toEqual(['Open now', 'Cancel?']);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('disarms when the user opens the tab instead', async () => {
    const container = await mount([entry()]);

    await click(rows(container)[0], 'Cancel');
    await click(rows(container)[0], 'Open now');

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wake' }),
    );
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel' }),
    );
  });

  it('does not stay armed on a row that woke on its own', async () => {
    // The panel can sit open while an alarm fires underneath it.
    const container = await mount([entry({ id: 'a', title: 'Page A' })]);
    await click(rows(container)[0], 'Cancel');

    // The tab wakes and its record disappears...
    store = {};
    await renderSnoozed(container);
    await flush();

    // ...and the user snoozes the same page again, which reuses the id only
    // because this test says so — but a stale arming would surface here.
    await addSnoozedTab(entry({ id: 'a', title: 'Page A' }));
    await renderSnoozed(container);
    await flush();

    expect(labelsIn(rows(container)[0])).toEqual(['Open now', 'Cancel']);
  });
});

describe('while an action is in flight', () => {
  it('names the operation and takes the buttons away', async () => {
    let release = () => {};
    sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ status: 'ok' });
      }),
    );

    const container = await mount([entry()]);
    await click(rows(container)[0], 'Open now');

    expect(labelsIn(rows(container)[0])).toEqual(['Opening…']);
    expect(rows(container)[0].querySelector('button')?.disabled).toBe(true);

    release();
    await flush();
  });
});
