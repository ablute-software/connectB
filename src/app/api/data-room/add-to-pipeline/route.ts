// Prompt 560 §A — "Add to pipeline" on a recipient who turned out to have a
// Sherlock investor account.
//
// The founder's own act, never automatic. /api/data-room/recipient-identities
// only reports that an account exists for an address this org already shared
// with; nothing appears in a pipeline until the founder clicks. That
// separation is the whole reason association is not silently written when an
// investor signs up — a firm landing in someone's fundraising pipeline is a
// decision, not a side effect of somebody else's registration.
//
// The catalog id is re-derived here from the org's OWN grants rather than
// trusted from the request body. Without that, this route would let any
// founder add any catalog firm to their pipeline for free by posting an id:
// `quota_exempt: true` is exactly what makes that worth doing.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { admitCatalogEntityIntoPipeline } from '@/lib/catalog-entity-admit';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const { email } = await req.json().catch(() => ({})) as { email?: string };
  const recipient = email?.trim().toLowerCase();
  if (!recipient) return NextResponse.json({ ok: false, error: 'email is required.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // The address must be one this org actually shared with — the same scope
  // rule recipient-identities enforces, re-checked here because this one
  // writes.
  const { data: grant } = await admin.from('access_grants').select('id')
    .eq('org_id', orgId).is('revoked_at', null)
    .or(`invited_email.eq.${recipient},grantee_email.eq.${recipient}`).limit(1).maybeSingle();
  if (!grant) return NextResponse.json({ ok: false, error: 'That address has no access from this workspace.' }, { status: 403 });

  // Resolve the address to a registered investor's firm, server-side.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    userId = (data?.users ?? []).find((u) => u.email?.trim().toLowerCase() === recipient)?.id ?? null;
    if ((data?.users?.length ?? 0) < 1000) break;
  }
  if (!userId) return NextResponse.json({ ok: false, error: 'No Sherlock account for that address.' }, { status: 404 });

  const { data: investorMember } = await admin.from('matchdeal_investor_members')
    .select('catalog_entity_id').eq('user_id', userId).eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  const catalogEntityId = investorMember?.catalog_entity_id as string | undefined;
  if (!catalogEntityId) return NextResponse.json({ ok: false, error: 'That account is not linked to an investor firm.' }, { status: 404 });

  const result = await admitCatalogEntityIntoPipeline(admin, orgId, catalogEntityId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
  return NextResponse.json({ ok: true, entityId: result.entityId, created: result.created });
}
