import { describe, expect, it } from 'vitest';
import { dismissDormantReason, dismissNoteContent } from './exit-effects';
import { relationshipSummary } from './relationship';
import { funnelByEra } from './dashboard-era';
import type { Db, Interaction } from './types';

// Prompt 527 — two things carry this feature, and both are negative
// properties: the note must never invent provenance a row does not have, and
// the note must never be counted as a real outbound contact. The second is
// the one that would corrupt data silently, so it is asserted against the
// two functions that actually decide "contacted", not by inspection.

const NOW = new Date('2026-09-01T10:00:00Z');

describe('dismissNoteContent', () => {
  it('quotes the real Sherlock suggestion, with the person it was about', () => {
    expect(dismissNoteContent(
      { kind: 'suggestion', text: 'Follow up — no reply for 42d.', personName: 'Ana Silva' }, NOW,
    )).toBe('Dismissed — Sherlock suggested: "Follow up — no reply for 42d." for Ana Silva. Marked dormant on 2026-09-01.');
  });

  it('omits the person when there is none, rather than leaving a dangling "for"', () => {
    expect(dismissNoteContent({ kind: 'suggestion', text: 'Follow up.', personName: null }, NOW))
      .toBe('Dismissed — Sherlock suggested: "Follow up." Marked dormant on 2026-09-01.');
  });

  it('does NOT claim Sherlock suggested a task the founder wrote themselves', () => {
    // The invented-provenance case: a permanent record must not attribute a
    // founder's own follow-up to an advisor.
    const out = dismissNoteContent({ kind: 'task', title: 'Call Bynd about the deck', fromSherlock: false }, NOW);
    expect(out).toBe('Dismissed the follow-up "Call Bynd about the deck". Marked dormant on 2026-09-01.');
    expect(out).not.toMatch(/Sherlock/);
  });

  it('does credit Sherlock when the task genuinely came from a suggestion', () => {
    expect(dismissNoteContent({ kind: 'task', title: 'Follow up with Bynd', fromSherlock: true }, NOW))
      .toBe('Dismissed — Sherlock suggested: "Follow up with Bynd". Marked dormant on 2026-09-01.');
  });

  it('says "stayed dormant" for a reawakening, never "marked dormant"', () => {
    // The entity is already dormant there — claiming a state change would be
    // a second, invented event in the history.
    const out = dismissNoteContent({ kind: 'reawakening', text: 'They just raised a new fund.' }, NOW);
    expect(out).toBe('Dismissed — Sherlock suggested reawakening this investor (They just raised a new fund.). Stayed dormant on 2026-09-01.');
    expect(out).not.toMatch(/Marked dormant/);
  });

  it('still reads correctly when a reawakening carries no rationale', () => {
    expect(dismissNoteContent({ kind: 'reawakening', text: null }, NOW))
      .toBe('Dismissed — Sherlock suggested reawakening this investor. Stayed dormant on 2026-09-01.');
  });

  it('names the dossier exit as a choice, not as dismissed advice', () => {
    const out = dismissNoteContent({ kind: 'manual', label: 'Frozen / no continuity' }, NOW);
    expect(out).toBe('Parked by choice — Frozen / no continuity. Marked dormant on 2026-09-01.');
    expect(out).not.toMatch(/Sherlock/);
  });

  it('stamps the dormant reason with the date', () => {
    expect(dismissDormantReason(NOW)).toBe("Dismissed Sherlock's suggestion on 2026-09-01.");
  });
});

// The note is written with channel 'stage_change' precisely so every existing
// "is this a real touch?" filter excludes it for free. These two tests are the
// guard on that decision: if anyone ever switches the channel to a new value
// without extending all nine exclusion sites, they fail here first.
function dbWith(interactions: Interaction[]): Db {
  return {
    org: { id: 'o1', name: 'ablute_' },
    entities: [{
      id: 'e1', name: 'Bynd VC', type: 'vc', invests_in_geographies: [], sectors: [],
      website_verified: false, email_domain_verified: false, submission_channel_type: 'unknown',
      hard_filter_status: 'not_applicable', status: 'not_contacted', source: 'manual',
    }],
    people: [], interactions, tasks: [], folders: [], documents: [], grants: [],
    documentViews: [], overrides: [], templates: [], automations: [], runs: [],
    reviews: [], catalog: [], packs: [], packItems: [], unlocks: [], submissions: [],
    relationshipState: [], companyFacts: [], reawakeningProposals: [],
  } as unknown as Db;
}

const dismissNote: Interaction = {
  id: 'i-note', entity_id: 'e1', occurred_at: '2026-09-01T10:00:00Z',
  direction: 'out', channel: 'stage_change',
  content: dismissNoteContent({ kind: 'suggestion', text: 'Follow up.' }, NOW),
};

describe('a dismissal note is not a contact', () => {
  it('does not count as an outbound touch in relationshipSummary', () => {
    const summary = relationshipSummary(dbWith([dismissNote]), 'e1', NOW);
    expect(summary.daysSinceLastTouch).toBeUndefined();
  });

  it('does not make the entity "contacted" in the dashboard counters', () => {
    // 'platform', not 'all': funnelByEra's 'all' branch reads contacted from
    // entities.status and never looks at interactions, so it could not see
    // this bug either way. 'platform' is the branch carrying the
    // channel !== 'stage_change' filter this test exists to guard.
    const funnel = funnelByEra(dbWith([dismissNote]), 'platform', null);
    expect(funnel.contacted).toBe(0);
  });

  it('a real outbound email, by contrast, does count', () => {
    const real: Interaction = {
      id: 'i-real', entity_id: 'e1', occurred_at: '2026-09-01T09:00:00Z',
      direction: 'out', channel: 'email', content: 'Hello.',
    };
    expect(funnelByEra(dbWith([real]), 'platform', null).contacted).toBe(1);
  });
});
