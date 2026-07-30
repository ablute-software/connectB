// AP-11 — founder-side visibility of an investor's Pipeline decision
// (Interested/Passed) and, for a Pass, the reason. investor_relationship_decisions
// is org-level (AP-14), so this is a simple org-scoped read via the
// existing investor_relationship_decisions_org_member RLS policy — no
// entity-matching needed (entities has no reliable FK to catalog_entities
// to join through).
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Not a member of any org.' }, { status: 403 });

  const { data: decisions } = await sb.from('investor_relationship_decisions')
    .select('id, decision, reason_detail, decided_at, investor_catalog_entity_id')
    .eq('org_id', member.org_id).order('decided_at', { ascending: false });

  const catalogIds = [...new Set((decisions ?? []).map((d) => d.investor_catalog_entity_id as string))];
  const { data: catalogEntities } = catalogIds.length
    ? await sb.from('catalog_entities').select('id, name').in('id', catalogIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.name as string]));

  return NextResponse.json({
    decisions: (decisions ?? []).map((d) => ({
      id: d.id, decision: d.decision, reasonDetail: d.reason_detail, decidedAt: d.decided_at,
      investorName: nameById.get(d.investor_catalog_entity_id as string) ?? 'Unknown investor',
    })),
  });
}
