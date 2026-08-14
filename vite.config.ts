import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { build as esbuildBuild } from 'esbuild';
import manifest from './manifest.json' with { type: 'json' };

/** Path of the injected extractor bundle, relative to the extension root. */
export const EXTRACTOR_OUTFILE = 'content/extract.js';

/**
 * Builds the on-demand extractor as a standalone IIFE.
 *
 * It can't go through the main Vite build: it isn't referenced by the
 * manifest (it's injected at runtime via chrome.scripting.executeScript, not
 * declared as a content script), so crxjs treats it as a static asset and
 * copies the raw TypeScript through without bundling Readability into it.
 *
 * Scripts injected via executeScript are classic scripts, so the output has
 * to be a self-contained IIFE with no import statements.
 *
 * Runs on closeBundle because Vite empties outDir while writing output —
 * anything written earlier would be deleted.
 */
function buildExtractor(): Plugin {
  return {
    name: 'tab-review:build-extractor',
    closeBundle: {
      order: 'post',
      async handler() {
        await esbuildBuild({
          entryPoints: ['src/content/extract.ts'],
          outfile: `dist/${EXTRACTOR_OUTFILE}`,
          bundle: true,
          format: 'iife',
          target: 'chrome114',
          minify: true,
        });
      },
    },
  };
}

export default defineConfig({
  plugins: [crx({ manifest }), buildExtractor()],
});
