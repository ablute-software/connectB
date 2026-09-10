import { describe, expect, it } from 'vitest';
import {
  pipelineGroupForStatus, pipelineStageLabel, pipelineCounts,
  PIPELINE_CARDS, PIPELINE_GROUPS,
} from './pipeline-taxonomy';

// The real ablute_ distribution confirmed by SQL in Prompt 650 v2 §0.
const ABLUTE = [
  ...Array(641).fill('not_contacted'),
  ...Array(49).fill('contacted'),
  ...Array(8).fill('in_conversation'),
  ...Array(1).fill('invested'),
  ...Array(0).fill('diligence'),
  ...Array(32).fill('passed'),
  ...Array(28).fill('dormant'),
]; // total 759

describe('pipelineGroupForStatus', () => {
  it('merges contacted + in_conversation + invested into one Contacted bucket', () => {
    expect(pipelineGroupForStatus('contacted')).toBe('contacted');
    expect(pipelineGroupForStatus('in_conversation')).toBe('contacted');
    expect(pipelineGroupForStatus('invested')).toBe('contacted');
  });
  it('maps dormant to Frozen and passed to Passed', () => {
    expect(pipelineGroupForStatus('dormant')).toBe('frozen');
    expect(pipelineGroupForStatus('passed')).toBe('passed');
  });
  it('never returns active (a roll-up is not a bucket)', () => {
    for (const s of ['not_contacted', 'contacted', 'in_conversation', 'invested', 'diligence', 'passed', 'dormant']) {
      expect(PIPELINE_GROUPS).toContain(pipelineGroupForStatus(s));
    }
  });
});

describe('pipelineStageLabel keeps the true state', () => {
  it('shows In conversation and Invested distinctly even though they group under Contacted', () => {
    expect(pipelineStageLabel('in_conversation')).toBe('In conversation');
    expect(pipelineStageLabel('invested')).toBe('Invested');
    expect(pipelineStageLabel('contacted')).toBe('Contacted');
  });
});

describe('pipelineCounts invariants (Prompt 650 §1 rule 1)', () => {
  const c = pipelineCounts(ABLUTE);
  it('matches the SQL-confirmed ablute_ numbers', () => {
    expect(c.not_contacted).toBe(641);
    expect(c.contacted).toBe(58); // 49 + 8 + 1
    expect(c.diligence).toBe(0);
    expect(c.passed).toBe(32);
    expect(c.frozen).toBe(28);
    expect(c.active).toBe(727); // 759 − 32
  });
  it('the five non-rollup cards sum EXACTLY to the total', () => {
    expect(c.not_contacted + c.contacted + c.diligence + c.passed + c.frozen).toBe(ABLUTE.length);
  });
  it('Active is exactly total − passed', () => {
    expect(c.active).toBe(ABLUTE.length - c.passed);
  });
  it('Active contains the funnel + frozen, never passed', () => {
    expect(c.active).toBe(c.not_contacted + c.contacted + c.diligence + c.frozen);
  });
});

describe('PIPELINE_CARDS shape', () => {
  it('has six cards with Active flagged as the only roll-up', () => {
    expect(PIPELINE_CARDS.map((x) => x.key)).toEqual(
      ['not_contacted', 'contacted', 'diligence', 'active', 'passed', 'frozen']);
    expect(PIPELINE_CARDS.filter((x) => x.rollup).map((x) => x.key)).toEqual(['active']);
  });
  it('draws funnel arrows only along not_contacted → contacted → diligence', () => {
    const arrowed = PIPELINE_CARDS.filter((x) => x.arrowAfter).map((x) => x.key);
    expect(arrowed).toEqual(['not_contacted', 'contacted']);
    expect(PIPELINE_CARDS.find((x) => x.key === 'diligence')?.sepAfter).toBe(true);
  });
});
