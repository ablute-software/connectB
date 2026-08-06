// Approve a pending investor access request — creates a real access_grants
// row (grantee_email, scoped to ablute_'s top-level Data Room folder), which
// is the actual mechanism resolveRole() checks for the 'investor' role.
//
// Scoped to ABLUTE_ORG_ID rather than a chosen org: this table has no
// org_id (it's a platform-wide "I'm an investor" lead, not tied to any
// specific startup yet), and ablute_ is the only real org in this
// single-tenant-so-far deployment. Revisit with an org/folder picker once a
// second org exists and "approve" needs to mean "grant access to a specific
// founder's data room" rather than "grant access to ablute_'s".
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { ABLUTE_ORG_ID } from '@/lib/ablute-org';
import { checkInvestorDomainMatch } from '@/lib/investor-domain-match';
import { notifyInvestorAccessDecision } from '@/lib/investor-access-request-notify';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: reqRow, error: reqErr } = await admin.from('investor_access_requests')
    .select('id, email, firm_name, status').eq('id', id).single();
  if (reqErr) return NextResponse.json({ ok: false, error: reqErr.message }, { status: 404 });
  if (reqRow.status === 'approved') return NextResponse.json({ ok: true, alreadyApproved: true });

  // P103 Bloco 1 — was .eq('name', 'Data Room'), a real functional
  // dependency on the display label (would have broken the moment the
  // folder was renamed to "Vault Data Room"). `kind` already exists and
  // already means exactly this, decoupled from whatever the UI calls it.
  const { data: dataRoomFolder, error: folderErr } = await admin.from('folders')
    .select('id').eq('org_id', ABLUTE_ORG_ID).is('parent_id', null).eq('kind', 'data_room').maybeSingle();
  if (folderErr) return NextResponse.json({ ok: false, error: folderErr.message }, { status: 500 });
  if (!dataRoomFolder) return NextResponse.json({ ok: false, error: 'ablute_ has no top-level Data Room folder to grant.' }, { status: 500 });

  const { data: grant, error: grantErr } = await admin.from('access_grants').insert({
    org_id: ABLUTE_ORG_ID,
    grantee_email: reqRow.email,
    folder_id: dataRoomFolder.id,
    granted_by: userId,
    note: 'Granted via back-office investor access request approval.',
  }).select('id').single();
  if (grantErr) return NextResponse.json({ ok: false, error: grantErr.message }, { status: 500 });

  const { error: updateErr } = await admin.from('investor_access_requests').update({
    status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString(), access_grant_id: grant.id,
  }).eq('id', id);
  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

  // Domain-match verdict recomputed at approval time (not trusted from the
  // client) purely for audit-trail provenance — this endpoint always
  // requires an explicit admin click either way, matching Anexo B: a
  // mismatch/generic-email/no-website/no-match verdict never auto-approves
  // anything, it only ever means a human has to look before this fires.
  const { data: entities } = await admin.from('catalog_entities').select('id, name, website');
  const { data: aliases } = await admin.from('entity_aliases').select('catalog_id, alias').not('catalog_id', 'is', null);
  const domainMatch = checkInvestorDomainMatch({
    email: reqRow.email, firmName: reqRow.firm_name, entities: entities ?? [],
    aliases: (aliases ?? []) as { catalog_id: string; alias: string }[],
  });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'investor_access_request_approved', subjectType: 'investor_access_request',
    subjectId: id, detail: { email: reqRow.email, access_grant_id: grant.id, domainMatch },
  });

  // Item 10 — the decision itself (the access_grants row + status update
  // above) is the business fact and has already committed; a failed
  // notification never reverts it or turns this into a 500.
  const { notifyFailed } = await notifyInvestorAccessDecision(admin, { id, email: reqRow.email, status: 'approved' });

  return NextResponse.json({ ok: true, notifyFailed });
}
