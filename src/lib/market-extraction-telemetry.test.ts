import { describe, expect, it } from 'vitest';
import {
  auditRawCompetitors,
  countProposalsBySection,
  countRawSections,
  describeExtractionTelemetry,
  emptyOutcomeTally,
} from './market-extraction-telemetry';

// The shape the model actually returns for a competitor when it fills
// everything in — Prompt 478's three facet fields included.
function fullCompetitor(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Withings', country: 'France', stage: 'growth', document_index: 1, page: 2,
    candidateKind: 'COMPANY', candidateStage: 'commercial',
    relation: { problemOrJobOverlap: { state: 'MATCH', note: 'same job' } },
    ...overrides,
  };
}

describe('countRawSections — what the model put in the tool call', () => {
  it('counts every section, and zero for the ones it left out', () => {
    expect(countRawSections({ competitors: [{}, {}], trends: [{}] }))
      .toEqual({ market_size: 0, growth: 0, segments: 0, competitors: 2, trends: 1, regulatory: 0 });
  });

  it('survives the shapes a model can actually produce', () => {
    const allZero = { market_size: 0, growth: 0, segments: 0, competitors: 0, trends: 0, regulatory: 0 };
    expect(countRawSections(null)).toEqual(allZero);
    expect(countRawSections(undefined)).toEqual(allZero);
    expect(countRawSections({})).toEqual(allZero);
    // A section returned as an object instead of an array is not a crash.
    expect(countRawSections({ competitors: { name: 'x' } })).toEqual(allZero);
  });
});

describe('auditRawCompetitors — the second bar, after parsing', () => {
  it('separates "has a name and an index" from "can be classified"', () => {
    const audit = auditRawCompetitors({
      competitors: [
        fullCompetitor(),
        // The exact shape hypothesis (c) is about: valid, storable, and
        // carrying no classification, so it collides and changes nothing.
        { name: 'Bisu', document_index: 1 },
        { name: 'Vivoo', document_index: 1, candidateKind: 'COMPANY' }, // partial
      ],
    });

    expect(audit.total).toBe(3);
    expect(audit.withName).toBe(3);
    expect(audit.withDocumentIndex).toBe(3);
    expect(audit.withCandidateKind).toBe(2);
    expect(audit.withCandidateStage).toBe(1);
    expect(audit.withRelation).toBe(1);
    expect(audit.withAllThreeFacetFields).toBe(1);
  });

  it('reports which document indexes were cited, so an off-by-one is visible', () => {
    // Hypothesis (b): the route offers index 1 for a single document; if the
    // model answers 0, resolveDoc drops every item and nothing is stored.
    const audit = auditRawCompetitors({
      competitors: [{ name: 'A', document_index: 0 }, { name: 'B', document_index: 0 }, { name: 'C' }],
    });
    expect(audit.citedDocumentIndexes).toEqual([0]);
    expect(audit.withDocumentIndex).toBe(2);
    expect(audit.total).toBe(3);
  });

  it('an empty or absent competitors array is not an error', () => {
    expect(auditRawCompetitors({}).total).toBe(0);
    expect(auditRawCompetitors(null).total).toBe(0);
    expect(auditRawCompetitors({ competitors: [] }).citedDocumentIndexes).toEqual([]);
  });
});

describe('countProposalsBySection — what survived the parser', () => {
  it('counts by the internal section names, not the tool-call ones', () => {
    expect(countProposalsBySection([{ section: 'players' }, { section: 'players' }, { section: 'sizing' }]))
      .toEqual({ players: 2, sizing: 1 });
  });

  it('is empty when everything was dropped', () => {
    expect(countProposalsBySection([])).toEqual({});
  });
});

describe('describeExtractionTelemetry — the three explanations that look identical from outside', () => {
  const noCompetitors = auditRawCompetitors({});

  it('(a) the model reported nothing', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({}),
      competitors: noCompetitors,
      parsedBySection: {},
      outcomes: emptyOutcomeTally(),
      factsWritten: 0,
    })).toBe('the model reported nothing in any section');
  });

  it('(b) it reported items and the parser dropped every one', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}, {}, {}] }),
      competitors: auditRawCompetitors({ competitors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }),
      parsedBySection: {},
      outcomes: emptyOutcomeTally(),
      factsWritten: 0,
    })).toBe('the model reported 3 item(s) and every one was dropped before storage');
  });

  it('(c) everything parsed and collided with rows that already exist', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}, {}] }),
      competitors: auditRawCompetitors({ competitors: [{ name: 'A', document_index: 1 }, { name: 'B', document_index: 1 }] }),
      parsedBySection: { players: 2 },
      outcomes: { ...emptyOutcomeTally(), unchanged: 2 },
      factsWritten: 0,
    })).toBe('2 item(s) parsed and none changed anything — 2 collided with rows that already exist');
  });

  it('a pass that did change something says so, and flags unclassified competitors', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}, {}, {}] }),
      competitors: auditRawCompetitors({
        competitors: [fullCompetitor(), { name: 'B', document_index: 1 }, { name: 'C', document_index: 1 }],
      }),
      parsedBySection: { players: 3 },
      outcomes: { ...emptyOutcomeTally(), inserted: 1, enriched: 1, unchanged: 1 },
      factsWritten: 0,
    })).toBe('1 inserted, 1 enriched, 0 competitor(s) backfilled; 2 of 3 competitor(s) arrived without the facets a classification needs');
  });

  it('says nothing about facets when every competitor carried them', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}] }),
      competitors: auditRawCompetitors({ competitors: [fullCompetitor()] }),
      parsedBySection: { players: 1 },
      outcomes: { ...emptyOutcomeTally(), inserted: 1 },
      factsWritten: 0,
    })).toBe('1 inserted, 0 enriched, 0 competitor(s) backfilled');
  });
});

