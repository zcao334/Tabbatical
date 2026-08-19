// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createArmedRow,
  createEntryRow,
  createRenderGuard,
  createRowState,
  renderEmptyState,
  renderLoadingState,
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

  it('puts the meta line in a span that can truncate on its own', () => {
    // The badge sits in the same row and must not shrink with the text.
    const row = createEntryRow({ title: 'T', meta: 'example.com · 2h ago' });

    expect(row.querySelector('.row-meta-text')?.textContent).toBe('example.com · 2h ago');
  });

  it('renders no meta text at all when there is none', () => {
    // An empty string is how the digest hides the line while its snooze
    // picker is open; a stray empty span would still take up the row.
    const row = createEntryRow({ title: 'T', meta: '' });

    expect(row.querySelector('.row-meta-text')).toBeNull();
    expect(row.querySelector('.row-meta')?.textContent).toBe('');
  });

  it('keeps the badge off the title line, so the title gets the full width', () => {
    const row = createEntryRow({ title: 'T', meta: 'example.com · 2h ago', badge: 'metadata only' });

    expect(row.querySelector('.row-title')?.querySelector('.row-badge')).toBeNull();
    expect(row.querySelector('.row-meta')?.querySelector('.row-badge')).not.toBeNull();
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

  it('places a control between the text and the buttons', () => {
    const control = document.createElement('form');
    control.className = 'row-form';
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      control,
      actions: [{ label: 'Cancel', onClick: () => {} }],
    });

    const children = Array.from(row.children).map((child) => child.className);
    expect(children).toEqual(['row-info', 'row-form', 'row-actions']);
  });

  it('renders a control as given, so it can own input state a row cannot', () => {
    const control = document.createElement('input');
    control.value = 'typed';

    const row = createEntryRow({ title: 'T', meta: 'm', control });

    expect(row.querySelector('input')?.value).toBe('typed');
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

  it('reports which operation is in flight', async () => {
    // A row hosting more than one action needs the right verb: "Archiving…" on
    // a row that is snoozing is worse than no label.
    const state = createRowState<number, string>();
    let labelDuring: string | undefined;

    await state.run(1, async () => void (labelDuring = state.pendingFor(1)), {
      errorMessage: 'Failed',
      pending: 'Snoozing…',
      render: () => {},
    });

    expect(labelDuring).toBe('Snoozing…');
    expect(state.pendingFor(1)).toBeUndefined();
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

describe('createArmedRow', () => {
  it('starts with nothing armed', () => {
    const armed = createArmedRow<string>();
    expect(armed.isArmed('a')).toBe(false);
  });

  it('arms one row at a time', () => {
    // Two rows both waiting on a confirmation is a worse state than losing the
    // first one.
    const armed = createArmedRow<string>();

    armed.arm('a');
    armed.arm('b');

    expect(armed.isArmed('a')).toBe(false);
    expect(armed.isArmed('b')).toBe(true);
  });

  it('disarms on clear', () => {
    const armed = createArmedRow<string>();
    armed.arm('a');

    armed.clear();

    expect(armed.isArmed('a')).toBe(false);
  });

  it('carries a detail for the armed row only', () => {
    const armed = createArmedRow<number, 'presets' | 'custom'>();

    armed.arm(1, 'custom');

    expect(armed.detailFor(1)).toBe('custom');
    expect(armed.detailFor(2)).toBeUndefined();
  });

  it('replaces the detail when the same row re-arms', () => {
    const armed = createArmedRow<number, 'presets' | 'custom'>();

    armed.arm(1, 'presets');
    armed.arm(1, 'custom');

    expect(armed.detailFor(1)).toBe('custom');
  });

  it('forgets the detail once cleared', () => {
    const armed = createArmedRow<number, 'presets' | 'custom'>();
    armed.arm(1, 'custom');

    armed.clear();

    expect(armed.detailFor(1)).toBeUndefined();
  });
});

describe('the row action bar', () => {
  it('gives the buttons a bar of their own, off the title’s line', () => {
    // The title shares its line with nothing, so it has the full row width to
    // truncate in — three buttons beside it left room for about eight
    // characters.
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      actions: [
        { label: 'Keep', onClick: () => {} },
        { label: 'Snooze', onClick: () => {} },
        { label: 'Archive', onClick: () => {} },
      ],
    });

    const bar = row.querySelector('.row-actions');
    expect(bar?.querySelectorAll('.row-button')).toHaveLength(3);
    expect(row.querySelector('.row-info > .row-button')).toBeNull();
  });

  it('adds no bar when a row has no actions', () => {
    const row = createEntryRow({ title: 'T', meta: 'm' });

    expect(row.querySelector('.row-actions')).toBeNull();
  });

  it('keeps each action’s own class inside the bar', () => {
    const row = createEntryRow({
      title: 'T',
      meta: 'm',
      actions: [{ label: 'Delete?', className: 'row-button row-button--danger', onClick: () => {} }],
    });

    expect(row.querySelector('.row-actions .row-button--danger')).not.toBeNull();
  });

  it('still wires clicks through the bar', () => {
    const onClick = vi.fn();
    const row = createEntryRow({ title: 'T', meta: 'm', actions: [{ label: 'Keep', onClick }] });

    row.querySelector<HTMLButtonElement>('.row-actions .row-button')?.click();

    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('renderLoadingState', () => {
  it('replaces whatever the list was showing', () => {
    const container = document.createElement('ul');
    container.appendChild(createEntryRow({ title: 'Stale', meta: 'm' }));

    renderLoadingState(container);

    expect(container.querySelectorAll('.entry-row')).toHaveLength(0);
    expect(container.querySelectorAll('.loading-state')).toHaveLength(1);
  });

  it('announces itself, so the wait is not silent', () => {
    const container = document.createElement('ul');

    renderLoadingState(container);

    expect(container.querySelector('.loading-state')?.getAttribute('role')).toBe('status');
  });

  it('takes a message for the view that knows what is loading', () => {
    const container = document.createElement('ul');

    renderLoadingState(container, 'Loading your archive…');

    expect(container.querySelector('.loading-state')?.textContent).toBe('Loading your archive…');
  });
});
