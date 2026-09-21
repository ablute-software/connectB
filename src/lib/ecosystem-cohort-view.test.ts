import { describe, expect, it } from 'vitest';
import { segmentLabel, periodLabel, filenameSlug, heatCellColor, buildEcosystemCsvRows } from './ecosystem-cohort-view';

describe('segmentLabel', () => {
  it('joins the filters that are set', () => {
    expect(segmentLabel({ country: 'Portugal', sector: 'Fintech', stage: 'seed' })).toBe('Portugal · Fintech · Seed');
  });
  it('falls back to "All startups" with no filters', () => {
    expect(segmentLabel({})).toBe('All startups');
  });
  it('ignores a whitespace-only country', () => {
    expect(segmentLabel({ country: '  ' })).toBe('All startups');
  });
  it('falls back to the raw value for an unknown stage key', () => {
    expect(segmentLabel({ stage: 'mystery' })).toBe('mystery');
  });
});

describe('periodLabel', () => {
  it('maps known values', () => {
    expect(periodLabel('30')).toBe('Last 30 days');
    expect(periodLabel('90')).toBe('Last 90 days');
  });
  it('defaults to "All time" for empty/undefined', () => {
    expect(periodLabel('')).toBe('All time');
    expect(periodLabel(undefined)).toBe('All time');
  });
});

describe('filenameSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(filenameSlug('Portugal · Fintech · Seed')).toBe('portugal-fintech-seed');
  });
  it('never returns an empty string', () => {
    expect(filenameSlug('')).toBe('all-startups');
    expect(filenameSlug('···')).toBe('all-startups');
  });
});

describe('heatCellColor', () => {
  it('escalates with prevalence', () => {
    expect(heatCellColor(10)).toContain('red-50');
    expect(heatCellColor(25)).toContain('red-200');
    expect(heatCellColor(45)).toContain('B00000');
    expect(heatCellColor(65)).toContain('7C1D1D');
  });
});

describe('buildEcosystemCsvRows', () => {
  it('never includes anything but the aggregates already shown on screen — no org identifiers', () => {
    const rows = buildEcosystemCsvRows(
      { country: 'Portugal', sector: 'Fintech', stage: 'seed', sinceDays: '90' },
      { cohortN: 12, sri: { score: 72 }, heatmap: [{ category: 'product', severity: 'high', pctOfCohort: 45 }] },
    );
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toMatch(/org_id|orgId|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(rows.find((r) => r.field === 'Segment')?.value).toBe('Portugal · Fintech · Seed');
    expect(rows.find((r) => r.field === 'Cohort size (n)')?.value).toBe(12);
    expect(rows.find((r) => r.field === 'SRI v0')?.value).toBe(72);
    const heatmapRow = rows.find((r) => r.field === 'Weakness map');
    expect(heatmapRow).toEqual({ field: 'Weakness map', category: 'Product', severity: 'High', value: '45%' });
  });

  it('always leads with the "not representative" disclaimer', () => {
    const rows = buildEcosystemCsvRows({}, { cohortN: 8, sri: null, heatmap: [] });
    expect(rows[0]).toEqual({ field: 'Note', category: '', severity: '', value: 'Internal sample — not representative of the full market' });
  });

  it('renders an empty SRI as an empty value, not a misleading zero', () => {
    const rows = buildEcosystemCsvRows({}, { cohortN: 8, sri: null, heatmap: [] });
    expect(rows.find((r) => r.field === 'SRI v0')?.value).toBe('');
  });
});
