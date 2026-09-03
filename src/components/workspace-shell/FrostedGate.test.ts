import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 554 — a locked block's explanation must be reachable without
// scrolling.
//
// The bug: every gate was `absolute inset-0 flex items-center justify-center`,
// which centres the message in the BLOCK. Readiness & Train's seven tabs are
// two or three screens tall, so the only text explaining the frost sat a
// screen and a half below the fold. A first-run founder saw greyed-out cards
// and no reason why.
//
// This repository has no DOM test environment (no jsdom, no
// @testing-library), and `position: sticky` is a compositor behaviour that a
// unit test could not observe even with one — the honest check is that the
// mechanism is present at every gate and that its one silent precondition
// still holds. Both are asserted against the real source below.
// Read as TEXT rather than imported: this project's vitest has no JSX
// plugin (no test here has ever imported a .tsx), and the assertions below
// are about the markup anyway.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Source with comments removed — the component's own comments EXPLAIN why
 *  `fixed` and IntersectionObserver are wrong, so asserting against raw text
 *  would trip on the prose that documents the decision. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The value of an exported string constant, straight from the source. */
function constant(src: string, name: string): string {
  const m = src.match(new RegExp(`export const ${name} = '([^']*)'`));
  if (!m) throw new Error(`${name} is no longer an exported string constant`);
  return m[1];
}

const GATES = [
  'src/components/readiness/ReadinessPanel.tsx',
  'src/components/readiness/MarketDataPanel.tsx',
  'src/components/investor-workspace/PipelinePanel.tsx',
  'src/components/guest/FrostedOverlay.tsx',
];

describe('FrostedGate', () => {
  const src = read('src/components/workspace-shell/FrostedGate.tsx');
  const GATE_STICKY_TOP = constant(src, 'GATE_STICKY_TOP');
  const GATE_TOP_PADDING = constant(src, 'GATE_TOP_PADDING');

  it('positions the message with sticky, not by centring the overlay', () => {
    expect(GATE_STICKY_TOP).toContain('sticky');
    expect(GATE_STICKY_TOP).toContain('50vh');
    // The overlay must NOT flex-centre — that is precisely the old bug.
    const overlay = src.slice(src.indexOf('absolute inset-0'), src.indexOf('absolute inset-0') + 200);
    expect(overlay).not.toContain('items-center justify-center');
  });

  it('starts the message below the block top so short blocks look unchanged', () => {
    expect(GATE_TOP_PADDING).toContain('pt-[min(20vh,160px)]');
  });

  it('never uses position: fixed — that would escape the block', () => {
    // fixed would float the message over the header and sidebar once the
    // founder scrolled past the gate. Asserted against code, not comments:
    // the component's own header explains why fixed is wrong.
    expect(code(src)).not.toMatch(/\bfixed\b/);
  });

  it('uses no scroll listener and no IntersectionObserver', () => {
    // The compositor already does this; reimplementing it per frame in JS
    // would be strictly worse. Again code-only — the header names both.
    const body = code(src);
    expect(body).not.toContain('IntersectionObserver');
    expect(body).not.toContain('addEventListener');
    expect(body).not.toContain('onScroll');
  });

  it('hides the blurred content from screen readers only while locked', () => {
    expect(src).toContain('aria-hidden={locked || undefined}');
  });

  it('swallows pointer events over the locked content', () => {
    expect(src).toContain('pointer-events-none');
  });
});

describe('every known gate goes through FrostedGate', () => {
  for (const path of GATES) {
    it(`${path.split('/').pop()} uses the shared gate`, () => {
      const src = read(path);
      expect(src).toContain('FrostedGate');
      // None of them may keep the old block-centred overlay.
      expect(src).not.toMatch(/absolute inset-0[^"'`]*items-center justify-center/);
    });
  }
});

describe('the precondition that fails silently', () => {
  it('no overflow clipping between the shells and the content', () => {
    // `position: sticky` resolves against the nearest scrollport. If a shell
    // between the gate and the page gains overflow-hidden or overflow-y-auto,
    // that ancestor becomes the scrollport and the message quietly stops
    // sticking — no error, no warning, just the original bug back. Verified
    // by hand today (grep returns nothing); pinned here so a future layout
    // change trips a test instead.
    for (const shell of [
      'src/components/shell.tsx',
      'src/components/investor-workspace/InvestorWorkspaceShell.tsx',
    ]) {
      const src = read(shell);
      expect(src, `${shell} gained overflow clipping — FrostedGate's sticky message will silently stop working`)
        .not.toMatch(/overflow-hidden|overflow-y-auto/);
    }
  });
});
