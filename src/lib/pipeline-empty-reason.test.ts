// Nuno, 20/10/2026, on Mob2is: "I do not understand why the pipeline is empty. If an action is missing — if there is a reason — it should be on the screen."
// The empty Pipeline had three sentences, and the one for "profile complete, nothing deliverable" fitted four different situations behind the same reassuring
// "your next batch arrives with your plan's monthly renewal". These tests pin each situation to its own reason, its own numbers and its own way out.
import { describe, expect, it } from 'vitest';
import { formatBatchDate, pipelineEmptyCopy, pipelineEmptyReason, type PipelineEmptyReason, type UnlockFacts } from './pipeline-empty-reason';

const NOW = new Date('2026-10-20T12:00:00Z');
const facts = (over: Partial<UnlockFacts> = {}): UnlockFacts => ({ gateComplete: true, deliverable: 0, unlimited: false, missing: [], quota: 3, delivered: 0, ...over });

describe('pipelineEmptyReason — which of the situations this empty pipeline is', () => {
  it('nothing known yet (the route has not answered): the generic sentence, never a guess at a reason', () => {
    expect(pipelineEmptyReason(null, true, NOW)).toEqual({ kind: 'unknown' });
  });

  it('the profile gate is not complete: the fields still missing, whatever the quota says', () => {
    const r = pipelineEmptyReason(facts({ gateComplete: false, missing: ['website', 'sector'], quota: 0, deliverable: 0 }), true, NOW);
    expect(r).toEqual({ kind: 'profile_incomplete', missing: ['website', 'sector'] });
  });

  it('Mob2is: profile complete, quota 3, nothing delivered, three investors waiting → ready to unlock, with the count (not "wait for the renewal")', () => {
    const r = pipelineEmptyReason(facts({ deliverable: 3, quota: 3, delivered: 0 }), true, NOW);
    expect(r).toEqual({ kind: 'ready_to_unlock', count: 3 });
  });

  it('…but if the pack the button delivers is not there, it does not promise an unlock it cannot offer', () => {
    expect(pipelineEmptyReason(facts({ deliverable: 3 }), false, NOW)).toEqual({ kind: 'unknown' });
  });

  it('every investor the plan includes was delivered: the allowance is spent, and the next batch is the 1st of next month', () => {
    const r = pipelineEmptyReason(facts({ quota: 3, delivered: 3 }), true, NOW);
    expect(r.kind).toBe('quota_spent');
    if (r.kind !== 'quota_spent') return;
    expect(r.quota).toBe(3);
    expect(r.nextBatch.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('the next batch is the NEXT first, even on the first itself, and rolls the year over in December', () => {
    const on1st = pipelineEmptyReason(facts({ quota: 3, delivered: 3 }), true, new Date('2026-11-01T09:00:00Z'));
    const december = pipelineEmptyReason(facts({ quota: 3, delivered: 3 }), true, new Date('2026-12-15T09:00:00Z'));
    expect(on1st.kind === 'quota_spent' && on1st.nextBatch.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(december.kind === 'quota_spent' && december.nextBatch.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('delivered above the quota (a plan that went down) is still "spent", not a negative number of investors waiting', () => {
    expect(pipelineEmptyReason(facts({ quota: 3, delivered: 5 }), true, NOW).kind).toBe('quota_spent');
  });

  it('allowance left but the catalog has nothing that matches: the numbers say so (5 of 8), and it is not "wait for the renewal"', () => {
    expect(pipelineEmptyReason(facts({ quota: 8, delivered: 5, deliverable: 0 }), true, NOW)).toEqual({ kind: 'no_matches_left', quota: 8, delivered: 5 });
  });

  it('an unlimited (developer) account has no allowance to be spent: if nothing is deliverable, nothing matches', () => {
    expect(pipelineEmptyReason(facts({ unlimited: true, quota: null, delivered: 4 }), true, NOW)).toEqual({ kind: 'no_matches_left', quota: null, delivered: 4 });
  });

  it('a server that did not send the quota is read as "unknown allowance", never as a spent one', () => {
    expect(pipelineEmptyReason(facts({ quota: null, delivered: 2 }), true, NOW).kind).toBe('no_matches_left');
  });

  it('an account with no catalog investors included at all', () => {
    expect(pipelineEmptyReason(facts({ quota: 0, delivered: 0 }), true, NOW)).toEqual({ kind: 'plan_has_none' });
  });

  it('investors waiting beat every other reading: if something is deliverable, that is the state', () => {
    expect(pipelineEmptyReason(facts({ deliverable: 2, quota: 3, delivered: 3 }), true, NOW).kind).toBe('ready_to_unlock');
  });
});

describe('formatBatchDate — the same day for everyone', () => {
  it('prints the UTC date in words', () => {
    expect(formatBatchDate(new Date(Date.UTC(2026, 10, 1)))).toBe('1 November 2026');
    expect(formatBatchDate(new Date(Date.UTC(2027, 0, 1)))).toBe('1 January 2027');
  });
});

describe('pipelineEmptyCopy — what the founder reads, and what it leaves them able to do', () => {
  const ALL: PipelineEmptyReason[] = [
    { kind: 'profile_incomplete', missing: ['website', 'sector'] },
    { kind: 'ready_to_unlock', count: 3 },
    { kind: 'quota_spent', quota: 3, nextBatch: new Date(Date.UTC(2026, 10, 1)) },
    { kind: 'no_matches_left', quota: 8, delivered: 5 },
    { kind: 'plan_has_none' },
    { kind: 'unknown' },
  ];

  it('the defect: every situation used to read the same. No two situations share a sentence any more', () => {
    const texts = ALL.map((r) => pipelineEmptyCopy(r));
    expect(new Set(texts).size).toBe(ALL.length);
  });

  it('profile incomplete names the fields', () => {
    expect(pipelineEmptyCopy({ kind: 'profile_incomplete', missing: ['website', 'sector'] })).toContain('still missing: website, sector');
    expect(pipelineEmptyCopy({ kind: 'profile_incomplete', missing: [] })).not.toContain('still missing');
  });

  it('ready to unlock says how many, in the singular and the plural', () => {
    expect(pipelineEmptyCopy({ kind: 'ready_to_unlock', count: 3 })).toBe('Your profile is complete — unlock your first 3 matched investors, or import your own contacts.');
    expect(pipelineEmptyCopy({ kind: 'ready_to_unlock', count: 1 })).toBe('Your profile is complete — unlock your first 1 matched investor, or import your own contacts.');
  });

  it('allowance spent says "all N", the date of the next batch, and — only where there is a higher plan — the upgrade', () => {
    const r: PipelineEmptyReason = { kind: 'quota_spent', quota: 3, nextBatch: new Date(Date.UTC(2026, 10, 1)) };
    const onPlan = pipelineEmptyCopy(r);
    expect(onPlan).toContain('all 3 investors your plan includes');
    expect(onPlan).toContain('1 November 2026');
    expect(onPlan).toContain('or upgrade your plan to unlock more now');
    const onMax = pipelineEmptyCopy(r, { onMaxPlan: true });
    expect(onMax).toContain('1 November 2026');
    expect(onMax).not.toContain('upgrade');
    expect(pipelineEmptyCopy({ kind: 'quota_spent', quota: 1, nextBatch: new Date(Date.UTC(2026, 10, 1)) })).toContain('all 1 investor your plan');
  });

  it('nothing left that matches says what matching uses, with the numbers, and never promises a renewal', () => {
    const t = pipelineEmptyCopy({ kind: 'no_matches_left', quota: 8, delivered: 5 });
    expect(t).toContain('5 of 8 delivered so far');
    expect(t).toContain('sectors, stage, ticket size and country');
    expect(t).not.toContain('monthly renewal');
    expect(pipelineEmptyCopy({ kind: 'no_matches_left', quota: null, delivered: 4 })).toContain('4 delivered so far');
  });

  it('no catalog investors included points at the plans only where there is a higher one', () => {
    expect(pipelineEmptyCopy({ kind: 'plan_has_none' })).toContain('see the plans');
    expect(pipelineEmptyCopy({ kind: 'plan_has_none' }, { onMaxPlan: true })).not.toContain('plans');
  });

  it('every way out always includes importing your own contacts', () => {
    for (const r of ALL) expect(pipelineEmptyCopy(r)).toContain('import your own contacts');
  });

  it('the generic sentence is the one that was always there (what the screen says before the route answers)', () => {
    expect(pipelineEmptyCopy({ kind: 'unknown' })).toBe('Your profile is complete. Your next batch of investors arrives with your plan’s monthly renewal — or import your own contacts now.');
  });
});
