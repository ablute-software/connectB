// Prompt 126 E — founder-side surfacing of "Express interest" (see the
// migration 0124 header comment for the full rationale). GET lists this
// org's unseen 'interested' decisions; POST marks one seen (dismissed from
// the popup). Both no-op cleanly if migration 0124 isn't applied yet —
// same capability-gated-degrade convention as every other propose-only
// feature in this codebase.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { investorInterestNotifyAvailable } from '@/lib/investor-interest-notify-capability';

async function resolveFounderOrgId(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (member?.org_id as string | undefined) ?? null;
}

export async function GET(req: Request) {
  // Demo mode — same "check before ever calling serverClient()" convention
  // every other route in this codebase follows, since the InvestorInterestPopup
  // is mounted unconditionally in Shell and will hit this route on every
  // demo-mode page too.
  if (!authEnabled) return NextResponse.json({ items: [] });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  if (!(await investorInterestNotifyAvailable())) return NextResponse.json({ items: [] });

  const orgId = await resolveFounderOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ items: [] });

  // Prompt 257 §2 — Pipeline's "in conversation" band needs every entity
  // with an expressed-interest decision on record, not just the ones still
  // waiting for the popup's one-time dismissal. ?all=1 is additive: the
  // popup itself never passes it, so its own seen_at-filtered behavior is
  // untouched.
  const all = new URL(req.url).searchParams.get('all') === '1';
  let query = sb.from('investor_relationship_decisions')
    .select('id, investor_catalog_entity_id, reason_detail, decided_at')
    .eq('org_id', orgId).eq('decision', 'interested');
  if (!all) query = query.is('seen_at', null);
  const { data: rows } = await query.order('decided_at', { ascending: true });
  if (!rows || rows.length === 0) return NextResponse.json({ items: [] });

  const catalogIds = rows.map((r) => r.investor_catalog_entity_id as string);
  const [{ data: catalogRows }, { data: deliveryRows }] = await Promise.all([
    sb.from('catalog_entities').select('id, name').in('id', catalogIds),
    sb.from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', orgId).in('catalog_id', catalogIds),
  ]);
  const nameById = new Map((catalogRows ?? []).map((c) => [c.id as string, c.name as string]));
  const entityByCatalogId = new Map((deliveryRows ?? []).map((d) => [d.catalog_id as string, d.entity_id as string | null]));

  const items = rows.map((r) => ({
    catalogEntityId: r.investor_catalog_entity_id as string,
    investorName: nameById.get(r.investor_catalog_entity_id as string) ?? 'An investor',
    reasonDetail: r.reason_detail as string | null,
    decidedAt: r.decided_at as string,
    entityId: entityByCatalogId.get(r.investor_catalog_entity_id as string) ?? null,
  }));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  if (!authEnabled) return NextResponse.json({ ok: false }, { status: 200 });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const orgId = await resolveFounderOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { catalogEntityId?: string };
  if (!body.catalogEntityId) return NextResponse.json({ ok: false, error: 'catalogEntityId is required.' }, { status: 400 });

  // investor_relationship_decisions has no founder-facing UPDATE policy
  // (see migration 0077's own comment — every write goes through
  // service-role), so this update goes through the admin client, scoped to
  // this founder's OWN org_id (resolved server-side above, never trusted
  // from the request body) — never a broad RLS grant on a decisions table.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false }, { status: 200 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await admin.from('investor_relationship_decisions').update({ seen_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('investor_catalog_entity_id', body.catalogEntityId);

  return NextResponse.json({ ok: true });
}
