import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 693 — this repository has no DOM test environment (no jsdom, no
// @testing-library — see FrostedGate.test.ts's own header for the same
// constraint), so "the component mounts with the given phrase" is checked
// the same honest way every other component test here does: against the
// real source text, never a rendered tree.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Source with comments removed, so a comment that happens to mention a
 *  string (e.g. explaining why a radius is 10px) can't fake a match. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('LoadingState — the magnifying-glass "lens" loading state', () => {
  const src = read('src/components/workspace-shell/LoadingState.tsx');

  it('takes `text` and `compact` props (Prompt 693 — was pipeline-only `label`)', () => {
    expect(src).toContain("export function LoadingState({ text = 'Loading…', compact = false }");
  });

  it('keeps the Prompt 675 §1 fixed lens radius (10px pre-scale) unchanged by this move', () => {
    // Two occurrences: the moving .sd-lens-magnified clip-path and its
    // prefers-reduced-motion fallback — both must still agree on 10px.
    const matches = code(src).match(/circle\(10px at/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('still renders the lens markup (sweep/glass/magnified), never bare text', () => {
    const body = code(src);
    expect(body).toContain('sd-lens-sweep');
    expect(body).toContain('sd-lens-glass');
    expect(body).toContain('sd-lens-magnified');
  });

  it('keeps the sr-only fallback in sync with the visible text', () => {
    expect(src).toContain('<p className="sr-only">{text}</p>');
  });

  it('`compact` only shortens the outer vertical rhythm, never the lens geometry', () => {
    // The only thing compact may touch is the wrapper's padding — the
    // sweep/glass/magnified block above this line is untouched either way.
    expect(src).toContain("compact ? 'py-3' : 'py-16'");
  });
});

// Prompt 693 §1 — every one of these previously showed bare "Loading…"
// text; the whole point of moving the lens out of app/pipeline/page.tsx
// (its only importer before this prompt, confirmed by grep) was for the
// investor portal to actually start using it.
const INVESTOR_PORTAL_CALL_SITES = [
  'src/app/portal/page.tsx',
  'src/app/portal/access-log/page.tsx',
  'src/app/portal/vouch/[token]/page.tsx',
  'src/app/portal/startup/[orgId]/page.tsx',
  'src/app/portal/startup/[orgId]/memo/page.tsx',
  'src/components/investor-workspace/PipelinePanel.tsx',
  'src/components/portal/StartupDossierContent.tsx',
  'src/components/investor-workspace/EvaluationToolsPanel.tsx',
  'src/components/investor-workspace/ScenariosReturnsTool.tsx',
];

describe('every named investor-portal area renders LoadingState, not loose "Loading…" text', () => {
  for (const path of INVESTOR_PORTAL_CALL_SITES) {
    it(`${path.split('/').pop()} imports and renders <LoadingState`, () => {
      const src = read(path);
      expect(src).toContain("from '@/components/workspace-shell/LoadingState'");
      expect(src).toContain('<LoadingState');
    });
  }
});

describe('the founder Pipeline page is unchanged visually — same phrase, new prop name only', () => {
  it('both call sites still say "Loading your pipeline…", now via `text` instead of `label`', () => {
    const src = read('src/app/pipeline/page.tsx');
    const count = (src.match(/<LoadingState text="Loading your pipeline…" \/>/g) ?? []).length;
    expect(count).toBe(2);
    expect(src).not.toContain('LoadingState label=');
  });
});

describe('the investor Pipeline shows the SAME phrase the founder side uses for the slow /api/portal/pipeline wait', () => {
  it('PipelinePanel renders "Loading your pipeline…" while data is null', () => {
    const src = read('src/components/investor-workspace/PipelinePanel.tsx');
    expect(src).toContain('if (!data) return <LoadingState text="Loading your pipeline…" />;');
  });

  it('the sliding dossier panel uses the compact variant with its own phrase', () => {
    const src = read('src/components/investor-workspace/PipelinePanel.tsx');
    expect(src).toContain('<LoadingState text="Loading dossier…" compact />');
  });
});
