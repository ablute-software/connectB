import { describe, expect, it } from 'vitest';
import {
  chooseFirstMessageTarget, isActionable, rankCandidates, type FirstMessageCandidate,
} from './first-message-target';

// Prompt 544 Part D — the reported failure was "Next: send your first message
// to Hoxton Ventures", an entity with zero people where preflight() refuses
// the draft. Every test here is about not doing that again.

function c(over: Partial<FirstMessageCandidate> = {}): FirstMessageCandidate {
  return {
    id: 'e1', name: 'Firm', wave: 1, fitRank: 0, readiness: 50,
    peopleCount: 2, hasHook: false, hasChannel: true, ...over,
  };
}

describe('isActionable', () => {
  it('accepts an entity with people', () => {
    expect(isActionable(c({ peopleCount: 3, hasChannel: false }))).toBe(true);
  });

  it('accepts an entity with only a form or inbox', () => {
    expect(isActionable(c({ peopleCount: 0, hasChannel: true }))).toBe(true);
  });

  it('rejects the Hoxton case — no people, no channel', () => {
    expect(isActionable(c({ peopleCount: 0, hasChannel: false }))).toBe(false);
  });
});

describe('chooseFirstMessageTarget', () => {
  it('never picks an entity with nothing to act on, even if it ranks first', () => {
    const target = chooseFirstMessageTarget([
      c({ id: 'hoxton', name: 'Hoxton Ventures', wave: 1, fitRank: 0, readiness: 20, peopleCount: 0, hasChannel: false }),
      c({ id: 'domino', name: 'DOMiNO Ventures', wave: 1, fitRank: 1, readiness: 60, peopleCount: 4 }),
    ]);
    expect(target?.entity.id).toBe('domino');
  });

  it('returns null rather than inventing a step when nothing is actionable', () => {
    expect(chooseFirstMessageTarget([
      c({ peopleCount: 0, hasChannel: false }),
      c({ id: 'e2', peopleCount: 0, hasChannel: false }),
    ])).toBeNull();
  });

  it('says "send your first message" only when a hook exists', () => {
    const t = chooseFirstMessageTarget([c({ name: 'Frst', hasHook: true })]);
    expect(t?.state).toBe('has_hook');
    expect(t?.label).toBe('Next: send your first message to Frst');
    expect(t?.target).toContain('rail=log');
  });

  it('sends the founder to pick a partner when there are people but no hook', () => {
    // preflight() would refuse a draft here, so "send your first message"
    // would be an instruction the product then blocks.
    const t = chooseFirstMessageTarget([c({ name: 'SFC Capital', hasHook: false, peopleCount: 18 })]);
    expect(t?.state).toBe('has_people');
    expect(t?.label).toBe('Next: pick the right partner at SFC Capital and write your hook');
    expect(t?.target).toContain('tab=people');
  });

  it('says submit through the form when there is no one to name', () => {
    const t = chooseFirstMessageTarget([
      c({ name: 'Kindred Capital', peopleCount: 0, hasChannel: true, hasHook: false }),
    ]);
    expect(t?.state).toBe('channel_only');
    expect(t?.label).toBe('Next: submit to Kindred Capital through their form');
  });

  it('never says "send your first message" to an entity without a hook', () => {
    for (const cand of [
      c({ peopleCount: 5, hasHook: false }),
      c({ peopleCount: 0, hasChannel: true, hasHook: false }),
    ]) {
      expect(chooseFirstMessageTarget([cand])?.label).not.toContain('send your first message');
    }
  });
});

describe('rankCandidates', () => {
  it('orders wave first', () => {
    const out = rankCandidates([
      c({ id: 'w2', wave: 2, readiness: 100 }),
      c({ id: 'w1', wave: 1, readiness: 10 }),
    ]);
    expect(out[0].id).toBe('w1');
  });

  it('prefers readiness over fit inside the same wave', () => {
    // The one you CAN approach beats the one scoring marginally higher with
    // nobody listed — which is the whole point of the second score.
    const out = rankCandidates([
      c({ id: 'bestFit', fitRank: 0, readiness: 15 }),
      c({ id: 'reachable', fitRank: 1, readiness: 60 }),
    ]);
    expect(out[0].id).toBe('reachable');
  });

  it('falls back to fit, then name, so the order is stable', () => {
    const out = rankCandidates([
      c({ id: 'b', name: 'Beta', fitRank: 1, readiness: 40 }),
      c({ id: 'a', name: 'Alpha', fitRank: 1, readiness: 40 }),
      c({ id: 'top', name: 'Zulu', fitRank: 0, readiness: 40 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(['top', 'a', 'b']);
  });

  it('treats a missing wave as last, never as wave 0', () => {
    const out = rankCandidates([c({ id: 'none', wave: undefined }), c({ id: 'w3', wave: 3 })]);
    expect(out[0].id).toBe('w3');
  });
});
