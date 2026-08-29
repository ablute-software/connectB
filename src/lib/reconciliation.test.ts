import { describe, expect, it } from 'vitest';
import { computeReconciliationSignature, type ReconcilableDocument } from './reconciliation';
import type { CompanyClaim } from './types';

function claim(overrides: Partial<CompanyClaim> = {}): CompanyClaim {
  return {
    id: 'claim-1', category: 'validacao_externa', statement: 'Received the WomenTechEU award.',
    evidenceClass: 5, specificity: 'high', sourceKind: 'founder_answer', status: 'accepted',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function doc(overrides: Partial<ReconcilableDocument> = {}): ReconcilableDocument {
  return {
    id: 'doc-1', name: 'Woman In Tech Agreement.pdf', folderName: null,
    extraction: null, extractionUpdatedAt: null,
    ...overrides,
  };
}

// Prompt 461 — the one thing this signature exists to catch: a document
// re-extracted in place (same id, same name) must invalidate the cache even
// though nothing else about it changed. Before §A/§B, extractionUpdatedAt
// was always null (the query silently failed), so this axis never actually
// moved the signature in production.
describe('computeReconciliationSignature', () => {
  it('is deterministic for the same inputs', () => {
    const claims = [claim()];
    const docs = [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-01T00:00:00Z' })];
    expect(computeReconciliationSignature(claims, docs)).toBe(computeReconciliationSignature(claims, docs));
  });

  it('changes when a document\'s extractionUpdatedAt changes, even with the same name and extraction presence', () => {
    const claims = [claim()];
    const before = computeReconciliationSignature(claims, [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-01T00:00:00Z' })]);
    const after = computeReconciliationSignature(claims, [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-02T00:00:00Z' })]);
    expect(before).not.toBe(after);
  });

  it('changes when a document is renamed, even though nothing about its extraction changed — the fixture this engine exists for', () => {
    const claims = [claim()];
    const before = computeReconciliationSignature(claims, [doc({ name: 'Contract.pdf' })]);
    const after = computeReconciliationSignature(claims, [doc({ name: 'Woman In Tech Agreement.pdf' })]);
    expect(before).not.toBe(after);
  });

  it('changes when extraction presence toggles from absent to present', () => {
    const claims = [claim()];
    const before = computeReconciliationSignature(claims, [doc({ extraction: null, extractionUpdatedAt: null })]);
    const after = computeReconciliationSignature(claims, [doc({ extraction: { documentType: 'grant agreement' } as never, extractionUpdatedAt: '2026-01-01T00:00:00Z' })]);
    expect(before).not.toBe(after);
  });

  it('changes when a claim\'s updatedAt changes', () => {
    const docs = [doc()];
    const before = computeReconciliationSignature([claim({ updatedAt: '2026-01-01T00:00:00Z' })], docs);
    const after = computeReconciliationSignature([claim({ updatedAt: '2026-01-02T00:00:00Z' })], docs);
    expect(before).not.toBe(after);
  });

  it('is order-independent for both claims and documents', () => {
    const a = claim({ id: 'claim-a' });
    const b = claim({ id: 'claim-b' });
    const docA = doc({ id: 'doc-a' });
    const docB = doc({ id: 'doc-b' });
    expect(computeReconciliationSignature([a, b], [docA, docB])).toBe(computeReconciliationSignature([b, a], [docB, docA]));
  });
});
