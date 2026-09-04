import { describe, expect, it } from 'vitest';
import {
  WAVE_SIZE, buildPipelineWaves, isTreatedForWaveDosage, waveCardBadge, waveGroupLabel,
} from './pipeline-waves';

type TestCard = { orgId: string; status: string; isArchived?: boolean };
const open = (orgId: string): TestCard => ({ orgId, status: 'open' });
const treated = (orgId: string): TestCard => ({ orgId, status: 'passed' });
const discovery = (n: number, make = open) => Array.from({ length: n }, (_, i) => make(`d${i + 1}`));

describe('buildPipelineWaves', () => {
  // Nuno's screenshot, 04/09: one "Invited" card labelled WAVE 1 and one
  // 55% discovery card labelled WAVE 2 — a wave 1 of discovery that had
  // never existed. This is that exact shape.
  it('does not number the relationship group, and starts discovery at Wave 1', () => {
    const waves = buildPipelineWaves([open('invited')], discovery(3));
    expect(waves).toHaveLength(2);

    expect(waves[0].kind).toBe('relationships');
    expect(waves[0].discoveryIndex).toBeNull();
    expect(waveGroupLabel(waves[0])).toBe('Already in touch with you');
    expect(waveCardBadge(waves[0])).toBeNull();
    expect(waves[0].unlocked).toBe(true);

    expect(waves[1].kind).toBe('discovery');
    expect(waves[1].discoveryIndex).toBe(0);
    expect(waveGroupLabel(waves[1])).toBe('Wave 1');
    expect(waveCardBadge(waves[1])).toBe('W1');
    expect(waves[1].items.map((c) => c.orgId)).toEqual(['d1', 'd2', 'd3']);
  });

  // The label must not depend on whether a relationship group happens to
  // exist — that dependency was the whole bug.
  it('labels the first discovery wave "Wave 1" with or without a relationship group', () => {
    expect(waveGroupLabel(buildPipelineWaves([], discovery(3))[0])).toBe('Wave 1');
    expect(waveGroupLabel(buildPipelineWaves([open('invited')], discovery(3))[1])).toBe('Wave 1');
  });

  // `index` still counts every group, relationship one included: it is the
  // DOM id and the "Review the wave above" scroll target.
  it('keeps index counting every group, for the DOM id and scroll target', () => {
    const waves = buildPipelineWaves([open('invited')], discovery(12));
    expect(waves.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(waves.map((w) => w.discoveryIndex)).toEqual([null, 0, 1]);
  });

  it('chunks discovery by WAVE_SIZE and locks everything after the first', () => {
    expect(WAVE_SIZE).toBe(8);
    const waves = buildPipelineWaves([], discovery(12));
    expect(waves).toHaveLength(2);
    expect(waves[0].items).toHaveLength(8);
    expect(waves[0].unlocked).toBe(true);
    expect(waveGroupLabel(waves[0])).toBe('Wave 1');
    expect(waves[1].items).toHaveLength(4);
    expect(waves[1].unlocked).toBe(false);
    expect(waveGroupLabel(waves[1])).toBe('Wave 2');
    expect(waveCardBadge(waves[1])).toBe('W2');
  });

  it('unlocks the next wave once every card before it is treated', () => {
    const waves = buildPipelineWaves([], discovery(12, treated));
    expect(waves[1].unlocked).toBe(true);
  });

  it('leaves the next wave locked while one earlier card is still open', () => {
    const cards = [...discovery(7, treated), open('d8'), ...discovery(4)];
    expect(buildPipelineWaves([], cards)[1].unlocked).toBe(false);
  });

  it('emits no relationship group when there are no relationship cards', () => {
    const waves = buildPipelineWaves([], discovery(2));
    expect(waves).toHaveLength(1);
    expect(waves[0].kind).toBe('discovery');
    expect(waves[0].index).toBe(0);
  });

  it('emits only the relationship group when discovery is empty', () => {
    const waves = buildPipelineWaves([open('invited')], []);
    expect(waves).toHaveLength(1);
    expect(waveGroupLabel(waves[0])).toBe('Already in touch with you');
  });
});

// Moved here with the function itself (Prompt 850 §C); investor-pipeline.ts
// re-exports it, and investor-pipeline.test.ts still pins that re-export.
describe('isTreatedForWaveDosage', () => {
  it('counts a decided card as treated', () => {
    expect(isTreatedForWaveDosage({ status: 'interested' })).toBe(true);
    expect(isTreatedForWaveDosage({ status: 'passed' })).toBe(true);
  });

  it('counts an archived-but-open card as treated — tidying up IS treating it', () => {
    expect(isTreatedForWaveDosage({ status: 'open', isArchived: true })).toBe(true);
  });

  it('leaves an untouched open card untreated', () => {
    expect(isTreatedForWaveDosage({ status: 'open' })).toBe(false);
  });
});
