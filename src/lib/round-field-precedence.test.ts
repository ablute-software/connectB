import { describe, it, expect } from 'vitest';
import {
  ROUND_SOURCE_FIELDS, decideRoundField, isRoundSourceField, nextRoundFieldsSource,
  roundValueKey, roundValuesEqual, type RoundFieldCandidate,
} from './round-field-precedence';

const NOW = '2026-09-02T12:00:00.000Z';

function candidate(value: RoundFieldCandidate['value']): RoundFieldCandidate {
  return { value, documentId: 'doc-1', documentName: 'Term sheet.pdf', extractedAt: '2026-09-01T09:00:00Z', page: 3 };
}

describe('roundValueKey / roundValuesEqual', () => {
  it('treats instrument lists as sets, not sequences', () => {
    expect(roundValuesEqual(['safe', 'equity'], ['equity', 'safe'])).toBe(true);
    expect(roundValuesEqual(['safe'], ['safe', 'equity'])).toBe(false);
  });

  it('treats empty, blank and absent as the same "nothing"', () => {
    for (const v of [null, undefined, '', '   ', [] as string[]]) expect(roundValueKey(v)).toBeNull();
  });

  it('does not confuse a number with its string form being different', () => {
    expect(roundValuesEqual(1300000, 1300000)).toBe(true);
    expect(roundValuesEqual(1300000, 1500000)).toBe(false);
  });
});

describe('decideRoundField — §C.1, a field with no human decision on it', () => {
  it('offers a candidate for a never-filled field', () => {
    const d = decideRoundField({ current: null, entry: undefined, candidate: candidate(1300000) });
    expect(d.kind).toBe('suggest');
    if (d.kind === 'suggest') expect(d.replacesDocumentValue).toBe(false);
  });

  it('offers an updated candidate over a value that itself came from a document', () => {
    // "ao fim de algum tempo serão os documentos (quando atualizados)" —
    // nothing human is being overridden here, so no conflict is raised.
    const d = decideRoundField({
      current: 1000000,
      entry: { source: 'document', document_id: 'doc-old', at: '2026-08-01T00:00:00Z' },
      candidate: candidate(1300000),
    });
    expect(d.kind).toBe('suggest');
    if (d.kind === 'suggest') expect(d.replacesDocumentValue).toBe(true);
  });

  it('says nothing when the document agrees with what is already there', () => {
    expect(decideRoundField({ current: 1300000, entry: undefined, candidate: candidate(1300000) }).kind).toBe('none');
    expect(decideRoundField({
      current: 1300000, entry: { source: 'manual', at: NOW }, candidate: candidate(1300000),
    }).kind).toBe('none');
  });

  it('says nothing when there is no candidate, or the candidate is empty', () => {
    expect(decideRoundField({ current: null, entry: undefined, candidate: undefined }).kind).toBe('none');
    expect(decideRoundField({ current: null, entry: undefined, candidate: candidate('  ') }).kind).toBe('none');
    expect(decideRoundField({ current: null, entry: undefined, candidate: candidate([]) }).kind).toBe('none');
  });
});

describe('decideRoundField — §C.2, a field the founder decided by hand', () => {
  it('never overwrites: a differing document value becomes a conflict to resolve', () => {
    const d = decideRoundField({
      current: 1300000, entry: { source: 'manual', at: NOW }, candidate: candidate(1500000),
    });
    expect(d.kind).toBe('conflict');
    if (d.kind === 'conflict') {
      expect(d.current).toBe(1300000);
      expect(d.candidate.value).toBe(1500000);
      expect(d.candidate.documentName).toBe('Term sheet.pdf');
    }
  });

  it('stops asking once the founder has kept their own value against this exact candidate', () => {
    const entry = { source: 'manual' as const, at: NOW, dismissed_candidate: '1500000' };
    expect(decideRoundField({ current: 1300000, entry, candidate: candidate(1500000) }).kind).toBe('none');
  });

  it('asks again when a DIFFERENT candidate turns up after a dismissal', () => {
    const entry = { source: 'manual' as const, at: NOW, dismissed_candidate: '1500000' };
    expect(decideRoundField({ current: 1300000, entry, candidate: candidate(1800000) }).kind).toBe('conflict');
  });

  it('has nothing to protect once the manual value has been cleared', () => {
    const d = decideRoundField({
      current: null, entry: { source: 'manual', at: NOW }, candidate: candidate(1300000),
    });
    expect(d.kind).toBe('suggest');
  });

  it('protects a manually chosen instrument list against a different one', () => {
    const d = decideRoundField({
      current: ['safe'], entry: { source: 'manual', at: NOW }, candidate: candidate(['equity', 'safe']),
    });
    expect(d.kind).toBe('conflict');
  });
});

describe('nextRoundFieldsSource', () => {
  it('marks an ordinary save as manual — the protective default', () => {
    const next = nextRoundFieldsSource({ existing: null, patch: { round_target_eur: 1300000 }, now: NOW });
    expect(next.round_target_eur).toEqual({ source: 'manual', at: NOW });
  });

  it('marks only the fields the caller says came from a document', () => {
    const next = nextRoundFieldsSource({
      existing: null,
      patch: { round_target_eur: 1300000, round_runway_months: 9 },
      accepted: { round_target_eur: { documentId: 'doc-1', documentName: 'Term sheet.pdf', extractedAt: '2026-09-01T09:00:00Z' } },
      now: NOW,
    });
    expect(next.round_target_eur).toEqual({
      source: 'document', document_id: 'doc-1', document_name: 'Term sheet.pdf',
      extracted_at: '2026-09-01T09:00:00Z', at: NOW,
    });
    expect(next.round_runway_months).toEqual({ source: 'manual', at: NOW });
  });

  it('records the rejected candidate when the founder keeps their own value', () => {
    const next = nextRoundFieldsSource({
      existing: { round_target_eur: { source: 'manual', at: '2026-08-01T00:00:00Z' } },
      patch: {}, keptOwn: { round_target_eur: '1500000' }, now: NOW,
    });
    expect(next.round_target_eur).toEqual({ source: 'manual', at: NOW, dismissed_candidate: '1500000' });
  });

  it('leaves fields the save did not touch exactly as they were', () => {
    const existing = { round_runway_months: { source: 'document' as const, document_id: 'doc-9', at: '2026-08-01T00:00:00Z' } };
    const next = nextRoundFieldsSource({ existing, patch: { round_target_eur: 1 }, now: NOW });
    expect(next.round_runway_months).toEqual(existing.round_runway_months);
  });

  it('ignores non-round keys in the patch', () => {
    const next = nextRoundFieldsSource({ existing: null, patch: { name: 'ablute_', website: 'x' }, now: NOW });
    expect(Object.keys(next)).toEqual([]);
  });
});

describe('the field list itself', () => {
  it('covers the nine fields §A extracts, and excludes founder-process fields', () => {
    expect([...ROUND_SOURCE_FIELDS]).toHaveLength(9);
    expect(isRoundSourceField('round_target_eur')).toBe(true);
    // Never document-sourced: what is soft-circled, and whether they are
    // raising at all, are facts about the founder, not about a deck.
    expect(isRoundSourceField('round_secured_eur')).toBe(false);
    expect(isRoundSourceField('round_raising')).toBe(false);
  });
});
