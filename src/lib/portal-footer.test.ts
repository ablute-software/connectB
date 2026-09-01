import { describe, expect, it } from 'vitest';
import { fmtRoundEur } from './format-money';
import { portalFooterSuffix, portalStageLabel } from './portal-footer';

// Prompt 523 — the footer is investor-facing, so the tests that matter most
// are the negative ones: nothing fabricated when a field is unset, and no
// founder-private round PROGRESS ever reaching the line.

const fmt = (n: number) => fmtRoundEur(n);

describe('portalStageLabel', () => {
  it('maps the portal vocabulary', () => {
    expect(portalStageLabel({ stage: 'pre_seed' })).toBe('Pre-seed');
    expect(portalStageLabel({ stage: 'seed' })).toBe('Seed');
    expect(portalStageLabel({ stage: 'series_a' })).toBe('Series A');
    expect(portalStageLabel({ stage: 'later' })).toBe('Later');
  });

  it('uses the free-text stage_other when the stage is "other"', () => {
    expect(portalStageLabel({ stage: 'other', stage_other: 'Bridge' })).toBe('Bridge');
  });

  it('returns null for "other" with nothing typed, rather than the word "other"', () => {
    expect(portalStageLabel({ stage: 'other', stage_other: '   ' })).toBeNull();
    expect(portalStageLabel({ stage: 'other', stage_other: null })).toBeNull();
  });

  it('falls back to the raw value for a stage the map does not know', () => {
    // Better a raw token than a blank where the DB grew a value the UI has
    // not caught up with.
    expect(portalStageLabel({ stage: 'series_b_plus' })).toBe('series_b_plus');
  });

  it('returns null when there is no stage at all', () => {
    expect(portalStageLabel({})).toBeNull();
    expect(portalStageLabel(null)).toBeNull();
    expect(portalStageLabel(undefined)).toBeNull();
  });
});

describe('portalFooterSuffix', () => {
  it('renders name, stage and target together', () => {
    expect(portalFooterSuffix(
      { name: 'ablute_', stage: 'seed', round_target_eur: 1_300_000 }, fmt,
    )).toBe('ablute_ · Seed round · €1.3M');
  });

  it('names whichever startup the viewer is actually looking at', () => {
    // The bug: every investor saw "ablute_" regardless of whose room it was.
    expect(portalFooterSuffix(
      { name: 'Acme Bio', stage: 'series_a', round_target_eur: 8_000_000 }, fmt,
    )).toBe('Acme Bio · Series A round · €8M');
  });

  it('drops the amount when no target is set, instead of showing a dash', () => {
    expect(portalFooterSuffix({ name: 'Acme Bio', stage: 'seed' }, fmt))
      .toBe('Acme Bio · Seed round');
  });

  it('drops the round entirely when neither stage nor target is set', () => {
    expect(portalFooterSuffix({ name: 'Acme Bio' }, fmt)).toBe('Acme Bio');
  });

  it('shows the round without a name when the name is unset', () => {
    expect(portalFooterSuffix({ stage: 'seed', round_target_eur: 1_300_000 }, fmt))
      .toBe('Seed round · €1.3M');
  });

  it('returns an empty string for no snapshot, so the sentence stands alone', () => {
    // Demo mode, and the window before the fetch resolves.
    expect(portalFooterSuffix(null, fmt)).toBe('');
    expect(portalFooterSuffix(undefined, fmt)).toBe('');
    expect(portalFooterSuffix({}, fmt)).toBe('');
  });

  it('never renders undefined, null or NaN into the line', () => {
    const out = portalFooterSuffix(
      { name: null, stage: null, stage_other: null, round_target_eur: null }, fmt,
    );
    expect(out).toBe('');
    expect(out).not.toMatch(/undefined|null|NaN|€\s*$/);
  });

  it('treats a zero target as a real value, not as absent', () => {
    // round_target_eur = 0 is a deliberate "not raising a specific amount"
    // signal, distinct from null; `!= null` is what keeps them apart.
    expect(portalFooterSuffix({ name: 'Acme Bio', round_target_eur: 0 }, fmt))
      .toBe('Acme Bio · €0');
  });

  it('carries no founder-private round progress', () => {
    // The whole line is built from name/stage/target only. Passing a
    // secured amount in must not change the output — this is the CLAUDE.md
    // root rule pinned down as a test, so a future edit that reaches for
    // round_secured_eur fails here first.
    const withSecured = { name: 'Acme Bio', stage: 'seed', round_target_eur: 5_000_000, round_secured_eur: 4_200_000 };
    expect(portalFooterSuffix(withSecured, fmt)).toBe('Acme Bio · Seed round · €5M');
    expect(portalFooterSuffix(withSecured, fmt)).not.toContain('4.2');
  });
});
