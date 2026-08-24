// Prompt 368 — pure tests for the roadmap suggestion dedup backstop.
import { describe, expect, it } from 'vitest';
import { isDuplicateRoadmapEvent } from './roadmap-duplicate';

describe('isDuplicateRoadmapEvent', () => {
  it('the exact reported case: a candidate proposing an already-roadmapped fact does not survive', () => {
    const existing = [{ title: 'WomenTechEU prize', date: '2022-05-01' }];
    const candidate = { title: "Awarded 'Woman In Tech EU' badge", date: '2022-06-01' };
    expect(isDuplicateRoadmapEvent(candidate, existing)).toBe(true);
  });

  it('a genuinely different event in the same year is NOT flagged', () => {
    const existing = [{ title: 'WomenTechEU prize', date: '2022-05-01' }];
    const candidate = { title: 'Signed first paid pilot with Hospital de Braga', date: '2022-09-01' };
    expect(isDuplicateRoadmapEvent(candidate, existing)).toBe(false);
  });

  it('a similar title in a DIFFERENT year is NOT flagged — same-year gate', () => {
    const existing = [{ title: 'WomenTechEU prize', date: '2022-05-01' }];
    const candidate = { title: "Awarded 'Woman In Tech EU' badge", date: '2019-06-01' };
    expect(isDuplicateRoadmapEvent(candidate, existing)).toBe(false);
  });

  it('an empty existing roadmap never flags anything', () => {
    expect(isDuplicateRoadmapEvent({ title: 'Anything', date: '2022-01-01' }, [])).toBe(false);
  });
});
