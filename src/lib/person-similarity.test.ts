import { describe, expect, it } from 'vitest';
import {
  CROSS_ORG_REPORT_THRESHOLD, clusterUnverifiedReports, FIELD_SIMILARITY_THRESHOLD,
  nameSimilarity, shouldSurfaceCluster, type ExistenceCluster,
} from './person-similarity';

describe('nameSimilarity', () => {
  it('returns 1 for identical names', () => {
    expect(nameSimilarity('João Silva', 'João Silva')).toBe(1);
  });

  it('returns 1 for names differing only by diacritics/case (normalizeName folds both)', () => {
    expect(nameSimilarity('Joao Silva', 'JOÃO SILVA')).toBe(1);
  });

  it('returns a high but non-1 score for a small typo', () => {
    const score = nameSimilarity('João Silva', 'Joao Silvaa');
    expect(score).toBeGreaterThanOrEqual(FIELD_SIMILARITY_THRESHOLD);
    expect(score).toBeLessThan(1);
  });

  it('returns a low score for genuinely different names', () => {
    expect(nameSimilarity('João Silva', 'Maria Costa')).toBeLessThan(FIELD_SIMILARITY_THRESHOLD);
  });

  it('returns 0 when either name is empty after normalization', () => {
    expect(nameSimilarity('', 'João Silva')).toBe(0);
    expect(nameSimilarity('João Silva', '')).toBe(0);
  });
});

describe('clusterUnverifiedReports', () => {
  it('groups the same person reported by multiple orgs into one cluster', () => {
    const clusters = clusterUnverifiedReports([
      { orgId: 'org-a', personId: 'p1', fullName: 'João Silva', context: 'Acme Ventures' },
      { orgId: 'org-b', personId: 'p2', fullName: 'Joao Silva', context: 'Acme Ventures' },
      { orgId: 'org-c', personId: 'p3', fullName: 'João Silvaa', context: 'Acme Ventures' },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reportOrgIds.size).toBe(3);
    expect(clusters[0].personIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('never merges reports from the same org into inflating the org count', () => {
    const clusters = clusterUnverifiedReports([
      { orgId: 'org-a', personId: 'p1', fullName: 'João Silva', context: 'Acme Ventures' },
      { orgId: 'org-a', personId: 'p2', fullName: 'João Silva', context: 'Acme Ventures' },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reportOrgIds.size).toBe(1);
    expect(clusters[0].personIds).toHaveLength(2);
  });

  it('keeps two same-named people at different entities in separate clusters', () => {
    const clusters = clusterUnverifiedReports([
      { orgId: 'org-a', personId: 'p1', fullName: 'João Silva', context: 'Acme Ventures' },
      { orgId: 'org-b', personId: 'p2', fullName: 'João Silva', context: 'Beta Capital' },
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('keeps genuinely different names at the same entity in separate clusters', () => {
    const clusters = clusterUnverifiedReports([
      { orgId: 'org-a', personId: 'p1', fullName: 'João Silva', context: 'Acme Ventures' },
      { orgId: 'org-b', personId: 'p2', fullName: 'Maria Costa', context: 'Acme Ventures' },
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('shouldSurfaceCluster', () => {
  function makeCluster(orgCount: number): ExistenceCluster {
    return {
      reportOrgIds: new Set(Array.from({ length: orgCount }, (_, i) => `org-${i}`)),
      personIds: [], sampleFullName: 'João Silva', sampleContext: 'Acme Ventures',
    };
  }

  it('does not surface a cluster below the threshold', () => {
    expect(shouldSurfaceCluster(makeCluster(CROSS_ORG_REPORT_THRESHOLD - 1))).toBe(false);
  });

  it('surfaces a cluster right at the threshold', () => {
    expect(shouldSurfaceCluster(makeCluster(CROSS_ORG_REPORT_THRESHOLD))).toBe(true);
  });

  it('with today\'s single-org reality, a real cluster never surfaces', () => {
    expect(shouldSurfaceCluster(makeCluster(1))).toBe(false);
  });
});
