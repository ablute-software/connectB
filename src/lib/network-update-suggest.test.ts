import { describe, expect, it } from 'vitest';
import {
  UPDATE_SECTIONS, mentionsFunding, toUpdateSuggestion,
} from './network-update-suggest';

// Prompt 528 §2 — the Structured update composer states its own rule in the
// UI: "No round/funding field, on purpose." A suggestion button that can put
// the round back would quietly overrule the form. The route omits round
// fields from the knowledge base at the source; this is the second net.

describe('toUpdateSuggestion', () => {
  const good = {
    section: 'productProgress',
    text: 'We shipped the clinical dashboard to our first three pilot sites.',
    reasoning: 'From the roadmap event "Pilot go-live".',
  };

  it('accepts a well-formed suggestion for a real section', () => {
    expect(toUpdateSuggestion(good)).toEqual({
      section: 'productProgress',
      text: 'We shipped the clinical dashboard to our first three pilot sites.',
      reasoning: 'From the roadmap event "Pilot go-live".',
    });
  });

  it.each(UPDATE_SECTIONS)('accepts the %s section', (section) => {
    expect(toUpdateSuggestion({ ...good, section })?.section).toBe(section);
  });

  it('rejects a section that is not one of the four boxes', () => {
    // A section the composer has no field for would silently go nowhere.
    expect(toUpdateSuggestion({ ...good, section: 'fundraising' })).toBeNull();
    expect(toUpdateSuggestion({ ...good, section: '' })).toBeNull();
  });

  it('rejects an empty draft rather than clearing a field with nothing', () => {
    expect(toUpdateSuggestion({ ...good, text: '   ' })).toBeNull();
  });

  it('survives a malformed payload without throwing', () => {
    expect(toUpdateSuggestion(null)).toBeNull();
    expect(toUpdateSuggestion({})).toBeNull();
    expect(toUpdateSuggestion('nonsense')).toBeNull();
  });

  it('keeps a suggestion with no reasoning, since only the text is essential', () => {
    expect(toUpdateSuggestion({ ...good, reasoning: undefined })?.reasoning).toBe('');
  });
});

describe('funding content never reaches the composer', () => {
  it.each([
    ['We are raising our seed round.', 'the round itself'],
    ['We closed a €1.3M pre-seed.', 'an amount'],
    ['Our valuation doubled since January.', 'valuation'],
    ['We signed a term sheet last week.', 'term sheet'],
    ['Talking to investors across Iberia.', 'investors'],
    ['This extends our runway to 24 months.', 'runway'],
    ['Series A conversations have started.', 'a later stage'],
  ])('rejects %s (%s)', (text) => {
    expect(mentionsFunding(text)).toBe(true);
    expect(toUpdateSuggestion({ section: 'team', text, reasoning: 'x' })).toBeNull();
  });

  it.each([
    'We shipped the clinical dashboard to three pilot sites.',
    'Two nurses joined the clinical team in August.',
    'We learned that onboarding works better in person than over video.',
    'Our first hospital customer renewed for a second year.',
  ])('lets ordinary progress through: %s', (text) => {
    expect(mentionsFunding(text)).toBe(false);
    expect(toUpdateSuggestion({ section: 'team', text, reasoning: 'x' })).not.toBeNull();
  });
});
