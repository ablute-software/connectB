// Prompt 909 (I3) — the permissions of the team of a call (spec §9.2) and the categories that carry them (§9.1).
// Pure and client-safe: the editor draws the toggles from PERMISSIONS, the server decides with the same functions.
//
// Nine permissions, switched on and off for a whole CATEGORY of the organisation. A person in a call may have
// individual adjustments over their category (hidden in the UI until the box is opened). Three are enforced by the
// server already — Configure call, Manage team & permissions and (since Prompt 907) View all applications, which
// opens the read-only list of SUBMITTED applications; the other six are stored and shown, and marked "Used from the
// next stage" until evaluation and distribution exist.

export const PERMISSION_KEYS = [
  'configure_call', 'manage_team', 'view_all_applications', 'evaluate_assigned', 'correct_eligibility',
  'view_colleagues_evaluations', 'final_decision', 'publish_results', 'handle_contestations',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionSet = Record<PermissionKey, boolean>;

export interface PermissionInfo { key: PermissionKey; label: string; hint: string; enforced: boolean }

export const PERMISSIONS: readonly PermissionInfo[] = [
  { key: 'configure_call', label: 'Configure call', enforced: true,
    hint: 'Edit General, Phases and Form; confirm, publish, delete and archive the call.' },
  { key: 'manage_team', label: 'Manage team & permissions', enforced: true, hint: 'Edit the Team tab.' },
  { key: 'view_all_applications', label: 'View all applications', enforced: true, hint: 'Open the list of submitted applications and read each one. Off: only the applications assigned to the person (assignment arrives with distribution).' },
  { key: 'evaluate_assigned', label: 'Evaluate assigned applications', enforced: false, hint: 'Score the applications assigned to the person.' },
  { key: 'correct_eligibility', label: 'Correct eligibility & document validity', enforced: true, hint: 'Overrule an automatic eligibility or document decision, with a reason (Applications). Without it, a person can still flag an application for validation.' },
  { key: 'view_colleagues_evaluations', label: 'View colleagues’ evaluations after completing own', enforced: false, hint: 'Only after the person has finished their own evaluation.' },
  { key: 'final_decision', label: 'Final decision & selection overrides', enforced: false, hint: 'Decide the final outcome and override the selection.' },
  { key: 'publish_results', label: 'Publish results', enforced: false, hint: 'Make the results visible to applicants.' },
  { key: 'handle_contestations', label: 'Handle contestations', enforced: false, hint: 'Answer an applicant’s contestation.' },
];

export const NO_PERMISSIONS: PermissionSet = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as PermissionSet;
export const ALL_PERMISSIONS: PermissionSet = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as PermissionSet;

/** What a stored object means: a key that is missing, unknown or not a boolean is OFF. */
export function normalizePermissions(raw: unknown): PermissionSet {
  const out = { ...NO_PERMISSIONS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of PERMISSION_KEYS) if ((raw as Record<string, unknown>)[k] === true) out[k] = true;
  }
  return out;
}

/** Individual adjustments: only known keys with a real boolean survive. Unlike a category, `false` here is meaningful. */
export function normalizeOverrides(raw: unknown): Partial<PermissionSet> {
  const out: Partial<PermissionSet> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of PERMISSION_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/** The category's permissions with the person's own adjustments on top. */
export function effectivePermissions(category: PermissionSet, overrides: Partial<PermissionSet>): PermissionSet {
  const out = { ...category };
  for (const k of PERMISSION_KEYS) if (typeof overrides[k] === 'boolean') out[k] = overrides[k] as boolean;
  return out;
}

/** A person who can both configure the call and manage its team: what every call must always have at least one of. */
export const isCallAdministrator = (p: PermissionSet): boolean => p.configure_call && p.manage_team;

// --- Categories ------------------------------------------------------------------------------------------------------

export const ADMIN_CATEGORY_NAME = 'Administrator';
export const SUGGESTED_CATEGORIES = ['Evaluator', 'Manager', 'Analyst', 'Finance specialist', 'Technical specialist', 'Legal'] as const;
export const MAX_CATEGORY_NAME = 60;

const only = (...keys: PermissionKey[]): PermissionSet => ({ ...NO_PERMISSIONS, ...Object.fromEntries(keys.map((k) => [k, true])) });

/**
 * What a suggested category starts with when somebody picks it from a person's list (Prompt 918, follow-up). "View assigned" is not a switch of its own: it is
 * what a person has when "View all applications" is OFF, so an Evaluator is just "Evaluate assigned". The experts (Finance, Technical, Legal) read and score
 * what is assigned to them, like an Evaluator. Editable afterwards, like any category.
 */
export const SUGGESTED_CATEGORY_PERMISSIONS: Record<(typeof SUGGESTED_CATEGORIES)[number], PermissionSet> = {
  Evaluator: only('evaluate_assigned'),
  Analyst: only('view_all_applications'),
  Manager: { ...ALL_PERMISSIONS, manage_team: false },
  'Finance specialist': only('evaluate_assigned'),
  'Technical specialist': only('evaluate_assigned'),
  Legal: only('evaluate_assigned'),
};

/** The starting permissions of a name, if it is one of the suggestions (whatever the case); otherwise none, as a category made from scratch. */
export function suggestedPermissions(name: string): PermissionSet | null {
  const hit = SUGGESTED_CATEGORIES.find((s) => sameCategoryName(s, name));
  return hit ? { ...SUGGESTED_CATEGORY_PERMISSIONS[hit] } : null;
}

/** A category name as it is stored: trimmed, inner spaces collapsed, not empty, not absurdly long. null = not acceptable. */
export function cleanCategoryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name && name.length <= MAX_CATEGORY_NAME ? name : null;
}

/** The same name, whatever the case and spacing: the rule behind "a repeated name in the same organisation is refused". */
export const sameCategoryName = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
