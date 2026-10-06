// AP-11 — founder-side visibility of an investor's Pipeline decision
// (Interested/Passed) and, for a Pass, the reason. investor_relationship_decisions
// is org-level (AP-14), so this is a simple org-scoped read via the
// existing investor_relationship_decisions_org_member RLS policy — no
// entity-matching needed (entities has no reliable FK to catalog_entities
// to join through).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveViewedOrg } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  // Prompt 902 — the viewed org in a Developer Viewer session, the caller's own
  // otherwise. This card ("Investor decisions") showed the DEVELOPER'S org's
  // Interested/Passed decisions (e.g. nunomarujo@gmail.com's, recorded against
  // ablute_) under whichever org was being viewed.
  const { orgId, viewer } = await resolveViewedOrg(sb, req, user.id);
  if (!orgId) return NextResponse.json({ error: 'Not a member of any org.' }, { status: 403 });

  // Outside the viewer: the caller's own RLS-scoped client, exactly as before
  // (investor_relationship_decisions_org_member). Inside it the developer is not
  // a member of the viewed org, so that policy would answer with nothing: read
  // through service-role instead, scoped to the org id resolved above and never
  // to anything the client sent.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = viewer && url && service ? createClient(url, service, { auth: { persistSession: false } }) : sb;

  const { data: decisions } = await db.from('investor_relationship_decisions')
    .select('id, decision, reason_detail, decided_at, investor_catalog_entity_id')
    .eq('org_id', orgId).order('decided_at', { ascending: false });

  const catalogIds = [...new Set((decisions ?? []).map((d) => d.investor_catalog_entity_id as string))];
  const { data: catalogEntities } = catalogIds.length
    ? await db.from('catalog_entities').select('id, name').in('id', catalogIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.name as string]));

  return NextResponse.json({
    decisions: (decisions ?? []).map((d) => ({
      id: d.id, decision: d.decision, reasonDetail: d.reason_detail, decidedAt: d.decided_at,
      investorName: nameById.get(d.investor_catalog_entity_id as string) ?? 'Unknown investor',
    })),
  });
}
