// Prompt 481 — the verification this prompt names by hand: a public-source
// item never appears without the reliability warning, a manual item never
// appears without the founder-responsibility warning, and no item ever
// carries both.
import { describe, expect, it } from 'vitest';
import {
  noticeForSource, isFounderEntered, sanitizeManualRound,
  PUBLIC_SOURCE_NOTICE, MANUAL_ENTRY_NOTICE, type CapitalRoundSource,
} from './capital-landscape';

const ALL_SOURCES: CapitalRoundSource[] = ['competitor_tracked', 'research', 'manual'];

describe('the two notices never mix (Prompt 481 §5)', () => {
  it.each(ALL_SOURCES)('%s gets exactly one notice, never both', (source) => {
    const notice = noticeForSource(source);
    const carriesPublic = notice.includes(PUBLIC_SOURCE_NOTICE);
    const carriesManual = notice.includes(MANUAL_ENTRY_NOTICE);
    expect(carriesPublic || carriesManual).toBe(true);
    expect(carriesPublic && carriesManual).toBe(false);
  });

  it('every source resolves to a notice — no provenance can render bare', () => {
    for (const source of ALL_SOURCES) expect(noticeForSource(source).length).toBeGreaterThan(0);
  });

  it('the two notices are genuinely different sentences, not one reworded', () => {
    expect(PUBLIC_SOURCE_NOTICE).not.toBe(MANUAL_ENTRY_NOTICE);
  });
});

describe('a public-source item always carries the reliability warning (§3)', () => {
  it.each(['competitor_tracked', 'research'] as CapitalRoundSource[])('%s → limited public/web search notice', (source) => {
    expect(noticeForSource(source)).toBe(PUBLIC_SOURCE_NOTICE);
  });

  it('says verification may not be reliable, and that it is being worked on — the warning must not read as permanent', () => {
    expect(PUBLIC_SOURCE_NOTICE.toLowerCase()).toContain('may not be 100% reliable');
    expect(PUBLIC_SOURCE_NOTICE.toLowerCase()).toContain('working toward');
  });
});

describe('a manual item always carries the founder-responsibility warning (§4)', () => {
  it('manual → the responsibility notice, never the public one', () => {
    expect(noticeForSource('manual')).toBe(MANUAL_ENTRY_NOTICE);
    expect(noticeForSource('manual')).not.toBe(PUBLIC_SOURCE_NOTICE);
  });

  it('says the founder is responsible for verifying before it reaches investors — explicit, not implied', () => {
    expect(MANUAL_ENTRY_NOTICE.toLowerCase()).toContain('you\'re responsible for verifying');
  });

  it('isFounderEntered is true only for manual', () => {
    expect(isFounderEntered('manual')).toBe(true);
    expect(isFounderEntered('research')).toBe(false);
    expect(isFounderEntered('competitor_tracked')).toBe(false);
  });
});

describe('sanitizeManualRound (§2) — never blocks a founder who only knows part of it', () => {
  it('accepts a round with only a company name', () => {
    expect(sanitizeManualRound({ companyName: 'Acme Diagnostics' })).toEqual({
      companyName: 'Acme Diagnostics', investorName: null, amountEur: null,
      roundType: null, investedAt: null, sourceUrl: null,
    });
  });

  it('keeps every field the founder did give', () => {
    expect(sanitizeManualRound({
      companyName: 'Acme', investorName: 'Nina Capital', amountEur: 2_000_000,
      roundType: 'Seed', investedAt: '2026-03-01', sourceUrl: 'https://example.com/press',
    })).toEqual({
      companyName: 'Acme', investorName: 'Nina Capital', amountEur: 2_000_000,
      roundType: 'Seed', investedAt: '2026-03-01', sourceUrl: 'https://example.com/press',
    });
  });

  it('rejects an entry with no company name — the one thing that makes a round identifiable', () => {
    expect(sanitizeManualRound({ investorName: 'Nina Capital', amountEur: 1 })).toBeNull();
    expect(sanitizeManualRound({ companyName: '   ' })).toBeNull();
  });

  it('drops an unparseable date rather than persisting something that sorts wrongly forever', () => {
    expect(sanitizeManualRound({ companyName: 'Acme', investedAt: 'last spring' })?.investedAt).toBeNull();
  });

  it('drops a negative or non-numeric amount rather than storing a nonsense figure', () => {
    expect(sanitizeManualRound({ companyName: 'Acme', amountEur: -5 })?.amountEur).toBeNull();
    expect(sanitizeManualRound({ companyName: 'Acme', amountEur: 'a lot' })?.amountEur).toBeNull();
  });

  it('rounds a fractional amount rather than rejecting it — cents in a round size are noise, not signal', () => {
    expect(sanitizeManualRound({ companyName: 'Acme', amountEur: 1_500_000.4 })?.amountEur).toBe(1_500_000);
  });
});
