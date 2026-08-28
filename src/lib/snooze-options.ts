// Prompt 226 §4 / Prompt 415 §2 — the 4 fixed snooze durations, shared
// between RelationshipSummaryCard's own entity-level Snooze and the
// Sherlock Next Clue popup's "Leave for later" (same options, promoted
// here so the two features import one array instead of two copies that
// could drift). No "custom": a date-picker was more chrome than value —
// these four cover what a founder says out loud ("in a week", "after
// summer").
export const SNOOZE_OPTIONS = [
  { days: 3, label: '3 days' }, { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' }, { days: 30, label: '1 month' },
] as const;
