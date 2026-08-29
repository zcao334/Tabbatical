/**
 * Which of the three places this page is currently being shown.
 *
 * One document serves all of them — the toolbar dropdown, the docked side
 * panel, and the tab the daily prompt opens. They differ in what the page
 * should offer, not in what it shows: only the dropdown needs a way out of
 * itself, since it's the one surface that disappears the moment the user looks
 * at anything else.
 */

export type Surface = 'popup' | 'panel' | 'tab';

export const SURFACE_PARAM = 'surface';

/**
 * Marked by query string on the two surfaces whose URL we construct
 * ourselves — the side panel via sidePanel.setOptions, the review tab via
 * tabs.create. The dropdown is whatever's left, because its URL comes from the
 * manifest's default_popup, which Chrome opens verbatim.
 *
 * Defaulting to 'popup' rather than throwing means the worst case for a
 * missing marker is a redundant "Open in side panel" button, not a broken
 * page.
 */
export function currentSurface(search: string = window.location.search): Surface {
  const value = new URLSearchParams(search).get(SURFACE_PARAM);
  return value === 'panel' || value === 'tab' ? value : 'popup';
}

/** The path for a surface, for the callers that open one. */
export function surfacePath(surface: Surface): string {
  return `src/sidepanel/index.html?${SURFACE_PARAM}=${surface}`;
}
