import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Prompt 560 §C — a grep-style guard, in the spirit of Prompt 548's.
//
// The bug: both portal pages read `?tab=` with a `useState` initializer over
// `window.location.search`. Under App Router client navigation the page
// renders BEFORE the router commits the URL, so on that first render
// `window.location` still holds the PREVIOUS page's query string — the
// initializer saw no valid tab and fell back to the default. Every deep link
// from Actions required landed on Overview. A hard reload of the identical
// URL worked, which is precisely why it survived verification: the only way
// to see it is to click, not to refresh.
//
// This cannot be an ordinary behavioural test — vitest here has no JSX
// transform and no router to drive — so it pins the SOURCE, the same way
// FrostedGate's and guest-previews' tests do. If someone reintroduces the
// initializer for the same reason it existed the first time (avoiding a
// Suspense boundary), this fails and points at the reason.
// Prompt 681 §3 — the startup dossier's own reading (useSearchParams, tab/
// doc/section) moved out of the route file into
// src/components/portal/StartupDossierContent.tsx, so the investor
// Pipeline's sliding panel could embed the SAME component (App Router
// forbids a page.tsx from exporting anything but the well-known route
// exports — a named export there fails next build's own typegen, even
// though tsc --noEmit never catches it). The route file itself
// (src/app/portal/startup/[orgId]/page.tsx) is now just the Suspense
// wrapper — checked on its own, below, since its shape no longer matches
// this loop's single-file assumption.
const FILES = [
  'src/app/portal/page.tsx',
  'src/components/portal/StartupDossierContent.tsx',
];

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

/** Comments explain the bug at length and name `window.location.search`
 *  while doing so; only real code counts. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

describe('the portal pages read the tab from the router', () => {
  for (const file of FILES) {
    describe(file, () => {
      it('reads the query string through useSearchParams', () => {
        expect(code(file)).toContain('useSearchParams');
      });

      it('never reads a tab or orgId out of window.location at render time', () => {
        const body = code(file);
        // linkFailed is the one documented exception on /portal — it arrives
        // on a FULL page load from the magic-link redirect, and its own
        // comment explains why re-reading it live breaks React Strict Mode.
        const offending = body.split('\n')
          .filter((l) => l.includes('window.location.search'))
          .filter((l) => !l.includes('linkFailed'));
        expect(offending).toEqual([]);
      });

      // Prompt 681 — the startup dossier's Suspense boundary now lives in a
      // DIFFERENT file than the useSearchParams read (see the FILES comment
      // above): checked explicitly, below, instead of in this per-file loop.
      if (file !== 'src/components/portal/StartupDossierContent.tsx') {
        it('wraps its default export in a Suspense boundary, which useSearchParams requires', () => {
          const body = code(file);
          expect(body).toContain('<Suspense');
          // The boundary has to be OUTSIDE the component doing the reading, or
          // it does not help: Next needs a suspended parent to fall back to.
          const exportIdx = body.indexOf('export default function');
          const suspenseIdx = body.indexOf('<Suspense', exportIdx);
          const innerIdx = body.indexOf('Inner', exportIdx);
          expect(exportIdx).toBeGreaterThanOrEqual(0);
          expect(suspenseIdx).toBeGreaterThan(exportIdx);
          expect(innerIdx).toBeGreaterThan(suspenseIdx);
        });
      }
    });
  }

  // Prompt 681 — the startup dossier's ROUTE file no longer reads anything
  // itself; it only wraps StartupDossierContent's exported component in a
  // Suspense boundary (App Router forbids that component's own named export
  // from living in a page.tsx at all — see that file's own header comment).
  // This is the split-file equivalent of the single-file check above.
  describe('src/app/portal/startup/[orgId]/page.tsx', () => {
    it('wraps StartupDossierPageInner in a Suspense boundary', () => {
      const body = code('src/app/portal/startup/[orgId]/page.tsx');
      expect(body).toContain('<Suspense');
      const exportIdx = body.indexOf('export default function');
      const suspenseIdx = body.indexOf('<Suspense', exportIdx);
      const innerIdx = body.indexOf('StartupDossierPageInner', suspenseIdx);
      expect(exportIdx).toBeGreaterThanOrEqual(0);
      expect(suspenseIdx).toBeGreaterThan(exportIdx);
      expect(innerIdx).toBeGreaterThan(suspenseIdx);
    });
  });

  // The startup page is the one Actions required deep-links into with all
  // three params; if any stops being read the links silently degrade again.
  it('the startup dossier reads tab, doc and section from the router', () => {
    const body = code('src/components/portal/StartupDossierContent.tsx');
    expect(body).toContain("searchParams.get('tab')");
    expect(body).toContain("searchParams.get('doc')");
    expect(body).toContain("searchParams.get('section')");
  });
});
