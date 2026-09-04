import { describe, expect, it } from 'vitest';
import { catalogContactFields, deriveSubmissionChannelType, waveForRank, submissionFormUrl } from './catalog-delivery-mapping';

// Prompt 544 Part C — the reported symptom was a pipeline row with no way to
// contact anyone while the catalog held an email, a form and a list of names.
// These assert the copy actually happens, and that a wave means something.

describe('deriveSubmissionChannelType', () => {
  it('prefers the form the firm published over its general inbox', () => {
    expect(deriveSubmissionChannelType('https://vc.example/apply', 'hello@vc.example')).toBe('form');
  });

  it('falls back to email when there is no form', () => {
    expect(deriveSubmissionChannelType(null, 'hello@vc.example')).toBe('email');
  });

  it('is unknown only when the firm really offers neither', () => {
    expect(deriveSubmissionChannelType(null, null)).toBe('unknown');
  });

  it('treats blank strings as absent, not as a channel', () => {
    // A whitespace-only column would otherwise claim a form that is not there.
    expect(deriveSubmissionChannelType('   ', '  ')).toBe('unknown');
    expect(deriveSubmissionChannelType('   ', 'hello@vc.example')).toBe('email');
  });
});

describe('catalogContactFields', () => {
  const row = {
    email: 'hello@vc.example',
    submission_channel: 'https://vc.example/apply',
    key_people: 'Ana Silva (Partner); Bruno Costa (Principal)',
    general_partner_emails: 'ana@vc.example',
    aum: '€120M',
    current_funds: 'Fund III',
    latest_fund: '2025',
    last_investment_found: 'Acme Bio, Jan 2026',
  };

  it('copies every field the delivery used to drop', () => {
    const out = catalogContactFields(row);
    expect(out.email).toBe('hello@vc.example');
    expect(out.submission_channel).toBe('https://vc.example/apply');
    expect(out.key_people).toContain('Ana Silva');
    expect(out.general_partner_emails).toBe('ana@vc.example');
    expect(out.aum).toBe('€120M');
    expect(out.current_funds).toBe('Fund III');
    expect(out.latest_fund).toBe('2025');
    expect(out.last_investment_found).toBe('Acme Bio, Jan 2026');
  });

  it('derives the channel type instead of hard-coding unknown', () => {
    // The old mapper wrote 'unknown' for every row, form or not.
    expect(catalogContactFields(row).submission_channel_type).toBe('form');
    expect(catalogContactFields({ ...row, submission_channel: null }).submission_channel_type).toBe('email');
  });

  it('returns null, never undefined, for an empty catalog row', () => {
    const out = catalogContactFields({});
    expect(out.email).toBeNull();
    expect(out.key_people).toBeNull();
    expect(out.submission_channel_type).toBe('unknown');
    for (const v of Object.values(out)) expect(v).not.toBeUndefined();
  });

  it('does not invent source_url, which catalog_entities does not have', () => {
    // Checked against production: source_url is an entities-only column.
    expect('source_url' in catalogContactFields(row)).toBe(false);
  });
});

describe('waveForRank', () => {
  it('splits the batch 3 / 3 / rest', () => {
    expect([0, 1, 2].map(waveForRank)).toEqual([1, 1, 1]);
    expect([3, 4, 5].map(waveForRank)).toEqual([2, 2, 2]);
    expect([6, 7, 9, 39].map(waveForRank)).toEqual([3, 3, 3, 3]);
  });

  it('assigns a ten-row delivery as 3/3/4, which is what the prompt asks for', () => {
    const waves = Array.from({ length: 10 }, (_, i) => waveForRank(i));
    expect(waves.filter((w) => w === 1)).toHaveLength(3);
    expect(waves.filter((w) => w === 2)).toHaveLength(3);
    expect(waves.filter((w) => w === 3)).toHaveLength(4);
  });

  it('never returns a wave the Pipeline filter does not know', () => {
    for (let i = 0; i < 200; i++) expect([1, 2, 3]).toContain(waveForRank(i));
  });

  it('gives a short delivery no empty later waves', () => {
    // Two rows means two W1 rows, not one per wave.
    expect([0, 1].map(waveForRank)).toEqual([1, 1]);
  });
});

// Prompt 564 §A — the five shapes that actually exist in catalog_entities,
// measured 04/09: 5 http(s) URLs, 1 mailto:, 67 bare addresses, 6 other
// values containing an @, 7 free-text form names. Before this, all 86 were
// typed 'form'.
describe('deriveSubmissionChannelType — Prompt 564 §A', () => {
  it('calls an http(s) URL a form', () => {
    expect(deriveSubmissionChannelType('https://vc.example/apply', null)).toBe('form');
    expect(deriveSubmissionChannelType('http://vc.example/apply', 'x@vc.example')).toBe('form');
  });

  // Krohnsty's Superangel: typed 'form', so the clue said "submit through
  // their form" about an address you can simply write to again.
  it('calls a mailto: an inbox', () => {
    expect(deriveSubmissionChannelType('mailto:10x AT superangel.io', null)).toBe('email');
    expect(deriveSubmissionChannelType('MAILTO:team@shilling.vc', null)).toBe('email');
  });

  // Portugal Ventures and Shilling VC, both typed 'form' in production.
  it('calls a bare address an inbox', () => {
    expect(deriveSubmissionChannelType('contact@portugalventures.pt', null)).toBe('email');
    expect(deriveSubmissionChannelType('team@shilling.vc', null)).toBe('email');
  });

  it('calls an address embedded in free text an inbox', () => {
    expect(deriveSubmissionChannelType('Write to contact@vc.example with your deck', null)).toBe('email');
  });

  // COREangels Porto: a real form, no URL. Still a form — the gap is the
  // missing link, not the classification.
  it('calls free text naming a form a form', () => {
    expect(deriveSubmissionChannelType('COREangels Porto contact form', 'info@coreangels.com')).toBe('form');
  });

  it('falls back to the general email, then to unknown, when there is no channel', () => {
    expect(deriveSubmissionChannelType(null, 'contact@newfundcap.com')).toBe('email');
    expect(deriveSubmissionChannelType('   ', 'contact@newfundcap.com')).toBe('email');
    expect(deriveSubmissionChannelType(null, null)).toBe('unknown');
    expect(deriveSubmissionChannelType('', '')).toBe('unknown');
  });

  // The pre-564 precedence, kept: a firm that publishes a form AND has a
  // general inbox is still a form — that is the channel they chose.
  it('keeps "a form outranks an inbox" when the row genuinely has both', () => {
    expect(deriveSubmissionChannelType('https://vc.example/apply', 'hello@vc.example')).toBe('form');
  });
});

describe('submissionFormUrl — Prompt 564 §A', () => {
  it('returns the URL only when there is one to open', () => {
    expect(submissionFormUrl('https://vc.example/apply')).toBe('https://vc.example/apply');
    expect(submissionFormUrl('  https://vc.example/apply  ')).toBe('https://vc.example/apply');
  });

  // The enrichment gap, made countable: a form with nowhere to send the
  // founder. No surface should render a link it does not have.
  it('returns null for a form named in free text, and for every non-URL shape', () => {
    expect(submissionFormUrl('COREangels Porto contact form')).toBeNull();
    expect(submissionFormUrl('contact@portugalventures.pt')).toBeNull();
    expect(submissionFormUrl('mailto:10x AT superangel.io')).toBeNull();
    expect(submissionFormUrl(null)).toBeNull();
    expect(submissionFormUrl('')).toBeNull();
  });
});
