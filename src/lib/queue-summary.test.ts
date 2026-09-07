// Prompt 576 Fase 4 — groupIntoReviewCards fuses the raw per-source rows
// into the Review landing's 6 cards. The one rule worth a real test: a
// fused count is null (never a silent partial sum) whenever any of its
// parts is null, because a wrong number reads as more true than a dash —
// see the function's own header. Verified here directly, without the
// dev server, since that's the part with real branching logic; the render
// (QueueTriageBoard) is pre-existing, unchanged except for a new optional
// prop that defaults to a no-op.
import { describe, expect, it } from 'vitest';
import { groupIntoReviewCards, REVIEW_CARD_LABELS, type QueueSummaryRow } from './queue-summary';

function row(key: string, overrides: Partial<QueueSummaryRow> = {}): QueueSummaryRow {
  return { key, count: 0, ...overrides };
}

const BASE_ROWS: QueueSummaryRow[] = [
  row('contributions', { count: 3, oldestDays: 12 }),
  row('candidates', { count: 0, hiddenInternal: 5, oldestDays: null }),
  row('submissions', { count: 2, oldestDays: 4 }),
  row('claims', { count: 0, oldestDays: null }),
  row('identity', { count: 1, hiddenInternal: 0, oldestDays: 20 }),
  row('gdpr', { count: 1, oldestDays: 25, slaDueInDays: 5 }),
  row('domain_mismatch', { count: 0 }),
  row('suspicious', { count: 2 }),
  row('fraud', { count: 0 }),
  row('key_people', { count: null }),
  row('community', { count: null }),
  row('competitor_intel', { count: null }),
];

describe('groupIntoReviewCards', () => {
  it('returns exactly the 6 keys REVIEW_CARD_LABELS names, in that order', () => {
    const cards = groupIntoReviewCards(BASE_ROWS);
    expect(cards.map((c) => c.key)).toEqual(Object.keys(REVIEW_CARD_LABELS));
  });

  it('sums new_investors from candidates+submissions and takes the only known oldest', () => {
    const card = groupIntoReviewCards(BASE_ROWS).find((c) => c.key === 'new_investors')!;
    expect(card.count).toBe(2); // 0 (candidates) + 2 (submissions)
    expect(card.hiddenInternal).toBe(5); // candidates' own hidden count carries through
    expect(card.oldestDays).toBe(4); // candidates has none pending (null), submissions is 4 — only one side known, so max/min agree here
  });

  // Prompt 872 §A — the case the test above can't catch: with BOTH sides
  // known, the fused oldest is the OLDER (larger age) of the two, never the
  // newer one. A prior version of this file used minKnown here — with
  // candidates=30d/submissions=4d it would have read "oldest: 4 days" while
  // a month-old item waited, the exact "wrong number reads as more true
  // than a dash" mistake sumKnown exists to avoid, just on this field.
  it('with both parts known, the fused oldest is the OLDER one, not the newer', () => {
    const rows = BASE_ROWS.map((r) => {
      if (r.key === 'candidates') return row('candidates', { count: 1, oldestDays: 30 });
      if (r.key === 'submissions') return row('submissions', { count: 1, oldestDays: 4 });
      return r;
    });
    const card = groupIntoReviewCards(rows).find((c) => c.key === 'new_investors')!;
    expect(card.oldestDays).toBe(30);
  });

  it('trust_safety oldest is also the older of its two known parts', () => {
    const rows = BASE_ROWS.map((r) => {
      if (r.key === 'suspicious') return row('suspicious', { count: 1, oldestDays: 7 });
      if (r.key === 'fraud') return row('fraud', { count: 1, oldestDays: 12 });
      // community must be known too, or trustSafetyCount (and so oldestDays,
      // per §B) stays null regardless of suspicious/fraud's own ages.
      if (r.key === 'community') return row('community', { count: 0, oldestDays: null });
      return r;
    });
    const card = groupIntoReviewCards(rows).find((c) => c.key === 'trust_safety')!;
    expect(card.oldestDays).toBe(12);
  });

  it('passes contributions/identity/claims/gdpr through unchanged (1:1 sources)', () => {
    const cards = groupIntoReviewCards(BASE_ROWS);
    expect(cards.find((c) => c.key === 'contributions')).toMatchObject({ count: 3, oldestDays: 12 });
    expect(cards.find((c) => c.key === 'identity')).toMatchObject({ count: 1, hiddenInternal: 0, oldestDays: 20 });
    expect(cards.find((c) => c.key === 'claims')).toMatchObject({ count: 0, oldestDays: null });
    expect(cards.find((c) => c.key === 'gdpr')).toMatchObject({ count: 1, oldestDays: 25, slaDueInDays: 5 });
  });

  it('trust_safety is null — never a silent partial sum — while community stays uncounted', () => {
    // suspicious=2, fraud=0 are both known; community is always null today
    // (its real count needs its own tab, per queue-summary's own header).
    // A null count here, not "2", is the whole point of sumKnown.
    const card = groupIntoReviewCards(BASE_ROWS).find((c) => c.key === 'trust_safety')!;
    expect(card.count).toBeNull();
  });

  // Prompt 872 §B — the same discipline extended to oldest: BASE_ROWS'
  // suspicious has a real oldestDays nowhere set (undefined), but even if it
  // did, count being null (community unknown) must force oldestDays null
  // too — the card cannot claim to know the queue's oldest item while also
  // admitting it doesn't know the queue's size.
  it('trust_safety oldest is null whenever its count is null, even if suspicious/fraud have known ages', () => {
    const rows = BASE_ROWS.map((r) => (r.key === 'suspicious' ? row('suspicious', { count: 2, oldestDays: 9 }) : r));
    const card = groupIntoReviewCards(rows).find((c) => c.key === 'trust_safety')!;
    expect(card.count).toBeNull(); // community still unknown
    expect(card.oldestDays).toBeNull(); // must not report 9 while count is unknown
  });

  it('trust_safety becomes a real number once community is a real number too', () => {
    const rows = BASE_ROWS.map((r) => (r.key === 'community' ? row('community', { count: 4, oldestDays: 2 }) : r));
    const card = groupIntoReviewCards(rows).find((c) => c.key === 'trust_safety')!;
    expect(card.count).toBe(6); // 2 (suspicious) + 0 (fraud) + 4 (community)
  });

  it('a genuinely all-zero, nothing-hidden card reports a real 0, not null', () => {
    const rows = BASE_ROWS.map((r) => (r.key === 'contributions' ? row('contributions', { count: 0, oldestDays: null }) : r));
    const card = groupIntoReviewCards(rows).find((c) => c.key === 'contributions')!;
    expect(card.count).toBe(0);
    expect(card.oldestDays).toBeNull();
  });

  it('does not throw when a source row is missing entirely', () => {
    const sparse = BASE_ROWS.filter((r) => r.key !== 'submissions');
    const cards = groupIntoReviewCards(sparse);
    const newInvestors = cards.find((c) => c.key === 'new_investors')!;
    expect(newInvestors.count).toBeNull(); // candidates known (0), submissions missing -> unknown
  });
});
