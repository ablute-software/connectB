// Prompt 642 §4 — the worker does not write over what a human verified.
//
// The condition without which every admin/founder/import path is theatre:
// Nuno writes a thesis at verified_by_admin at 23:00 and the model replaces
// it at 03:20. Measured on 2026-09-09: the import of 640 left 144 people
// with a human-stamped background and hook_status = to_research — every
// one eligible for the 03:45 sweep, and the web path wrote background with
// `?? null`, so a human value would be replaced by the model's text or by
// nothing at all.
//
// Two rules, both pure so src/lib/human-guard.test.ts tests this file:
//   1. stripHumanVerified — any key whose level in verified_fields is a
//      human level (plausible_by_startups, verified_by_startups,
//      verified_by_admin, verified_by_person) leaves the patch. The model
//      has no rung on the ladder; it refreshes only what nobody stamped.
//   2. withoutNulls — a key the model did not return is omitted, never
//      written as null. An upsert only touches what it carries.
//
// The import also stores non-level keys beside the levels (hook_evidence,
// hook_verified_at, hook_profile_state — 642's side note). Only a value that
// IS a level protects a field; the others are ignored here.

export const HUMAN_LEVELS: ReadonlySet<string> = new Set([
  'plausible_by_startups', 'verified_by_startups', 'verified_by_admin', 'verified_by_person',
]);

/** hook_source has no meaning without hook: when hook is protected, so is its source. */
const COMPANIONS: Record<string, string> = { hook_source: 'hook' };

export function isHumanVerified(verifiedFields: Record<string, unknown> | null | undefined, field: string): boolean {
  const level = verifiedFields?.[field];
  return typeof level === 'string' && HUMAN_LEVELS.has(level);
}

export interface GuardedPatch<T> {
  kept: Partial<T>;
  protectedKeys: string[];
}

export function stripHumanVerified<T extends Record<string, unknown>>(
  patch: T,
  verifiedFields: Record<string, unknown> | null | undefined,
): GuardedPatch<T> {
  const kept: Partial<T> = {};
  const protectedKeys: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const guardKey = COMPANIONS[key] ?? key;
    if (isHumanVerified(verifiedFields, guardKey)) {
      protectedKeys.push(key);
    } else {
      (kept as Record<string, unknown>)[key] = value;
    }
  }
  return { kept, protectedKeys };
}

export function withoutNulls<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
