/**
 * Shared building blocks for the side panel's lists.
 *
 * The digest and the archive render the same shape — a favicon, a title, a
 * metadata line, and a row of actions — from different data, and both rebuild
 * asynchronously. Keeping that shape in one place is what stops the two views
 * from drifting apart as search (#6) and restore (#7) land on the archive.
 */

import type { Snippet } from '../shared/types';

export interface RowAction {
  label: string;
  onClick: () => void;
  /** Rendered disabled and non-interactive; used for in-flight states. */
  disabled?: boolean;
  className?: string;
}

export interface RowOptions {
  title: string;
  /**
   * Secondary line under the title — staleness for the digest, source and date
   * for the archive.
   *
   * Given as segments, only the first of which is allowed to shrink. In a side
   * panel this line runs out of room constantly, and a single string truncates
   * from the right, which drops the timestamp — the part that changes and so
   * the part worth reading. Put the expendable segment first.
   */
  meta: string | string[];
  faviconUrl?: string;
  /** Small label beside the title, e.g. marking an entry as metadata-only. */
  badge?: string;
  /** Matched page text with the search term highlighted. */
  snippet?: Snippet;
  /** Error text shown under the row, e.g. a failed archive. */
  error?: string;
  /**
   * Extra element between the text and the buttons — the snooze duration field
   * is the one user of this. Passed in already built rather than described
   * declaratively, because a control that owns its own input state is exactly
   * the thing a rebuilt-from-options row can't describe.
   */
  control?: HTMLElement;
  actions?: RowAction[];
}

/**
 * A snippet with its matched term marked.
 *
 * Built from three text nodes rather than an innerHTML string with <mark> tags
 * spliced in: this text comes from an arbitrary archived page, and the offsets
 * come from a user-typed query, so neither is safe to treat as markup. Offsets
 * are clamped because a malformed Snippet should degrade to plain text rather
 * than throw mid-render.
 */
function createSnippet(snippet: Snippet): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row-snippet';

  const start = Math.max(0, Math.min(snippet.matchStart, snippet.text.length));
  const end = Math.max(start, Math.min(start + snippet.matchLength, snippet.text.length));

  el.appendChild(document.createTextNode(snippet.text.slice(0, start)));

  const mark = document.createElement('mark');
  mark.textContent = snippet.text.slice(start, end);
  el.appendChild(mark);

  el.appendChild(document.createTextNode(snippet.text.slice(end)));
  return el;
}

/**
 * A favicon image that removes itself if the URL doesn't load.
 *
 * Archived favicon URLs are captured at archive time and can rot — the site
 * changes its icon path, or the host stops serving it. A broken-image glyph
 * in every row would be worse than no icon, so failures hide the element.
 */
function createFavicon(url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'row-favicon';
  img.src = url;
  img.alt = '';
  // Decorative: the title beside it already names the page.
  img.setAttribute('aria-hidden', 'true');
  img.addEventListener('error', () => img.remove());
  return img;
}

/** One list row. Text is set via textContent throughout — never innerHTML. */
export function createEntryRow(options: RowOptions): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'entry-row';

  if (options.faviconUrl) li.appendChild(createFavicon(options.faviconUrl));

  const info = document.createElement('div');
  info.className = 'row-info';

  // The title gets the line to itself; sharing it with the badge left titles
  // like "marvel vs capcom 3..." rendering as "marv...".
  const title = document.createElement('div');
  title.className = 'row-title';
  title.textContent = options.title;
  title.title = options.title; // full text on hover, since the title truncates
  info.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'row-meta';

  const segments = (Array.isArray(options.meta) ? options.meta : [options.meta]).filter(Boolean);
  segments.forEach((segment, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'row-meta-separator';
      // Spaces live in the text, not in a CSS gap, so the line still reads as
      // a sentence when copied or announced by a screen reader.
      separator.textContent = ' · ';
      meta.appendChild(separator);
    }

    const span = document.createElement('span');
    span.className = index === 0 ? 'row-meta-lead' : 'row-meta-fixed';
    span.textContent = segment;
    meta.appendChild(span);
  });

  if (options.badge) {
    const badge = document.createElement('span');
    badge.className = 'row-badge';
    badge.textContent = options.badge;
    meta.appendChild(badge);
  }

  info.appendChild(meta);

  if (options.snippet) info.appendChild(createSnippet(options.snippet));

  li.appendChild(info);

  if (options.control) li.appendChild(options.control);

  for (const action of options.actions ?? []) {
    const button = document.createElement('button');
    button.className = action.className ?? 'row-button';
    button.textContent = action.label;
    button.disabled = Boolean(action.disabled);
    button.addEventListener('click', action.onClick);
    li.appendChild(button);
  }

  if (options.error) {
    const error = document.createElement('div');
    error.className = 'row-error';
    error.textContent = options.error;
    li.appendChild(error);
  }

  return li;
}

