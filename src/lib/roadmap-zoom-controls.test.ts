// Prompt 519 §4(e) asks for this test by name: "um teste que confirma qual
// onClick cada glifo visível dispara — é o tipo de regressão que passa
// despercebida sem teste."
//
// It is asserted against the SOURCE rather than a rendered component on
// purpose. The bug was never behavioural — the handlers and the aria-labels
// were always correct, so a render test driven by accessible name would have
// passed happily while a sighted founder saw "+" shrink the timeline. The
// only thing that was wrong is which character sits next to which handler,
// and that is a fact about the file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/components/company/RoadmapCanvas.tsx'), 'utf8');

/** The button element (open tag through closing tag) that sets this zoom level. */
function buttonFor(zoom: 'quarter' | 'year'): string {
  const m = new RegExp(`<button onClick=\\{\\(\\) => setZoom\\('${zoom}'\\)\\}[\\s\\S]*?</button>`).exec(SRC);
  if (!m) throw new Error(`no zoom button found for '${zoom}'`);
  return m[0];
}

describe('Roadmap zoom controls', () => {
  it('"+" zooms IN (quarter = a shorter window = more detail)', () => {
    const b = buttonFor('quarter');
    expect(b).toContain('>+<');
    expect(b).not.toContain('>−<');
    expect(b).toContain('aria-label="Zoom in"');
  });

  it('"−" zooms OUT (year = a longer window = less detail)', () => {
    const b = buttonFor('year');
    expect(b).toContain('>−<');
    expect(b).not.toContain('>+<');
    expect(b).toContain('aria-label="Zoom out"');
  });

  it('the glyph and the aria-label agree — the exact thing that was broken', () => {
    // Before this fix the labels were right and the glyphs were swapped, so
    // a screen-reader user and a sighted user got opposite controls.
    const zoomIn = buttonFor('quarter');
    const zoomOut = buttonFor('year');
    expect(zoomIn.includes('aria-label="Zoom in"') && zoomIn.includes('>+<')).toBe(true);
    expect(zoomOut.includes('aria-label="Zoom out"') && zoomOut.includes('>−<')).toBe(true);
  });
});
