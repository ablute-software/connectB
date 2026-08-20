// Prompt 216 §C — a resolução "que documentos pode esta firma ver nesta
// org" extraída de /api/portal/interaction-log (onde nasceu como
// attachableDocuments, P134-D §4) para poder ser partilhada com
// /api/portal/actions-required sem duplicar o caminho com gate.
//
// O corpo é o MESMO byte a byte na semântica: grants ativos (não
// revogados, não expirados, convites só depois de confirmados), subárvore
// de pastas (204 §A), resolveDocumentAccess com visibility (204 a).
// Escopo por igualdade explícita de org_id em todas as queries — nunca o
// fallback "primeiro grant ativo" que /api/portal/access usa para outro
// fim — para nunca resolver documentos de outra org.
import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds, resolveDocumentAccess, type GrantLike } from './data-room';
import { vaultKillSwitchAvailable } from './vault-kill-switch-capability';

export type FirmGrant = GrantLike & { expires_at?: string | null; invited_email?: string | null; confirmed_at?: string | null };

// Prompt 278 §4 — the Vault kill switch's single read point. Every route
// that resolves what an investor can see of a startup's data room calls
// this (directly, or transitively through activeGrantsForFirm below) —
// fail-closed: an org this returns true for must behave exactly like an
// investor with zero grants, no matter what access_grants itself says.
export async function vaultFrozenForOrg(admin: SupabaseClient, orgId: string): Promise<boolean> {
  if (!(await vaultKillSwitchAvailable())) return false;
  const { data } = await admin.from('orgs').select('vault_access_frozen_at').eq('id', orgId).maybeSingle();
  return !!data?.vault_access_frozen_at;
}

export async function activeGrantsForFirm(admin: SupabaseClient, orgId: string, email: string): Promise<FirmGrant[]> {
  // Checked first, before any grants query: both this function's own
  // callers (actions-required's NDA-pending/new-docs counts) and its
  // downstream caller visibleDocumentsForFirm (interaction-log,
  // actions-required's newDocs) exist only to describe document access —
  // an empty list here is the correct "nothing to report" for all of them.
  if (await vaultFrozenForOrg(admin, orgId)) return [];
  const { data: grants } = await admin.from('access_grants').select('*').eq('org_id', orgId).is('revoked_at', null)
    .or([`grantee_email.eq.${email}`, `invited_email.eq.${email}`].join(','));
  const now = new Date();
  return ((grants ?? []) as unknown as FirmGrant[])
    .filter((g) => (!g.expires_at || new Date(g.expires_at) > now) && (!g.invited_email || g.confirmed_at));
}

export async function visibleDocumentsForFirm(admin: SupabaseClient, orgId: string, email: string): Promise<{ id: string; name: string }[]> {
  const activeGrants = await activeGrantsForFirm(admin, orgId, email);
  if (activeGrants.length === 0) return [];

  const { data: orgFolders } = await admin.from('folders').select('id, parent_id').eq('org_id', orgId);
  const folderTree = (orgFolders ?? []).map((f) => ({ id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined }));
  const folderIds = descendantFolderIds(folderTree, activeGrants.filter((g) => g.folder_id).map((g) => g.folder_id as string));
  const directDocIds = activeGrants.filter((g) => g.document_id).map((g) => g.document_id as string);
  const [{ data: docsInFolders }, { data: directDocs }] = await Promise.all([
    folderIds.length ? admin.from('documents').select('id, name, folder_id, visibility').in('folder_id', folderIds).eq('org_id', orgId) : Promise.resolve({ data: [] }),
    directDocIds.length ? admin.from('documents').select('id, name, folder_id, visibility').in('id', directDocIds).eq('org_id', orgId) : Promise.resolve({ data: [] }),
  ]);
  const docMap = new Map<string, { id: string; name: string; folder_id: string | null; visibility?: string }>();
  for (const d of [...(docsInFolders ?? []), ...(directDocs ?? [])]) docMap.set(d.id as string, d as { id: string; name: string; folder_id: string | null; visibility?: string });
  const candidateDocs = [...docMap.values()];

  const { visibleIds } = resolveDocumentAccess(activeGrants, candidateDocs.map((d) => ({ id: d.id, folder_id: d.folder_id ?? undefined, visibility: d.visibility })), folderTree);
  return candidateDocs.filter((d) => visibleIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name }));
}
