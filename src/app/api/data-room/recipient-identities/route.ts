// Prompt 560 §A — which of the addresses this org shared with belong to a
// registered Sherlock investor.
//
// The gap it fills: "associated" was decided by the founder's own `people`
// rows and nothing else (data-room-access-relationships.ts, rule 3). An
// investor creating a Sherlock account writes nothing into a founder's org,
// so a recipient who registered with the very address she was invited at
// stayed "Por associar" forever. Identity resolution knew one source of
// identities, and it was not the one where investors actually register.
//
// PRIVACY IS THE WHOLE DESIGN OF THIS ROUTE, so the rules are stated before
// the code:
//
//  1. Scope. Only emails that appear on THIS org's own non-revoked grants
//     are ever looked up. There is no way to ask this route about an
//     arbitrary address — the input is the org's grants, never the caller's
//     list — so it cannot be used to test whether someone has an account.
//  2. Existence vs. identity. `registered: true` says an account exists for
//     an address the founder already knows and already shared with; that is
//     information about their own share, not about a stranger.
//  3. A NAME needs a reason. The firm's name is returned only when the
//     investor has confirmed to THIS org ("it's me", which is the investor's
//     own act of identifying themselves here), or when the firm is already
//     in this org's pipeline (in which case the founder can read the name on
//     their own pipeline anyway, and withholding it would be theatre).
//     Otherwise: `registered: true` with no name.
//  4. Nothing else crosses. No investor person name, no email of any
//     teammate, no thesis, no plan, no activity. `catalogEntityId` is
//     returned because "Add to pipeline" needs something to create the
//     entity FROM, and it is meaningless without this founder's own action.
//
// Read-only. It creates nothing; the founder's explicit "Add to pipeline"
// (or "Associate to…") is what writes.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export interface RecipientIdentityRow {
  email: string;
  registered: true;
  firmName: string | null;
  catalogEntityId: string | null;
  pipelineEntityId: string | null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, identities: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Rule 1 — the universe of emails is this org's own grants, full stop.
  const { data: grants } = await admin.from('access_grants')
    .select('invited_email, grantee_email, confirmed_at')
    .eq('org_id', orgId).is('revoked_at', null);

  const confirmedEmails = new Set<string>();
  const emails = new Set<string>();
  for (const g of grants ?? []) {
    for (const raw of [g.invited_email, g.grantee_email]) {
      const e = (raw as string | null)?.trim().toLowerCase();
      if (!e) continue;
      emails.add(e);
      if (g.confirmed_at) confirmedEmails.add(e);
    }
  }
  if (emails.size === 0) return NextResponse.json({ ok: true, identities: [] });

  // auth.users is the only place an account's email lives; matchdeal_investor_
  // members keys on user_id. listUsers is paged, so this walks until it has
  // seen everything rather than assuming one page covers the platform.
  const userIdByEmail = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data?.users ?? []) {
      const e = u.email?.trim().toLowerCase();
      if (e && emails.has(e)) userIdByEmail.set(e, u.id);
    }
    if ((data?.users?.length ?? 0) < 1000) break;
  }
  if (userIdByEmail.size === 0) return NextResponse.json({ ok: true, identities: [] });

  const { data: members } = await admin.from('matchdeal_investor_members')
    .select('user_id, catalog_entity_id')
    .eq('status', 'active').in('user_id', [...userIdByEmail.values()]);
  const catalogIdByUser = new Map((members ?? []).map((m) => [m.user_id as string, m.catalog_entity_id as string]));
  if (catalogIdByUser.size === 0) return NextResponse.json({ ok: true, identities: [] });

  const catalogIds = [...new Set(catalogIdByUser.values())];
  const { data: catalogRows } = await admin.from('catalog_entities').select('id, name').in('id', catalogIds);
  const catalogName = new Map((catalogRows ?? []).map((c) => [c.id as string, c.name as string]));

  // Is the firm already in THIS org's pipeline? catalog_deliveries is the
  // link between a catalog firm and the entity it became for one org.
  const { data: deliveries } = await admin.from('catalog_deliveries')
    .select('catalog_id, entity_id').eq('org_id', orgId).in('catalog_id', catalogIds);
  const pipelineEntityByCatalog = new Map(
    (deliveries ?? []).filter((d) => d.entity_id).map((d) => [d.catalog_id as string, d.entity_id as string]),
  );

  const identities: RecipientIdentityRow[] = [];
  for (const [email, userId] of userIdByEmail) {
    const catalogEntityId = catalogIdByUser.get(userId);
    if (!catalogEntityId) continue;
    const pipelineEntityId = pipelineEntityByCatalog.get(catalogEntityId) ?? null;
    // Rule 3 — a name needs a reason.
    const mayName = confirmedEmails.has(email) || !!pipelineEntityId;
    identities.push({
      email,
      registered: true,
      firmName: mayName ? (catalogName.get(catalogEntityId) ?? null) : null,
      catalogEntityId,
      pipelineEntityId,
    });
  }

  return NextResponse.json({ ok: true, identities });
}
