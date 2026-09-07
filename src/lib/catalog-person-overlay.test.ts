import { describe, it, expect } from 'vitest';
import { overlayForEmptyFields, type CatalogOverlay } from './catalog-person-overlay';

describe('overlayForEmptyFields — Prompt 871 §E overlay-at-read-time', () => {
  it('suggests a field the person leaves empty', () => {
    const overlay: CatalogOverlay = { role: { value: 'Partner', level: 'verified_by_startups' } };
    const out = overlayForEmptyFields(overlay, { role: undefined });
    expect(out.role).toEqual({ value: 'Partner', level: 'verified_by_startups' });
  });

  it('never suggests a field the person already has — this is a suggestion, not a correction', () => {
    const overlay: CatalogOverlay = { role: { value: 'Partner', level: 'verified_by_startups' } };
    const out = overlayForEmptyFields(overlay, { role: 'General Partner' });
    expect(out.role).toBeUndefined();
  });

  it('treats an empty array (kill_words) as empty, not as "has content"', () => {
    const overlay: CatalogOverlay = { kill_words: { value: ['no shop talk'], level: 'verified_by_admin' } };
    const out = overlayForEmptyFields(overlay, { kill_words: [] as string[] });
    expect(out.kill_words).toEqual({ value: ['no shop talk'], level: 'verified_by_admin' });
  });

  it('treats a non-empty array as already populated', () => {
    const overlay: CatalogOverlay = { kill_words: { value: ['no shop talk'], level: 'verified_by_admin' } };
    const out = overlayForEmptyFields(overlay, { kill_words: ['already set'] });
    expect(out.kill_words).toBeUndefined();
  });

  it('produces no suggestions when the overlay itself is empty', () => {
    const out = overlayForEmptyFields({}, { role: undefined, based_in: undefined });
    expect(out).toEqual({});
  });
});
