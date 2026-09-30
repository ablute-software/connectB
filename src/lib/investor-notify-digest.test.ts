import { describe, expect, it } from 'vitest';
import { decideNotifyDigestForMember, type NewPipelineAdmission } from './investor-notify-digest';

function admission(overrides: Partial<NewPipelineAdmission> = {}): NewPipelineAdmission {
  return { orgId: 'org-1', name: 'Startup', sector: 'Fintech', stage: 'seed', country: 'PT', ...overrides };
}

function admissions(n: number): NewPipelineAdmission[] {
  return Array.from({ length: n }, (_, i) => admission({ orgId: `org-${i}`, name: `Startup ${i}` }));
}

describe('decideNotifyDigestForMember — Prompt 747 §B', () => {
  it('preference off -> nothing, even with plenty of new admissions', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: false, newAdmissions: admissions(5) });
    expect(decision).toEqual({ send: false });
  });

  it('preference on + zero new admissions -> nothing (never an empty digest)', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: [] });
    expect(decision).toEqual({ send: false });
  });

  it('1 new admission -> singular subject, full list, no overflow', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(1) });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.subject).toBe('1 new startup in your pipeline');
    expect(decision.lines).toHaveLength(1);
    expect(decision.overflowText).toBeNull();
  });

  it('1-7 new admissions -> full list, no overflow', () => {
    for (const n of [2, 5, 7]) {
      const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(n) });
      expect(decision.send).toBe(true);
      if (!decision.send) throw new Error('expected send');
      expect(decision.subject).toBe(`${n} new startups in your pipeline`);
      expect(decision.lines).toHaveLength(n);
      expect(decision.overflowText).toBeNull();
    }
  });

  it('exactly 8 new admissions -> full list, still no overflow', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(8) });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines).toHaveLength(8);
    expect(decision.overflowText).toBeNull();
  });

  it('9 new admissions -> 8 lines + "and 1 more"', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(9) });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.subject).toBe('9 new startups in your pipeline');
    expect(decision.lines).toHaveLength(8);
    expect(decision.overflowText).toBe('and 1 more');
  });

  it('12 new admissions -> 8 lines + "and 4 more"', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(12) });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines).toHaveLength(8);
    expect(decision.overflowText).toBe('and 4 more');
  });

  it('formats a line as "name — sector, stage, country" when all three are present', () => {
    const decision = decideNotifyDigestForMember({
      notifyEnabled: true,
      newAdmissions: [admission({ name: 'Ablute', sector: 'Healthtech', stage: 'seed', country: 'PT' })],
    });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines[0]).toBe('Ablute — Healthtech, seed, PT');
  });

  it('drops missing fields from the line instead of leaving gaps', () => {
    const decision = decideNotifyDigestForMember({
      notifyEnabled: true,
      newAdmissions: [admission({ name: 'Ablute', sector: null, stage: 'seed', country: null })],
    });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines[0]).toBe('Ablute — seed');
  });

  it('falls back to just the name when sector/stage/country are all missing', () => {
    const decision = decideNotifyDigestForMember({
      notifyEnabled: true,
      newAdmissions: [admission({ name: 'Ablute', sector: null, stage: null, country: null })],
    });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines[0]).toBe('Ablute');
  });

  // Prompt 747's own report checklist — a member whose watermark is null
  // (first-ever run) vs. one with a real prior timestamp. This function
  // takes the ALREADY-FILTERED admissions list (the server-side caller does
  // the watermark comparison against the DB), so both cases are exercised
  // simply by varying what's IN that list — a null-watermark caller passes
  // every currently-presented admission (the "catch up" case), a real-
  // watermark caller passes only the ones presented after it. From this
  // function's own point of view the two cases are indistinguishable by
  // design (it has no opinion on how the list was produced) — this test
  // documents that equivalence explicitly rather than leaving it implicit.
  it('first-ever run (conceptually: null watermark, all presented admissions passed in) sends the full catch-up list', () => {
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(3) });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines).toHaveLength(3);
  });

  it('a member with a real prior watermark sends only what the caller resolved as new-since-then', () => {
    // Simulates the caller having already excluded everything presented
    // before the member's last digest — this function just sees a shorter list.
    const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions: admissions(1) });
    expect(decision.send).toBe(true);
    if (!decision.send) throw new Error('expected send');
    expect(decision.lines).toHaveLength(1);
  });
});
