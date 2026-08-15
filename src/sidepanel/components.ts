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
  /** Secondary line under the title — staleness for the digest, date for the archive. */
  meta: string;
  faviconUrl?: string;
  /** Small label beside the title, e.g. marking an entry as metadata-only. */
  badge?: string;
  /** Matched page text with the search term highlighted. */
  snippet?: Snippet;
  /** Error text shown under the row, e.g. a failed archive. */
  error?: string;
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

  const titleLine = document.createElement('div');
  titleLine.className = 'row-title-line';

  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = options.title;
  title.title = options.title; // full text on hover, since the title truncates
  titleLine.appendChild(title);

  if (options.badge) {
    const badge = document.createElement('span');
    badge.className = 'row-badge';
    badge.textContent = options.badge;
    titleLine.appendChild(badge);
  }

  info.appendChild(titleLine);

  const meta = document.createElement('div');
  meta.className = 'row-meta';
  meta.textContent = options.meta;
  info.appendChild(meta);

  if (options.snippet) info.appendChild(createSnippet(options.snippet));

  li.appendChild(info);

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

export interface RowActionOptions {
  /** Shown on the row when the action fails. */
  errorMessage: string;
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
export interface RowState<K> {
  isPending(key: K): boolean;
  errorFor(key: K): string | undefined;
  /**
   * Marks the row pending, runs the action, then settles — re-rendering at both
   * ends. Re-entry for a key already in flight is ignored, so a double click
   * can't start the same operation twice.
   */
  run(key: K, action: () => Promise<void>, options: RowActionOptions): Promise<void>;
}

export function createRowState<K>(): RowState<K> {
  const pending = new Set<K>();
  const errors = new Map<K, string>();

  return {
    isPending: (key) => pending.has(key),
    errorFor: (key) => errors.get(key),

    async run(key, action, { errorMessage, render }) {
      if (pending.has(key)) return;

      pending.add(key);
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

/**
 * Short, readable source label for a URL.
 *
 * Web pages show the bare hostname, since that's what identifies a site at a
 * glance. Browser pages keep their scheme: the hostname of
 * `chrome://extensions/` is just "extensions", which reads as a word rather
 * than a page and gives no clue it's a browser screen.
 */
export function formatDomain(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.replace(/^www\./, '');
    }

    // Not every scheme has an authority: chrome:// and file:// do, while
    // about: and view-source: hold an opaque path, where inserting "//"
    // would produce something that isn't a URL at all (about://blank).
    const separator = parsed.href.startsWith(`${parsed.protocol}//`) ? '//' : '';

    // Trailing slash dropped so chrome://newtab/ reads as chrome://newtab.
    const path = parsed.pathname.replace(/\/$/, '');
    return `${parsed.protocol}${separator}${parsed.hostname}${path}`;
  } catch {
    // Anything malformed still deserves a label rather than an empty cell.
    return url;
  }
}
