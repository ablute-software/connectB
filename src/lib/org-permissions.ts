// Batch 3 C — owner-configurable role→capability matrix. Pure functions (no
// I/O), so the config UI, the server routes that enforce it, and the tests
// all import one source of truth. Overrides are stored per org
// (orgs.permission_matrix jsonb, migration 0026); absent keys fall back to
// DEFAULT_MATRIX, which mirrors today's static permissions.ts. The owner
// always keeps every capability — resolveMatrix guarantees it, so no config
// can ever lock the owner out.
import type { OrgRole } from './permissions';

// The configurable capabilities the founder listed. Distinct from
// permissions.ts's internal Capability union — this is the founder-facing
// matrix vocabulary.
export type MatrixCapability =
  | 'data_room_read' | 'data_room_upload' | 'data_room_manage' | 'access_grants'
  | 'outbox_approval' | 'automations_config' | 'packs_unlock' | 'backoffice_access'
  | 'invites' | 'org_editing';

export const MATRIX_CAPABILITIES: { key: MatrixCapability; label: string; note?: string }[] = [
  { key: 'data_room_read', label: 'Data room — read' },
  { key: 'data_room_upload', label: 'Data room — upload / import' },
  { key: 'data_room_manage', label: 'Data room — manage (delete / rename)' },
  { key: 'access_grants', label: 'Access grants' },
  { key: 'outbox_approval', label: 'Outbox — approve sends' },
  { key: 'automations_config', label: 'Automations — configure' },
  { key: 'packs_unlock', label: 'Packs — unlock' },
  { key: 'backoffice_access', label: 'Back-office access', note: 'Platform-admin is still required — this toggle only restricts further, never grants.' },
  { key: 'invites', label: 'Invite teammates' },
  { key: 'org_editing', label: 'Organisation editing' },
];

// Defaults mirror today's behaviour (permissions.ts static matrix).
export const DEFAULT_MATRIX: Record<MatrixCapability, OrgRole[]> = {
  data_room_read: ['owner', 'admin', 'manager', 'member'],
  data_room_upload: ['owner', 'admin', 'manager'],
  data_room_manage: ['owner', 'admin'],
  access_grants: ['owner', 'admin', 'manager'],
  outbox_approval: ['owner', 'admin'],
  automations_config: ['owner', 'admin'],
  packs_unlock: ['owner', 'admin', 'manager'],
  backoffice_access: ['owner', 'admin', 'manager', 'member'],
  invites: ['owner', 'admin'],
  org_editing: ['owner', 'admin'],
};

export type MatrixOverrides = Partial<Record<MatrixCapability, OrgRole[]>>;

// Merge stored overrides onto the defaults, then force the owner into every
// capability — the owner column is fixed and un-editable in the UI, and this
// is the belt-and-suspenders backstop so a malformed override can't lock the
// owner out.
export function resolveMatrix(overrides?: MatrixOverrides | null): Record<MatrixCapability, OrgRole[]> {
  const out = { ...DEFAULT_MATRIX };
  if (overrides) {
    for (const cap of Object.keys(DEFAULT_MATRIX) as MatrixCapability[]) {
      if (Array.isArray(overrides[cap])) out[cap] = overrides[cap]!;
    }
  }
  for (const cap of Object.keys(out) as MatrixCapability[]) {
    if (!out[cap].includes('owner')) out[cap] = ['owner', ...out[cap]];
  }
  return out;
}

export function canWithMatrix(matrix: Record<MatrixCapability, OrgRole[]>, role: OrgRole | null | undefined, cap: MatrixCapability): boolean {
  return !!role && matrix[cap].includes(role);
}
