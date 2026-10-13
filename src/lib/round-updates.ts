// Prompt 906 §B — the two small decisions about a round update that the founder's routes and the investor's feed
// must agree on, kept in one pure place.
//
// Who may edit or delete one: an owner or an admin of the org (the same people who may edit the organisation's
// own settings — `manage_org_settings` in permissions.ts, so UI and server read one matrix), or the author of
// that very update. The table's RLS is `FOR ALL` for every member of the org, so this rule is enforced by the
// route, not by the database (see DECISIONS.md, Prompt 906: a member can still reach the table directly with
// their own session, as they always could).
import { can, type OrgRole } from './permissions';

export function canManageRoundUpdate(p: { role: string | null; userId: string; createdBy: string | null | undefined }): boolean {
  if (!p.role) return false; // not on the team (any more): never
  if (can(p.role as OrgRole, 'manage_org_settings')) return true;
  return !!p.createdBy && p.createdBy === p.userId;
}

/**
 * When a round update was last edited, or null if it never was. `updated_at` is NULL until the title or body
 * changes (migration 20261013100000: the trigger stamps only a real change), so "edited" is simply "set" — with a
 * guard for a row stamped before its own creation, which can only be bad data and must not read as an edit.
 */
export function roundUpdateEditedAt(u: { created_at: string; updated_at?: string | null }): string | null {
  if (!u.updated_at) return null;
  const edited = Date.parse(u.updated_at);
  const created = Date.parse(u.created_at);
  if (Number.isNaN(edited)) return null;
  if (!Number.isNaN(created) && edited < created) return null;
  return u.updated_at;
}

/** The sentence the delete confirmation shows. One string, so the test and the UI cannot drift apart. */
export const ROUND_UPDATE_DELETE_MESSAGE =
  "This removes the update from your profile and from investors' feeds. Investors who already saw it keep their notification.";
