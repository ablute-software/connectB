// Full org-role permission matrix (owner > admin > manager > member). Pure
// functions only — no I/O — so both UI (to hide/disable controls) and
// server routes (to actually enforce) can import the same source of truth.
// The org_role Postgres enum already has all four values (migration 0005);
// this is app-level rank/capability logic on top of it, not a schema change.
export type OrgRole = 'owner' | 'admin' | 'manager' | 'member';

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'manager', 'member'];

const RANK: Record<OrgRole, number> = { owner: 3, admin: 2, manager: 1, member: 0 };

export function rank(role: OrgRole): number {
  return RANK[role];
}

export type Capability =
  | 'view'
  | 'log_interaction'
  | 'edit_pipeline'
  | 'delete_pipeline'
  | 'manage_documents'
  | 'manage_automations'
  | 'invite_members'
  | 'remove_members'
  | 'change_roles'
  | 'manage_org_settings'
  | 'manage_billing';

const CAN: Record<Capability, OrgRole[]> = {
  view: ['owner', 'admin', 'manager', 'member'],
  log_interaction: ['owner', 'admin', 'manager', 'member'],
  edit_pipeline: ['owner', 'admin', 'manager'],
  delete_pipeline: ['owner', 'admin'],
  manage_documents: ['owner', 'admin', 'manager'],
  manage_automations: ['owner', 'admin'],
  invite_members: ['owner', 'admin'],
  remove_members: ['owner', 'admin'],
  change_roles: ['owner', 'admin'],
  // Batch 3 B: admins can now edit Organisation data too (was owner-only) —
  // enforced server-side in /api/org/update, not just the UI.
  manage_org_settings: ['owner', 'admin'],
  manage_billing: ['owner'],
};

export function can(role: OrgRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAN[capability].includes(role);
}

// An admin can invite/promote/demote anyone below admin, but never grant or
// touch owner/admin rank — only an owner can create another owner or admin.
// (Owners can assign any role, including transferring ownership.)
export function canAssignRole(actorRole: OrgRole, assignedRole: OrgRole): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return rank(assignedRole) < rank('admin');
  return false;
}

// Acting ON an existing member (role change or removal): the actor must
// outrank the target's *current* role — an admin can't touch another admin
// or an owner, regardless of what they'd be changed to.
export function canActOnMember(actorRole: OrgRole, targetCurrentRole: OrgRole): boolean {
  return rank(actorRole) > rank(targetCurrentRole);
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager', member: 'Member',
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: 'Full control, including billing and team roles.',
  admin: 'Manages the team (below admin) and org-wide automations; no billing.',
  manager: 'Edits pipeline data and documents; can\'t manage the team.',
  member: 'Logs interactions and views the pipeline; read-mostly.',
};
