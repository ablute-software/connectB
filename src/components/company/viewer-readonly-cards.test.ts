// Nuno, 20/10/2026: "in ablute_ › Company › Cap table no data appears — I know the startup has data. The same with Photos & media and MatchDeal." In a Developer Viewer
// session `canEdit` is false (the developer holds no role in the org on screen), and these cards hid themselves from anyone who could not edit — so the one reader
// whose job is to see what the founder sees got a blank tab. The cards now draw for a viewer, READ-ONLY: the rows and the totals, without the form, the remove links
// or the Watson fill. (The data itself was the other half: RLS answered zero rows for these tables — see developer-viewer-rls.test.ts.)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { cardVisibleToReader } from '@/lib/card-visibility';

const h = vi.hoisted(() => ({
  db: {
    org: { id: 'org-1' }, documents: [], entities: [],
    capTableEntries: [
      { id: 'c1', org_id: 'org-1', category: 'founder', label: 'zz-test Founder A', pct: 60, as_of: '2026-01-01' },
      { id: 'c2', org_id: 'org-1', category: 'investor', label: 'zz-test Seed investors', pct: 40, as_of: '2026-01-01' },
    ],
    fundingRounds: [{ id: 'f1', org_id: 'org-1', label: 'zz-test Pre-seed', amount_eur: 100000, closed_year: 2024, investor_name: 'zz-test Angel' }],
  },
}));
vi.mock('@/lib/store', () => ({
  useStore: () => ({
    db: h.db, addCapTableEntry: vi.fn(), removeCapTableEntry: vi.fn(), addFundingRound: vi.fn(), removeFundingRound: vi.fn(), setInterest: vi.fn(),
  }),
}));

// the editor's cap table card reads ?capTableRequestItem= (the Watson fill) from the URL
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/settings' }));

import { CapTableCard } from './CapTableCard';
import { PreviousFundingCard } from '@/components/PreviousFundingCard';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('cardVisibleToReader — who sees a card that hides itself from someone who cannot edit', () => {
  it('an editor always does; a Developer Viewer does too (it reads what the founder sees); anyone else only when there is something for readers', () => {
    expect(cardVisibleToReader({ canEdit: true, viewer: false })).toBe(true);
    expect(cardVisibleToReader({ canEdit: false, viewer: true })).toBe(true);
    expect(cardVisibleToReader({ canEdit: false, viewer: false })).toBe(false);
    expect(cardVisibleToReader({ canEdit: false, viewer: false, hasContentForReaders: true })).toBe(true);
    expect(cardVisibleToReader({ canEdit: false, viewer: true, hasContentForReaders: false })).toBe(true);
  });
});

describe('Cap table — what a viewer reads', () => {
  it('the editor\'s card has the rows, the form and the remove links', () => {
    const out = html(createElement(CapTableCard, {}));
    expect(text(out)).toContain('zz-test Founder A');
    expect(out).toContain('<input');
    expect(out).toContain('<select');
    expect(text(out)).toContain('remove');
    expect(text(out)).toContain('Add');
  });

  it('the viewer\'s card has the rows and the total — and nothing to press: no form, no remove link, no Watson fill', () => {
    const out = html(createElement(CapTableCard, { readOnly: true }));
    const t = text(out);
    expect(t).toContain('Cap table');
    expect(t).toContain('zz-test Founder A');
    expect(t).toContain('zz-test Seed investors');
    expect(t).toContain('Total: 100%');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<select');
    expect(out).not.toContain('<button');
    expect(t).not.toContain('remove');
  });
});

describe('Previous funding — what a viewer reads', () => {
  it('the editor\'s card has the rounds, the form and the remove links', () => {
    const out = html(createElement(PreviousFundingCard, {}));
    expect(text(out)).toContain('zz-test Pre-seed');
    expect(out).toContain('<input');
    expect(text(out)).toContain('remove');
  });

  it('the viewer\'s card has the rounds and the total, and no form, no remove link', () => {
    const out = html(createElement(PreviousFundingCard, { readOnly: true }));
    const t = text(out);
    expect(t).toContain('zz-test Pre-seed');
    expect(t).toContain('zz-test Angel');
    expect(t).toContain('Total raised to date: €100,000');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<button');
    expect(t).not.toContain('remove');
  });
});

describe('the wiring: who is a viewer, and which cards ask', () => {
  const page = read('../../app/settings/page.tsx');
  const panel = read('./CompanyPanel.tsx');

  it('the Settings page reads the viewer flag from /api/me and hands it to the three tabs that used to go blank', () => {
    expect(page).toContain('setViewer(!!me.viewer);');
    expect(page).toContain('<PhotosMediaCard canEdit={canEditCompany} viewer={viewer} />');
    expect(page).toContain('<MiniPitchCard canEdit={canEditCompany} viewer={viewer} />');
    expect(page).toContain('viewer={viewer} companyProfileAvailable={companyProfileAvailable}');
  });

  it('Cap table and Previous funding are drawn for an editor or a viewer, and read-only for a viewer', () => {
    expect(panel).toContain('cardVisibleToReader({ canEdit, viewer }) && <PreviousFundingCard readOnly={!canEdit} />');
    expect(panel).toContain('cardVisibleToReader({ canEdit, viewer }) && <CapTableCard readOnly={!canEdit} />');
    expect(panel).not.toMatch(/\{canEdit && <(CapTableCard|PreviousFundingCard)/);
  });

  it('the MatchDeal and Photos & media cards decide through the same helper (a live pitch / a photo is content for readers; a viewer is always a reader)', () => {
    expect(read('./MiniPitchCard.tsx')).toContain('cardVisibleToReader({ canEdit, viewer, hasContentForReaders: !!pitch?.activatedAt })');
    expect(read('./PhotosMediaCard.tsx')).toContain('cardVisibleToReader({ canEdit, viewer, hasContentForReaders: (items?.length ?? 0) > 0 })');
  });

  it('a reader who is neither a member with rights nor a viewer still sees none of the sensitive cards (the cap table is for owners and admins)', () => {
    expect(cardVisibleToReader({ canEdit: false, viewer: false })).toBe(false);
  });
});
