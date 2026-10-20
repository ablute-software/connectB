// Prompt 918 (follow-up to the I1 test) — the Team tab used to wait for the server before a check changed (about a second per click). It now shows the change at once and saves behind
// the scenes; this is the pure half: what a change LOOKS like on the screen's picture of the team (TeamPayload), computed locally, in the same shape the server answers with. The server
// stays the authority — it recomputes everything and may refuse; the screen then puts the picture back (see TeamTab). Client-safe: types only from the server-only payload file.
import type { TeamPayload } from './team-payload';
import { effectivePermissions, type PermissionSet } from './permissions';

export type TeamChange = Record<string, unknown> & { action: string };

/** The changes the screen shows before the server has answered. Everything else (creating, renaming and deleting categories, conflicts) waits for the answer. */
export const OPTIMISTIC_ACTIONS: readonly string[] = ['set_category_permissions', 'set_overrides', 'set_category', 'add_member', 'remove_member'];
export const isOptimistic = (change: TeamChange): boolean => OPTIMISTIC_ACTIONS.includes(change.action);

/** Several clicks on the same switches become one save of the last picture: these two send the WHOLE set, so the last one says everything the earlier ones did. */
export function debounceKey(change: TeamChange): string | null {
  if (change.action === 'set_category_permissions' && typeof change.categoryId === 'string') return `permissions:category:${change.categoryId}`;
  if (change.action === 'set_overrides' && typeof change.userId === 'string') return `permissions:person:${change.userId}`;
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Recomputes what is derived from the members and categories: who is in what, what each person effectively has, and whether anybody can still run the call. */
function settle(d: TeamPayload): TeamPayload {
  const byId = new Map(d.categories.map((c) => [c.id, c]));
  const members = d.members.map((m) => ({ ...m, effective: effectivePermissions(byId.get(m.categoryId)?.permissions ?? ({} as PermissionSet), m.overrides) }));
  return {
    ...d, members,
    categories: d.categories.map((c) => ({ ...c, peopleInThisCall: members.filter((m) => m.categoryId === c.id).length })),
    noAdministrator: !members.some((m) => m.effective.configure_call && m.effective.manage_team),
  };
}

/** The picture of the team after one change, as the screen shows it before the answer. A change that makes no sense for this picture leaves it as it is (the server will say why). */
export function applyChange(d: TeamPayload, change: TeamChange): TeamPayload {
  switch (change.action) {
    case 'set_category_permissions': {
      const id = str(change.categoryId);
      if (!d.categories.some((c) => c.id === id)) return d;
      const permissions = change.permissions as PermissionSet;
      return settle({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, permissions } : c)) });
    }
    case 'set_overrides': {
      const id = str(change.userId);
      if (!d.members.some((m) => m.userId === id)) return d;
      return settle({ ...d, members: d.members.map((m) => (m.userId === id ? { ...m, overrides: (change.overrides ?? {}) as Partial<PermissionSet> } : m)) });
    }
    case 'set_category': {
      const id = str(change.userId); const categoryId = str(change.categoryId);
      if (!d.members.some((m) => m.userId === id) || !d.categories.some((c) => c.id === categoryId)) return d;
      const from = d.members.find((m) => m.userId === id)?.categoryId;
      return settle({
        ...d, members: d.members.map((m) => (m.userId === id ? { ...m, categoryId } : m)),
        categories: d.categories.map((c) => (c.id === from && from !== categoryId ? { ...c, peopleInOrganisation: Math.max(0, c.peopleInOrganisation - 1) } : c.id === categoryId && from !== categoryId ? { ...c, peopleInOrganisation: c.peopleInOrganisation + 1 } : c)),
      });
    }
    case 'add_member': {
      const id = str(change.userId); const categoryId = str(change.categoryId);
      const person = d.candidates.find((p) => p.userId === id);
      if (!person || !person.eligible || d.members.some((m) => m.userId === id) || !d.categories.some((c) => c.id === categoryId)) return d;
      return settle({
        ...d,
        members: [...d.members, { userId: id, name: person.name, email: person.email, orgRole: person.role, categoryId, overrides: {}, effective: {} as PermissionSet }],
        candidates: d.candidates.filter((p) => p.userId !== id),
        categories: d.categories.map((c) => (c.id === categoryId ? { ...c, peopleInOrganisation: c.peopleInOrganisation + 1 } : c)),
      });
    }
    case 'remove_member': {
      const id = str(change.userId);
      const gone = d.members.find((m) => m.userId === id);
      if (!gone) return d;
      // The person goes back to the list of people who can be added (with a seat, since they were in the team).
      const back: TeamPayload['candidates'][number] = { userId: gone.userId, name: gone.name, email: gone.email, role: gone.orgRole, eligible: true, reason: null };
      return settle({
        ...d, members: d.members.filter((m) => m.userId !== id), candidates: [...d.candidates, back],
        categories: d.categories.map((c) => (c.id === gone.categoryId ? { ...c, peopleInOrganisation: Math.max(0, c.peopleInOrganisation - 1) } : c)),
      });
    }
    default:
      return d;
  }
}

/** The picture after a list of changes, in order (the server's last answer + whatever is still waiting or being saved). */
export const applyChanges = (d: TeamPayload, changes: TeamChange[]): TeamPayload => changes.reduce(applyChange, d);
