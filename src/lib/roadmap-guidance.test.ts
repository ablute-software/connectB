// Nuno, 20/10/2026, on Mob2is: the history is asked of a company that has existed for a year; the future is only said — "investors appreciate this information";
// the suggestion cards (from documents) already exist and are pointed at, never run, from here. These pin what the Roadmap tab says in each situation.
import { describe, expect, it } from 'vitest';
import { roadmapGuidance } from './roadmap-guidance';

const NOW = new Date('2026-10-20T12:00:00Z');
const done = { status: 'done' };
const planned = { status: 'planned' };
const guide = (over: Partial<Parameters<typeof roadmapGuidance>[0]> = {}) =>
  roadmapGuidance({ events: [], foundedYear: 2023, companyName: 'zz-test Mob2is', now: NOW, hasDocuments: true, ...over });

describe('roadmapGuidance — when the Roadmap tab says something', () => {
  it('nothing to say when there is history and a plan', () => {
    expect(guide({ events: [done, planned] })).toBeNull();
    expect(guide({ events: [done, done, planned] })).toBeNull();
  });

  it('Mob2is: founded 2023, nothing on the roadmap — the history is asked for, the plan is mentioned, and it says the milestones count', () => {
    const g = guide();
    expect(g?.needs).toEqual(['history', 'future']);
    expect(g?.title).toBe('Your roadmap is empty');
    expect(g?.body).toContain('zz-test Mob2is was founded in 2023');
    expect(g?.body).toContain('what it has already done and by where it is going');
    expect(g?.body).toContain('they count towards your profile’s completeness');
    expect(g?.cta).toBe('Add a milestone');
  });

  it('plans but no history, for a company that has existed for a year: the history is asked for, and nothing is said about the plan', () => {
    const g = guide({ events: [planned] });
    expect(g?.needs).toEqual(['history']);
    expect(g?.title).toBe('Add what you have already achieved');
    expect(g?.body).toContain('founded in 2023');
    expect(g?.body).toContain('count towards your profile’s completeness');
    expect(g?.body).not.toContain('plan next');
  });

  it('history but no plan: the future is said as something investors appreciate — optional, never scored, no completeness threat', () => {
    const g = guide({ events: [done] });
    expect(g?.needs).toEqual(['future']);
    expect(g?.title).toBe('Show investors where you are going');
    expect(g?.body).toContain('Investors appreciate seeing what you plan next');
    expect(g?.body).toContain('optional');
    expect(g?.body).not.toContain('completeness');
    expect(g?.cta).toBe('Add a planned milestone');
  });

  it('a company too young to be asked for history, with an empty roadmap: asked for nothing it cannot have, invited to both, optional', () => {
    const g = guide({ foundedYear: 2026 });
    expect(g?.needs).toEqual(['future']);
    expect(g?.body).not.toContain('completeness');
    expect(g?.body).toContain('optional, but investors appreciate it');
    expect(guide({ foundedYear: 2026, events: [planned] })).toBeNull();
    expect(guide({ foundedYear: 2026, events: [done] })?.needs).toEqual(['future']);
  });

  it('no founding year: the history cannot be asked for (it does not know the age)', () => {
    expect(guide({ foundedYear: null, events: [planned] })).toBeNull();
    expect(guide({ foundedYear: undefined })?.needs).toEqual(['future']);
  });

  it('only stored events count: nothing here knows the derived "Company founded" mark, and an unknown status counts as neither', () => {
    expect(guide({ events: [{ status: 'derived' }] })?.needs).toEqual(['history', 'future']);
  });

  it('falls back to "Your company" when the name is blank', () => {
    expect(guide({ companyName: '  ' })?.body).toContain('Your company was founded in 2023');
    expect(guide({ companyName: null })?.body).toContain('Your company was founded in 2023');
  });
});

describe('roadmapGuidance — the cards from documents', () => {
  it('an empty Data Room gets the tip: documents can give Sherlock dates and awards, the suggestions come as cards to add, edit or ignore', () => {
    const t = guide({ hasDocuments: false })?.documentsHint;
    expect(t).toContain('documents in your Data Room');
    expect(t).toContain('can give Sherlock dates and awards');
    expect(t).toContain('cards that you can add, edit or ignore');
  });

  it('with documents there, the tip is not repeated (the cards draw themselves when the engine has something)', () => {
    expect(guide({ hasDocuments: true })?.documentsHint).toBeNull();
  });

  it('the tip promises nothing the engine does not do on its own: "can", never "will"; no AI is run from the guidance', () => {
    const t = guide({ hasDocuments: false })!.documentsHint!;
    expect(t).not.toMatch(/\bwill\b/);
  });
});
