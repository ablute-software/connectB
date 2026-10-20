// The roadmap's history is part of the completeness score (20/10/2026). A score is only one number if every place that computes it asks the same question — the
// failure this repo has had before with "complete" (two definitions live at once). These close the set of callers, and pin how the roadmap reaches the screen.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoadmapGuidanceCard } from '@/components/company/RoadmapGuidanceCard';
import { roadmapGuidance } from './roadmap-guidance';

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.resolve(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, '/');
// the code of a file, without its comment lines (a comment may well mention the function without calling it)
const codeLines = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

describe('every place that computes the completeness score decides about the roadmap', () => {
  const callers = walk(SRC)
    .filter((f) => rel(f) !== 'lib/companyCompleteness.ts' && !rel(f).startsWith('app/zz-'))
    .filter((f) => codeLines(f).some((l) => l.includes('calcCompanyCompleteness(')))
    .map(rel).sort();

  it('the callers are exactly these four — a new one has to be added here, and say what it does about the roadmap', () => {
    expect(callers).toEqual([
      'app/api/backoffice/startups/route.ts',
      'app/api/org/update/route.ts',
      'app/settings/page.tsx',
      'app/settings/preview/page.tsx',
    ]);
  });

  it('each passes the roadmap (the client the store\'s events, the server the same question asked of the database)', () => {
    for (const f of callers) {
      const call = codeLines(path.resolve(SRC, f)).find((l) => l.includes('calcCompanyCompleteness(')) ?? '';
      expect(call, f).toMatch(/roadmapEvents|roadmapContextFromHistory|roadmapCtx/);
    }
  });

  it('the client does not count the roadmap as empty while the store is still loading it', () => {
    expect(read('app/settings/page.tsx')).toContain('{ roadmapEvents: loading ? undefined : db.roadmapEvents }');
    expect(read('app/settings/preview/page.tsx')).toContain('{ roadmapEvents: loading ? undefined : db.roadmapEvents }');
  });

  it('the server asks about milestones marked done, in the table the canvas reads', () => {
    const lib = read('lib/roadmap-history.ts');
    expect(lib).toContain(".from('roadmap_events').select('org_id').eq('status', 'done')");
    expect(lib).toContain(".from('roadmap_events').select('id').eq('org_id', orgId).eq('status', 'done')");
    expect(read('app/api/org/update/route.ts')).toContain('roadmapContextFromHistory(await orgHasRoadmapHistory(admin, acting.orgId as string))');
    expect(read('app/api/backoffice/startups/route.ts')).toContain('roadmapContextFromHistory(historyOrgIds ? historyOrgIds.has(org.id as string) : null)');
  });
});

describe('a missing roadmap field takes the founder to the Roadmap tab', () => {
  it('the bar opens the tab instead of scrolling to a field that is not on this page; the Company panel does not switch to a section that does not exist', () => {
    const bar = read('components/company/CompletenessBar.tsx');
    expect(bar).toContain("if (field.card === 'roadmap' && onOpenTab) { onOpenTab('roadmap'); return; }");
    expect(read('app/settings/page.tsx')).toContain('onFlash={setFlashId} onOpenTab={setTab} />');
    expect(read('components/company/CompanyPanel.tsx')).toContain("if (field && field.card !== 'roadmap') setActive(field.card);");
  });

  it('the Roadmap tab shows the guidance to an editor (with the button) and to a Developer Viewer (without it)', () => {
    const panel = read('components/company/RoadmapPanel.tsx');
    expect(panel).toContain('{guidance && (canEdit || viewer) && (');
    expect(panel).toContain('onAdd={canEdit ? () => setPrefillTitle(\'\') : undefined}');
    expect(read('app/settings/page.tsx')).toContain('<RoadmapPanel canEdit={canEditCompany} viewer={viewer} />');
  });

  it('the guidance never runs the suggestion engine: it neither fetches nor charges anything', () => {
    for (const f of ['lib/roadmap-guidance.ts', 'components/company/RoadmapGuidanceCard.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/fetch\(|chargeAiAction|suggest-events|anthropic/i);
    }
  });
});

describe('RoadmapGuidanceCard — what a founder (and a Developer Viewer) sees', () => {
  const mob2is = roadmapGuidance({ events: [], foundedYear: 2023, companyName: 'zz-test Mob2is', now: new Date('2026-10-20T12:00:00Z'), hasDocuments: false })!;
  const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('shows the title, the reason and the tip; the add button only to someone who can add', () => {
    const editor = renderToStaticMarkup(createElement(RoadmapGuidanceCard, { guidance: mob2is, onAdd: () => {} }));
    expect(text(editor)).toContain('Your roadmap is empty');
    expect(text(editor)).toContain('zz-test Mob2is was founded in 2023');
    expect(text(editor)).toContain('documents in your Data Room');
    expect(editor).toContain('<button');
    expect(text(editor)).toContain('Add a milestone');

    const viewer = renderToStaticMarkup(createElement(RoadmapGuidanceCard, { guidance: mob2is }));
    expect(text(viewer)).toContain('Your roadmap is empty');
    expect(viewer).not.toContain('<button');
  });

  it('carries the id the completeness bar flashes (roadmap.history) only while the history is what is missing', () => {
    expect(renderToStaticMarkup(createElement(RoadmapGuidanceCard, { guidance: mob2is }))).toContain('id="roadmap.history"');
    const futureOnly = roadmapGuidance({ events: [{ status: 'done' }], foundedYear: 2023, now: new Date('2026-10-20T12:00:00Z'), hasDocuments: true })!;
    expect(renderToStaticMarkup(createElement(RoadmapGuidanceCard, { guidance: futureOnly }))).not.toContain('id="roadmap.history"');
  });
});
