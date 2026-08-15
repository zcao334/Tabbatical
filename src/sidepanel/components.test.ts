// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createEntryRow,
  createRenderGuard,
  createRowState,
  formatDomain,
  renderEmptyState,
} from './components';

describe('createEntryRow', () => {
  it('renders title, meta and actions', () => {
    const onClick = vi.fn();
    const row = createEntryRow({
      title: 'Some Article',
      meta: 'example.com · 2h ago',
      actions: [{ label: 'Keep', onClick }],
    });

    expect(row.querySelector('.row-title')?.textContent).toBe('Some Article');
    expect(row.querySelector('.row-meta')?.textContent).toBe('example.com · 2h ago');

    const button = row.querySelector('button');
    button?.dispatchEvent(new Event('click'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('treats titles as text, never markup', () => {
    const row = createEntryRow({ title: '<img src=x onerror=alert(1)>', meta: '' });

    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.row-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('omits the badge, error and favicon unless given', () => {
    const row = createEntryRow({ title: 'T', meta: 'm' });

    expect(row.querySelector('.row-badge')).toBeNull();
    expect(row.querySelector('.row-error')).toBeNull();
    expect(row.querySelector('.row-favicon')).toBeNull();
  });

  it('renders a disabled action as non-interactive', () => {
    const onClick = vi.fn();
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      actions: [{ label: 'Archiving…', onClick, disabled: true }],
    });

    expect(row.querySelector('button')?.disabled).toBe(true);
  });

  it('highlights the matched span of a snippet', () => {
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      snippet: { text: 'fold the flour in', matchStart: 9, matchLength: 5 },
    });

    expect(row.querySelector('mark')?.textContent).toBe('flour');
    expect(row.querySelector('.row-snippet')?.textContent).toBe('fold the flour in');
  });

  it('treats snippet text as text, never markup', () => {
    // Snippet text comes from an arbitrary archived page.
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      snippet: { text: '<script>alert(1)</script> hit', matchStart: 26, matchLength: 3 },
    });

    expect(row.querySelector('script')).toBeNull();
    expect(row.querySelector('mark')?.textContent).toBe('hit');
  });

  it('degrades to plain text when snippet offsets are out of range', () => {
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      snippet: { text: 'short', matchStart: 99, matchLength: 99 },
    });

    expect(row.querySelector('.row-snippet')?.textContent).toBe('short');
    expect(row.querySelector('mark')?.textContent).toBe('');
  });

  it('drops a favicon that fails to load rather than showing a broken image', () => {
    // Archived favicon URLs are captured at archive time and can rot.
    const row = createEntryRow({ title: 'T', meta: 'm', faviconUrl: 'https://example.com/i.png' });
    const img = row.querySelector('.row-favicon');
    expect(img).not.toBeNull();

    img?.dispatchEvent(new Event('error'));
    expect(row.querySelector('.row-favicon')).toBeNull();
  });
});

describe('createRowState', () => {
  const noop = { errorMessage: 'Failed', render: () => {} };

  it('reports a row as pending only while its action runs', async () => {
    const state = createRowState<number>();
    let pendingDuring: boolean | undefined;

    expect(state.isPending(1)).toBe(false);
    await state.run(1, async () => void (pendingDuring = state.isPending(1)), noop);

    expect(pendingDuring).toBe(true);
    expect(state.isPending(1)).toBe(false);
  });

  it('re-renders when the action starts and again when it settles', async () => {
    const state = createRowState<number>();
    const render = vi.fn();

    await state.run(1, async () => {}, { errorMessage: 'Failed', render });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('records the error message when the action throws', async () => {
    const state = createRowState<number>();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await state.run(1, async () => {
      throw new Error('boom');
    }, noop);

    expect(state.errorFor(1)).toBe('Failed');
  });

  it('does not leave a row pending after a failure', async () => {
    // A stranded row would stay disabled with no way back.
    const state = createRowState<number>();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await state.run(1, async () => {
      throw new Error('boom');
    }, noop);

    expect(state.isPending(1)).toBe(false);
  });

  it('clears a previous error when the row is retried', async () => {
    const state = createRowState<number>();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await state.run(1, async () => {
      throw new Error('boom');
    }, noop);
    await state.run(1, async () => {}, noop);

    expect(state.errorFor(1)).toBeUndefined();
  });

  it('ignores a second run while the first is still in flight', async () => {
    const state = createRowState<number>();
    const action = vi.fn().mockImplementation(() => new Promise<void>(() => {}));

    void state.run(1, action, noop);
    // The guard has to hold before any await resolves: two clicks land in the
    // same task, so a check that only took effect after the first render would
    // let both through.
    expect(state.isPending(1)).toBe(true);
    void state.run(1, action, noop);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('keeps rows independent', async () => {
    const state = createRowState<number>();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await state.run(1, async () => {
      throw new Error('boom');
    }, noop);
    await state.run(2, async () => {}, noop);

    expect(state.errorFor(1)).toBe('Failed');
    expect(state.errorFor(2)).toBeUndefined();
  });
});

describe('createRenderGuard', () => {
  it('lets the only render through', () => {
    const guard = createRenderGuard();
    expect(guard.begin()()).toBe(true);
  });

  it('supersedes an older render once a newer one starts', () => {
    const guard = createRenderGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('keeps separate guards independent', () => {
    const a = createRenderGuard();
    const b = createRenderGuard();
    const fromA = a.begin();
    b.begin();

    expect(fromA()).toBe(true);
  });
});

describe('renderEmptyState', () => {
  it('replaces existing content with the message', () => {
    const list = document.createElement('ul');
    list.appendChild(document.createElement('li'));

    renderEmptyState(list, 'Nothing here.');

    expect(list.children).toHaveLength(1);
    expect(list.textContent).toBe('Nothing here.');
  });
});

describe('formatDomain', () => {
  it('strips the www prefix', () => {
    expect(formatDomain('https://www.foxnews.com/politics/story')).toBe('foxnews.com');
  });

  it('keeps other subdomains', () => {
    expect(formatDomain('https://fategrandorder.fandom.com/wiki/X')).toBe(
      'fategrandorder.fandom.com',
    );
  });

  it('keeps the scheme on browser pages, whose hostname alone is meaningless', () => {
    expect(formatDomain('chrome://extensions/')).toBe('chrome://extensions');
    expect(formatDomain('chrome://newtab/')).toBe('chrome://newtab');
    expect(formatDomain('chrome://discards/')).toBe('chrome://discards');
  });

  it('handles schemes with an authority', () => {
    expect(formatDomain('file:///Users/me/notes.pdf')).toBe('file:///Users/me/notes.pdf');
    expect(formatDomain('edge://settings/privacy')).toBe('edge://settings/privacy');
  });

  it('omits the slashes for schemes that carry an opaque path', () => {
    // about://blank isn't a URL; these schemes have no authority component.
    expect(formatDomain('about:blank')).toBe('about:blank');
    expect(formatDomain('view-source:https://example.com')).toBe(
      'view-source:https://example.com',
    );
  });

  it('falls back to the raw string for non-URLs', () => {
    expect(formatDomain('not a url')).toBe('not a url');
  });
});
