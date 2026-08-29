import { describe, expect, it } from 'vitest';
import { currentSurface, surfacePath } from './surface';

describe('currentSurface', () => {
  it('recognises the docked panel', () => {
    expect(currentSurface('?surface=panel')).toBe('panel');
  });

  it('recognises the tab the prompt opens', () => {
    expect(currentSurface('?surface=tab')).toBe('tab');
  });

  it('treats an unmarked page as the dropdown', () => {
    // Chrome opens default_popup verbatim, so the dropdown is the one surface
    // whose URL we don't construct and therefore can't mark.
    expect(currentSurface('')).toBe('popup');
  });

  it('falls back to the dropdown rather than failing on nonsense', () => {
    // The cost of guessing wrong is one redundant button, so a bad marker
    // should degrade rather than throw.
    for (const search of ['?surface=', '?surface=sidebar', '?other=panel', '?surface=POPUP']) {
      expect(currentSurface(search)).toBe('popup');
    }
  });

  it('reads the marker alongside other parameters', () => {
    expect(currentSurface('?foo=1&surface=panel&bar=2')).toBe('panel');
  });
});

describe('surfacePath', () => {
  it('marks the surface it names', () => {
    expect(surfacePath('panel')).toContain('surface=panel');
    expect(surfacePath('tab')).toContain('surface=tab');
  });

  it('round-trips through currentSurface', () => {
    // The two halves are used by different processes — the worker builds the
    // path, the page reads it — so they have to agree without ever meeting.
    for (const surface of ['panel', 'tab'] as const) {
      const query = surfacePath(surface).slice(surfacePath(surface).indexOf('?'));
      expect(currentSurface(query)).toBe(surface);
    }
  });

  it('points at the one document all three surfaces share', () => {
    expect(surfacePath('panel')).toMatch(/^src\/sidepanel\/index\.html\?/);
  });
});
