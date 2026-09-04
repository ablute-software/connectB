// Prompt 555 §C — the founder's live read of a MatchDeal investor's own firm.
//
// The founder side used to describe these investors from their catalog stub,
// which for a self-registered investor is empty by construction. Their real
// profile lives in matchdeal_profiles and nothing on this side ever read it.
// This route is that read, and it is deliberately LIVE rather than a copy: an
// investor who finishes their profile tomorrow shows up here with no sync
// step, exactly as Prompt 256 intended when it resolved the (wrong) catalog
// match fresh on every render.
//
// The projection itself is matchdeal_investor_firm_view (migration 0302),
// revoked from public/anon/authenticated — this route holds the org
// membership check and calls it with the service role.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { readVerifiedViewerOrgId } from '@/lib/developer-viewer';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // The entity decides the org; the caller must be a member of THAT org. A
  // developer viewing a startup read-only resolves the same way every other
  // surface does.
  const { data: entity } = await admin.from('entities').select('id, org_id, source').eq('id', params.id).maybeSingle();
  if (!entity) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  // Prompt 559 §A — verified, not parsed: an unsigned cookie must never be
  // what decides the membership check is skippable.
  const viewerOrgId = await readVerifiedViewerOrgId(sb, req);
  if (viewerOrgId !== entity.org_id) {
    const { data: member } = await sb.from('org_members')
      .select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });
  }

  const { data: delivery } = await admin.from('catalog_deliveries')
    .select('catalog_id').eq('entity_id', params.id).maybeSingle();
  if (!delivery?.catalog_id) {
    // A catalog-born investor, or one with no delivery row: today's path is
    // untouched and the page keeps using the catalog match.
    return NextResponse.json({ ok: false, error: 'No MatchDeal profile behind this entity.' }, { status: 404 });
  }

  const { data: firm, error } = await admin.rpc('matchdeal_investor_firm_view', {
    p_catalog_id: delivery.catalog_id, p_preferred_profile_id: null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!firm) return NextResponse.json({ ok: false, error: 'No MatchDeal profile behind this entity.' }, { status: 404 });

  return NextResponse.json({ ok: true, firm });
}
