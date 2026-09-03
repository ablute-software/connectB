import { describe, expect, it } from 'vitest';
import {
  derivedFoundedEvent, isDerivedEvent, isFoundingCandidate,
  DERIVED_FOUNDED_ID, DERIVED_FOUNDED_TITLE,
} from './roadmap-derived';

// Prompt 540 RC2 — the founding marker is a projection of org.founded_year,
// not a stored AI suggestion. These tests pin the properties that the old
// design could not have: it appears without a save round trip, it moves
// when the year changes, and it can never become a second copy of itself.

const CATEGORIES = [
  { id: 'c1', label: 'Technology & Product' },
  { id: 'c2', label: 'Team & Company' },
  { id: 'c3', label: 'Funding' },
];

describe('derivedFoundedEvent', () => {
  it('is null when no year is set — no year, no mark (§13)', () => {
    expect(derivedFoundedEvent({}, [], CATEGORIES)).toBeNull();
    expect(derivedFoundedEvent({ founded_year: null }, [], CATEGORIES)).toBeNull();
  });

  it('places the mark on January 1st of the founding year, in Team & Company', () => {
    const e = derivedFoundedEvent({ founded_year: 2020 }, [], CATEGORIES);
    expect(e).toMatchObject({
      id: DERIVED_FOUNDED_ID, title: DERIVED_FOUNDED_TITLE, date: '2020-01-01',
      status: 'done', date_precision: 'approx', category_id: 'c2', derived: true,
    });
  });

  it('falls back to no category when the founder has no Team & Company lane', () => {
    // Deleted or renamed: the mark lands in General rather than vanishing.
    const e = derivedFoundedEvent({ founded_year: 2020 }, [], [{ id: 'c1', label: 'Technology & Product' }]);
    expect(e?.category_id).toBeNull();
  });

  it('changing the year moves the SAME mark — it never becomes a second one', () => {
    // This is the §9 duplicate bug, made structurally impossible: same id,
    // new date, and nothing was written either time.
    const first = derivedFoundedEvent({ founded_year: 2020 }, [], CATEGORIES);
    const second = derivedFoundedEvent({ founded_year: 2021 }, [], CATEGORIES);
    expect(first?.id).toBe(second?.id);
    expect(first?.date).toBe('2020-01-01');
    expect(second?.date).toBe('2021-01-01');
  });

  it('steps aside when a REAL founding event already exists — the founder’s data wins', () => {
    // Founders who accepted the old AI suggestion have a genuine
    // roadmap_events row. Two founding marks would be worse than one.
    const existing = [{ title: 'Company founded', date: '2020-01-01' }];
    expect(derivedFoundedEvent({ founded_year: 2020 }, existing, CATEGORIES)).toBeNull();
  });

  it('recognises a differently-worded founding event as the same fact', () => {
    // isDuplicateRoadmapEvent compares word stems, so this is not an exact
    // title match — which is the whole reason it is reused here.
    const existing = [{ title: 'Founded the company in Lisbon', date: '2020-06-01' }];
    expect(derivedFoundedEvent({ founded_year: 2020 }, existing, CATEGORIES)).toBeNull();
  });

  it('still renders when the only existing events are unrelated', () => {
    const existing = [
      { title: 'CE marking obtained', date: '2020-03-01' },
      { title: 'Seed round closed', date: '2021-09-01' },
    ];
    expect(derivedFoundedEvent({ founded_year: 2020 }, existing, CATEGORIES)?.date).toBe('2020-01-01');
  });

  it('rejects an implausible year rather than dragging the time domain to it', () => {
    expect(derivedFoundedEvent({ founded_year: 12 }, [], CATEGORIES)).toBeNull();
    expect(derivedFoundedEvent({ founded_year: 99999 }, [], CATEGORIES)).toBeNull();
    expect(derivedFoundedEvent({ founded_year: NaN }, [], CATEGORIES)).toBeNull();
  });
});

describe('isDerivedEvent — the read-only guard every editing surface checks', () => {
  it('is true for the derived mark and false for a real row', () => {
    expect(isDerivedEvent(derivedFoundedEvent({ founded_year: 2020 }, [], CATEGORIES))).toBe(true);
    expect(isDerivedEvent({ id: 'a-real-uuid' })).toBe(false);
    expect(isDerivedEvent(null)).toBe(false);
  });
});

describe('isFoundingCandidate — the model never proposes the founding again (§4)', () => {
  it('filters "Company founded" in the founding year', () => {
    expect(isFoundingCandidate({ title: 'Company founded', date: '2021-01-01' }, 2021)).toBe(true);
  });

  it('filters it when the year is in the TITLE rather than the date', () => {
    // A real shape the model has produced.
    expect(isFoundingCandidate({ title: 'Company founded 2021', date: '2021-03-04' }, 2021)).toBe(true);
  });

  it('keeps a founding in a DIFFERENT year — that is a real, separate event', () => {
    expect(isFoundingCandidate({ title: 'Founded the Berlin office', date: '2023-05-01' }, 2021)).toBe(false);
  });

  it('keeps events that are not about founding at all', () => {
    expect(isFoundingCandidate({ title: 'Seed round closed', date: '2021-01-01' }, 2021)).toBe(false);
  });

  it('does NOT confuse the verb "found" with incorporation', () => {
    // A bare "found" stem would have filtered this out in the founding
    // year — an ordinary event silently missing from the suggestions.
    expect(isFoundingCandidate({ title: 'Found a lead investor', date: '2021-01-01' }, 2021)).toBe(false);
    expect(isFoundingCandidate({ title: 'Foundry partnership signed', date: '2021-01-01' }, 2021)).toBe(false);
    // The real forms still match.
    for (const t of ['Company founded', 'Founding of the company', 'Founder joined full-time']) {
      expect(isFoundingCandidate({ title: t, date: '2021-01-01' }, 2021)).toBe(true);
    }
  });

  it('does nothing at all when the org has no founding year', () => {
    expect(isFoundingCandidate({ title: 'Company founded', date: '2021-01-01' }, null)).toBe(false);
  });
});
