// Prompt 918 C + D — the two screens, rendered for real with react-dom/server (no DOM needed): the founder's card in its three states,
// word for word, and the investor's block — only what was verified, with the source, never a count of what was not.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BadgesCardView } from '@/components/company/BadgesCard';
import { BadgeKindIcon } from '@/components/company/BadgeKindIcon';
import { InvestorBadges } from '@/components/portal/InvestorBadges';
import { BADGE_KINDS, type BadgePublic, type CompanyBadge } from '@/lib/company-badges';

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
const noop = () => {};

function badge(over: Partial<CompanyBadge> = {}): CompanyBadge {
  return {
    id: 'b1', name: 'Altice Innovation Awards', description: null, year: 2023, kind: 'award',
    logo_storage_path: null, logo_url: null, evidence_document_id: null,
    verification_status: 'unverified', verification_note: null, verified_at: null,
    source_url: null, source_title: null, source_found_by: null, updated_at: '2026-10-15T09:00:00Z', ...over,
  };
}
const card = (badges: CompanyBadge[] | null, over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BadgesCardView, { badges, canEdit: true, busyId: null, onAdd: noop, onEdit: noop, onVerify: noop, ...over }));

const VERIFIED = badge({
  id: 'v1', name: 'Altice Innovation Awards', verification_status: 'verified', verified_at: '2026-10-14T10:51:46.58Z',
  source_url: 'https://www.altice.pt/premios/2023', source_title: 'Altice Innovation Awards 2023 — winners', source_found_by: 'sherlock',
});
const UNVERIFIED = badge({ id: 'u1', name: 'Startup Boost Award', year: 2023, kind: 'programme' });
const DISPUTED = badge({ id: 'd1', name: 'Norte + Inclusivo Award', year: 2025, kind: 'recognition', verification_status: 'disputed', verification_note: 'Won in 2022, not 2025' });