describe('describeExtractionTelemetry — the branch the adversarial pass found', () => {
  it('does not claim collisions when the legacy loop never ran', () => {
    // Every proposal was growth/sizing, so it went to the typed pipeline and
    // the legacy loop saw nothing. The old wording said "none changed
    // anything — 0 collided with rows that already exist", which is wrong
    // twice over.
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ growth: [{}, {}] }),
      competitors: auditRawCompetitors({}),
      parsedBySection: { growth: 2 },
      outcomes: emptyOutcomeTally(),
      factsWritten: 0,
    })).toBe('2 item(s) parsed, none reached the legacy loop and none became a typed fact');
  });

  it('counts typed facts as a real change', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ growth: [{}, {}] }),
      competitors: auditRawCompetitors({}),
      parsedBySection: { growth: 2 },
      outcomes: emptyOutcomeTally(),
      factsWritten: 2,
    })).toBe('0 inserted, 0 enriched, 0 competitor(s) backfilled, 2 typed fact(s) written (nothing went through the legacy loop)');
  });
});

// ---------------------------------------------------------------------------
// Prompt 492 — the bucket that separates "we read the same document twice"
// from "a proposal was swallowed by a row from somewhere else entirely".

describe('describeExtractionTelemetry — cross-document title collisions (Prompt 492 §3)', () => {
  const CLAUSE_2 = '; 2 proposal(s) were not stored because the title was already owned by an item from another document'
    + ' — the contents were never compared, so there may be new information here that nobody has seen';
  const CLAUSE_1 = '; 1 proposal(s) were not stored because the title was already owned by an item from another document'
    + ' — the contents were never compared, so there may be new information here that nobody has seen';

  it('names them when nothing changed and every collision was cross-document', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ trends: [{}, {}] }),
      competitors: auditRawCompetitors({}),
      parsedBySection: { trends: 2 },
      outcomes: { ...emptyOutcomeTally(), title_collision_cross_document: 2 },
      factsWritten: 0,
    })).toBe('2 item(s) parsed and none changed anything — 2 collided with rows that already exist' + CLAUSE_2);
  });

  it('counts both kinds of collision in the total, and names only the cross-document ones', () => {
    // The distinction is the whole point: 3 proposals collided, but only 1 of
    // them may have lost something — the other 2 were the same document read
    // again.
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ trends: [{}, {}, {}] }),
      competitors: auditRawCompetitors({}),
      parsedBySection: { trends: 3 },
      outcomes: { ...emptyOutcomeTally(), unchanged: 2, title_collision_cross_document: 1 },
      factsWritten: 0,
    })).toBe('3 item(s) parsed and none changed anything — 3 collided with rows that already exist' + CLAUSE_1);
  });

  it('is reported even when the pass DID change other things', () => {
    // A cross-document collision is never folded into a success count: the
    // sentence says what landed and, separately, what was swallowed.
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}, {}] }),
      competitors: auditRawCompetitors({ competitors: [fullCompetitor(), fullCompetitor({ name: 'Bisu' })] }),
      parsedBySection: { players: 2 },
      outcomes: { ...emptyOutcomeTally(), inserted: 1, title_collision_cross_document: 1 },
      factsWritten: 0,
    })).toBe('1 inserted, 0 enriched, 0 competitor(s) backfilled' + CLAUSE_1);
  });

  it('says nothing at all when there were none — the clause never appears empty', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}] }),
      competitors: auditRawCompetitors({ competitors: [fullCompetitor()] }),
      parsedBySection: { players: 1 },
      outcomes: { ...emptyOutcomeTally(), inserted: 1 },
      factsWritten: 0,
    })).not.toContain('another document');
  });

  it('a cross-document collision counts as having gone through the legacy loop', () => {
    // legacyTotal drives the "(nothing went through the legacy loop)" note.
    // A swallowed proposal reached the loop — it just did not survive it —
    // so claiming the loop never ran would be a second false statement on
    // top of the one this prompt is removing.
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}], growth: [{}] }),
      competitors: auditRawCompetitors({ competitors: [fullCompetitor()] }),
      parsedBySection: { players: 1, growth: 1 },
      outcomes: { ...emptyOutcomeTally(), title_collision_cross_document: 1 },
      factsWritten: 1,
    })).not.toContain('nothing went through the legacy loop');
  });
});
