import { describe, expect, it } from 'vitest';
import { catalogContactFields, deriveSubmissionChannelType, waveForRank } from './catalog-delivery-mapping';

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
