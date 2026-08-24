// Prompt 350 §B — pure shape validation for the two per-deal signals
// ("Considering", "Type of investment"), shared by the write route and its
// own tests. Same value domain as matchdeal_profiles.lead_or_colead/
// instruments (RoundCard's own taxonomy) — never a second parallel list.
export const CONSIDERING_VALUES = ['lead', 'co_lead', 'both'] as const;
export type ConsideringValue = typeof CONSIDERING_VALUES[number];

export function isValidConsidering(value: unknown): value is ConsideringValue {
  return typeof value === 'string' && (CONSIDERING_VALUES as readonly string[]).includes(value);
}

// instruments is free-form text[] on matchdeal_profiles (RoundCard allows
// values outside INSTRUMENT_LABELS' known set via "other"), so this only
// enforces the SHAPE (an array of non-empty strings), never a closed
// enum — same latitude the profile editor itself already has.
export function sanitizeInstruments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}