describe('BadgesCardView — the founder\'s card (918 C)', () => {
  const html = card([VERIFIED, UNVERIFIED, DISPUTED]);
  const t = text(html);

  it('opens with the sentence of C.3, word for word', () => {
    expect(t).toContain('Investors only see badges Sherlock has confirmed against public sources and your documents. Add the link to the award page or a public news piece to speed up verification.');
  });

  it('says in the three states exactly what an investor sees of each badge (C.2)', () => {
    expect(t).toContain('Visible to investors · verified 14 Oct 2026 · source: altice.pt');
    expect(t).toContain('Private — not shown to investors until verified');
    expect(t).toContain('Private — contradicted by public sources: Won in 2022, not 2025');
  });

  it('paints the three states differently (green visible / grey private / amber contradicted) and tags each row with its state', () => {
    expect(html).toContain('text-emerald-700');
    expect(html).toContain('text-amber-700');
    for (const s of ['verified', 'unverified', 'disputed']) expect(html).toContain(`data-badge-state="${s}"`);
  });

  it('shows name, year and kind; never initials in a circle — the icon of the kind when there is no logo (C.4)', () => {
    expect(t).toContain('Altice Innovation Awards · 2023 Award');
    expect(t).toContain('Startup Boost Award · 2023 Programme');
    expect(t).toContain('Norte + Inclusivo Award · 2025 Recognition');
    expect(html.match(/data-badge-logo="icon"/g)).toHaveLength(3);
    expect(html).toContain('data-badge-kind-icon="award"');
    expect(html).toContain('data-badge-kind-icon="programme"');
    expect(html).toContain('data-badge-kind-icon="recognition"');
    expect(t).not.toMatch(/\b(AL|ST|NO)\b/);
  });

  it('a verified badge has no Verify button (it only re-verifies after the name, year or source changes); the others do', () => {
    const verifiedRow = card([VERIFIED]);
    expect(text(verifiedRow)).not.toMatch(/Verify|Re-verify/);
    expect(text(card([UNVERIFIED]))).toContain('Verify');
    expect(text(card([UNVERIFIED]))).not.toContain('Re-verify');
  });

  it('"Re-verify" once there is something to redo: a note from an earlier check, or a contradiction', () => {
    expect(text(card([badge({ verification_note: 'Re-verify to attach a public source' })]))).toContain('Re-verify');
    expect(text(card([badge({ verification_note: 'No public sources found.' })]))).toContain('Re-verify');
    expect(text(card([DISPUTED]))).toContain('Re-verify');
  });

  it('keeps the last check\'s reason for a private badge in small print, so the founder knows what to fix', () => {
    const h = text(card([badge({ verification_note: 'Confirmed in search but no stable public source — add a link' })]));
    expect(h).toContain('Confirmed in search but no stable public source — add a link');
  });

  it('the founder\'s own source link is shown (opens in a new window, no opener) until the badge is verified; once verified the status line carries the domain', () => {
    const pending = card([badge({ source_url: 'https://noticias.example.pt/mob2is-premio' })]);
    expect(pending).toContain('href="https://noticias.example.pt/mob2is-premio"');
    expect(pending).toContain('target="_blank"');
    expect(pending).toContain('rel="noopener nofollow"');
    expect(text(pending)).toContain('Your source link: https://noticias.example.pt/mob2is-premio');
    expect(text(card([VERIFIED]))).not.toContain('Your source link');
  });

  it('the logo comes from the founder\'s own route, versioned so a new logo is never served from the cache', () => {
    const withUpload = card([badge({ logo_storage_path: 'org/uuid-logo.png' })]);
    expect(withUpload).toContain('src="/api/company-badges/b1/logo?v=2026-10-15T09%3A00%3A00Z"');
    expect(withUpload).toContain('data-badge-logo="image"');
    expect(card([badge({ logo_url: 'https://cdn.altice.pt/logo.png' })])).toContain('src="/api/company-badges/b1/logo?v=');
    // the third party's address and any storage URL never go into the page
    for (const h of [withUpload, card([badge({ logo_url: 'https://cdn.altice.pt/logo.png' })])]) expect(h).not.toMatch(/cdn\.altice|supabase|storage/i);
  });

  it('while one badge is being checked its button says so and every verify button waits', () => {
    const h = card([UNVERIFIED, badge({ id: 'u2', name: 'Other' })], { busyId: 'u1' });
    expect(text(h)).toContain('Checking…');
    expect(h.match(/ disabled=""/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('a member who cannot edit sees the badges but no button; with nothing to show and nothing to edit the card is not there at all', () => {
    const readOnly = card([VERIFIED, UNVERIFIED], { canEdit: false });
    expect(text(readOnly)).toContain('Altice Innovation Awards');
    expect(text(readOnly)).not.toMatch(/\+ Add|Verify|Edit/);
    expect(card([], { canEdit: false })).toBe('');
    expect(card(null, { canEdit: false })).toBe('');
  });

  it('an empty card for someone who can edit still says what it is for', () => {
    const h = text(card([]));
    expect(h).toContain('No badges yet');
    expect(h).toContain('+ Add');
  });

  it('shows a success notice and an error in words', () => {
    const h = text(card([UNVERIFIED], { notice: '“Startup Boost Award” is not verified yet, so it stays private.', error: 'Not enough AI credits to verify a badge.' }));
    expect(h).toContain('is not verified yet, so it stays private.');
    expect(h).toContain('Not enough AI credits to verify a badge.');
  });
});

describe('BadgeKindIcon — one icon per kind, drawn inline', () => {
  it('has a distinct drawing for each of the four kinds', () => {
    const drawings = BADGE_KINDS.map((k) => renderToStaticMarkup(createElement(BadgeKindIcon, { kind: k })));
    expect(new Set(drawings).size).toBe(4);
    for (const [i, k] of BADGE_KINDS.entries()) {
      expect(drawings[i]).toContain(`data-badge-kind-icon="${k}"`);
      expect(drawings[i]).toContain('<svg');
      expect(drawings[i]).toContain('aria-hidden="true"');
    }
  });
});

function pub(over: Partial<BadgePublic> = {}): BadgePublic {
  return {
    id: 'b1', name: 'Altice Innovation Awards', kind: 'award', year: 2023, logoUrl: '/api/portal/badge-logo/b1',
    sourceUrl: 'https://www.altice.pt/premios/2023', sourceTitle: 'Altice Innovation Awards 2023 — winners', verifiedAt: '2026-10-14T10:51:46.58Z', ...over,
  };
}
const block = (badges: BadgePublic[] | null | undefined) => renderToStaticMarkup(createElement(InvestorBadges, { badges }));

describe('InvestorBadges — what an investor sees (918 D)', () => {
  it('draws nothing at all when there is nothing verified: no heading, no "0 badges", no placeholder', () => {
    for (const none of [undefined, null, []]) expect(block(none)).toBe('');
  });

  const html = block([pub(), pub({ id: 'b2', name: 'Norte + Inclusivo Award', kind: 'recognition', year: 2025, logoUrl: null, sourceTitle: null, sourceUrl: 'https://www.ccdr-n.pt/premios', verifiedAt: '2026-10-15T08:00:00Z' })]);
  const t = text(html);

  it('has the block title and, above the badges, the one line of D.2 — "confirmed against", word for word', () => {
    expect(t).toContain('Badges & awards');
    expect(t).toContain("Shown only after Sherlock confirmed each one against public sources and the founder's documents.");
    expect(t.indexOf("Shown only after Sherlock")).toBeLessThan(t.indexOf('Altice Innovation Awards'));
    expect(t.indexOf('Badges & awards')).toBeLessThan(t.indexOf("Shown only after Sherlock"));
  });

  it('shows each badge: kind, name, year, "Verified by Sherlock · dd Mon yyyy" and the source', () => {
    expect(t).toContain('Award Altice Innovation Awards · 2023');
    expect(t).toContain('Verified by Sherlock · 14 Oct 2026');
    expect(t).toContain('Source: altice.pt · Altice Innovation Awards 2023 — winners'); // the domain first: a narrow card cuts the end, and the domain is what matters
    expect(t).toContain('Recognition Norte + Inclusivo Award · 2025');
    expect(t).toContain('Verified by Sherlock · 15 Oct 2026');
    expect(t).toContain('Source: ccdr-n.pt'); // no title found: the domain is the label
  });

  it('the source link opens in a new window without handing over the opener, and tells search engines not to follow it', () => {
    expect(html).toContain('href="https://www.altice.pt/premios/2023"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener nofollow"/g)).toHaveLength(2);
  });

  it('the logo is our own route; a badge without one gets the icon of its kind — never initials', () => {
    expect(html).toContain('src="/api/portal/badge-logo/b1"');
    expect(html).toContain('data-badge-logo="image"');
    expect(html).toContain('data-badge-logo="icon"');
    expect(html).toContain('data-badge-kind-icon="recognition"');
    expect(html).not.toMatch(/https?:\/\/[^"]*(?:logo|\.png|\.svg)/i);
  });

  it('never promises more than was done: "confirmed against", not guaranteed, certified or validated — and says nothing about what is not shown', () => {
    expect(t).not.toMatch(/guarantee|certified|validated|unverified|disputed|not verified|pending|hidden|\b\d+ (more )?badges?\b/i);
  });

  it('is what the dossier renders: DossierOverviewSections uses this block and no longer has its own pills', () => {
    const src = readFileSync(path.resolve(__dirname, '../portal/DossierOverviewSections.tsx'), 'utf8');
    expect(src).toContain('<InvestorBadges badges={dossier.badges} />');
    expect(src).not.toContain('verificationStatus');
    expect(src).not.toContain('grayscale');
  });
});
