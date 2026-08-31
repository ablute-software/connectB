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
      outcomes: { inserted: 1, enriched: 1, competitor_backfilled: 0, unchanged: 1 },
      factsWritten: 0,
    })).toBe('1 inserted, 1 enriched, 0 competitor(s) backfilled; 2 of 3 competitor(s) arrived without the facets a classification needs');
  });

  it('says nothing about facets when every competitor carried them', () => {
    expect(describeExtractionTelemetry({
      rawSections: countRawSections({ competitors: [{}] }),
      competitors: auditRawCompetitors({ competitors: [fullCompetitor()] }),
      parsedBySection: { players: 1 },
      outcomes: { inserted: 1, enriched: 0, competitor_backfilled: 0, unchanged: 0 },
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