/** Replaces a list's contents with a single explanatory row. */
export function renderEmptyState(container: HTMLElement, message: string): void {
  container.innerHTML = '';
  const empty = document.createElement('li');
  empty.className = 'empty-state';
  empty.textContent = message;
  container.appendChild(empty);
}

export interface RowActionOptions<P = unknown> {
  /** Shown on the row when the action fails. */
  errorMessage: string;
  /**
   * Describes the operation while it runs, readable back via `pendingFor`.
   * A row can host more than one action, and "Archiving…" on a row that is in
   * fact snoozing is worse than no label at all.
   */
  pending?: P;
  /** Rebuilds the list so the row reflects the state change. */
  render: () => void | Promise<void>;
}

/**
 * Tracks which rows have an action in flight, and which one last failed.
 *
 * This state can't live in the DOM, because a row action triggers exactly the
 * re-render that would discard it: archiving writes to storage, the storage
 * listener rebuilds the list, and a button that set its own `disabled` would
 * come back enabled halfway through the operation it was guarding.
 *
 * Keyed generically because the digest identifies rows by tab id and the
 * archive by entry id.
 */
export interface RowState<K, P = unknown> {
  isPending(key: K): boolean;
  /** Which operation is in flight, from the `pending` given to `run`. */
  pendingFor(key: K): P | undefined;
  errorFor(key: K): string | undefined;
  /**
   * Marks the row pending, runs the action, then settles — re-rendering at both
   * ends. Re-entry for a key already in flight is ignored, so a double click
   * can't start the same operation twice.
   */
  run(key: K, action: () => Promise<void>, options: RowActionOptions<P>): Promise<void>;
}

export function createRowState<K, P = unknown>(): RowState<K, P> {
  // A map rather than a set plus a parallel map: membership and the label
  // settle together, so they can't disagree about whether a row is busy.
  const pending = new Map<K, P | undefined>();
  const errors = new Map<K, string>();

  return {
    isPending: (key) => pending.has(key),
    pendingFor: (key) => pending.get(key),
    errorFor: (key) => errors.get(key),

    async run(key, action, { errorMessage, pending: label, render }) {
      if (pending.has(key)) return;

      pending.set(key, label);
      // A retry starts clean rather than showing the previous failure beside a
      // spinner.
      errors.delete(key);
      await render();

      try {
        await action();
      } catch (error) {
        console.error('[Tabbatical] Row action failed', error);
        errors.set(key, errorMessage);
      } finally {
        // Settled in `finally` so a throw can't strand a row disabled forever.
        pending.delete(key);
        await render();
      }
    },
  };
}

/**
 * Tracks the one row currently showing a follow-up choice.
 *
 * Two actions need this: Delete arms a confirmation, and Snooze opens a
 * duration picker. Both replace a row's buttons in place, both must collapse
 * when another row opens one, and neither can keep that state in the DOM for
 * the same reason `RowState` can't — the next render rebuilds the row.
 *
 * `detail` distinguishes stages within one row's choice (the snooze picker's
 * presets versus its custom field); a caller that only needs armed/not-armed
 * ignores it.
 */
export interface ArmedRow<K, D = undefined> {
  isArmed(key: K): boolean;
  detailFor(key: K): D | undefined;
  arm(key: K, detail?: D): void;
  clear(): void;
}

export function createArmedRow<K, D = undefined>(): ArmedRow<K, D> {
  let armedKey: K | undefined;
  let armedDetail: D | undefined;

  return {
    isArmed: (key) => armedKey !== undefined && armedKey === key,
    detailFor: (key) => (armedKey !== undefined && armedKey === key ? armedDetail : undefined),
    arm(key, detail) {
      // Only ever one: arming elsewhere moves the choice rather than leaving
      // two rows both waiting on the user.
      armedKey = key;
      armedDetail = detail;
    },
    clear() {
      armedKey = undefined;
      armedDetail = undefined;
    },
  };
}

/**
 * Guards against out-of-order async renders.
 *
 * Renders overlap routinely: a manual re-render races the storage listener
 * firing for the same write. Since building a view is async, an older render
 * can resolve after a newer one and overwrite the DOM with stale data. Each
 * render takes a token and checks it before touching the DOM; a superseded
 * render drops its result.
 */
export function createRenderGuard(): { begin: () => () => boolean } {
  let latest = 0;
  return {
    begin() {
      const id = ++latest;
      return () => id === latest;
    },
  };
}
