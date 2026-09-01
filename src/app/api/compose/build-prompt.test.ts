// Prompt 517 Part 1 — reads the prompt buildPrompt() actually assembles.
// The composer's behaviour here is entirely prompt text, so the text IS the
// unit under test: whether the hierarchy reaches the model, at what point it
// appears, and what it says about space per channel.
import { describe, expect, it } from 'vitest';
import { buildPrompt } from './build-prompt';
import { GROWTH_SIGNAL_TIERS } from '@/lib/growth-signal-tiers';
import type { ComposerContext } from '@/lib/composer';

const BASE: ComposerContext = {
  startup: { name: 'ablute_' },
  investor: { entityName: 'Nina Capital', entityType: 'vc', sectors: ['healthtech'] },
  person: { fullName: 'A Partner', killWords: [], preferredLanguage: 'en' },
  relationship: { stage: 'contacted', whoseTurn: 'us', touchCount: 1, priorThread: [] },
  constraints: {
    dailyCap: 5, weeklyCap: 20, todayCount: 0, weekCount: 0,
    linkedinMax: 900, lockDays: 14, locked: false, thirdUnansweredRisk: false,
  },
};

const withFacts = (n: number): ComposerContext => ({
  ...BASE,
  companyFacts: Array.from({ length: n }, (_, i) => ({
    id: `f${i + 1}`, statement: `Fact ${i + 1}`, category: 'traction',
  })),
});

describe('buildPrompt — growth-signal hierarchy', () => {
  it('omits the block entirely when there are no confirmed facts', () => {
    const p = buildPrompt(BASE, 'email', 'first_touch');
    expect(p).not.toContain('GROWTH-SIGNAL HIERARCHY');
    expect(p).not.toContain('HOOK RULE');
    expect(p).not.toContain('PROGRESSION RULE');
  });

  it('sends all 15 levels, in strength order, once one fact exists', () => {
    const p = buildPrompt(withFacts(1), 'email', 'first_touch');
    expect(p).toContain('GROWTH-SIGNAL HIERARCHY');
    for (const t of GROWTH_SIGNAL_TIERS) expect(p).toContain(t.label);
    expect(p).toContain('1. Paid, recurring revenue with a signed contract');
    expect(p).toContain('15. Press, institutional awards, or third-party recognition with no commitment attached');
    // Order actually survives into the text, not just presence.
    expect(p.indexOf('1. Paid, recurring revenue')).toBeLessThan(p.indexOf('10. Other investors already committed'));
  });

  it('carries the §1a hook rule with one fact, but not the progression rule', () => {
    const p = buildPrompt(withFacts(1), 'email', 'first_touch');
    expect(p).toContain('HOOK RULE');
    expect(p).toContain('is NOT a commitment');
    expect(p).not.toContain('PROGRESSION RULE');
  });

  it('adds the §1b progression rule once two or more facts exist', () => {
    const p = buildPrompt(withFacts(2), 'email', 'first_touch');
    expect(p).toContain('PROGRESSION RULE');
    expect(p).toContain('where the company started and where it is now');
  });

  // The whole point of stating the budget per channel: the model must not be
  // left to decide how much room a 900-character DM has.
  it('states an explicit, channel-specific space budget', () => {
    expect(buildPrompt(withFacts(2), 'linkedin_dm', 'first_touch'))
      .toContain('SPACE FOR THIS CHANNEL (linkedin_dm): ONE compressed sentence');
    expect(buildPrompt(withFacts(2), 'email', 'first_touch'))
      .toContain('SPACE FOR THIS CHANNEL (email): AT MOST two sentences');
    expect(buildPrompt(withFacts(2), 'linkedin_note', 'first_touch'))
      .toContain('NO progression — under 300 characters there is no room');
  });

  it('places the hierarchy after the confirmed facts it ranks', () => {
    const p = buildPrompt(withFacts(2), 'email', 'first_touch');
    expect(p.indexOf('CONFIRMED COMPANY FACTS')).toBeLessThan(p.indexOf('GROWTH-SIGNAL HIERARCHY'));
  });

  it('leaves the existing hard rules untouched', () => {
    const p = buildPrompt(withFacts(2), 'email', 'first_touch');
    expect(p).toContain('HARD RULES:');
    expect(p).toContain('- Never claim traction, revenue, or clinical results that are not in the context.');
    expect(p).toContain('PROVENANCE RULE (hard)');
  });
});
