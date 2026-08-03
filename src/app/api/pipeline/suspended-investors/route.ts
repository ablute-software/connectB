// Prompt 107 B.5 — which of THIS org's pipeline entities are currently
// suspended investors. Read-only, derived at read time (never a mass
// write to `entities` — the toggle is reversible and frequent by design;
// a round-trip bulk update would corrupt founder-owned state like notes
// and history, and be impossible to reverse faithfully). entities has no
// catalog_entity_id FK, so this walks the same chain P107's investigation
// found: matchdeal_investor_members.catalog_entity_id -> catalog_deliveries
// (by org_id + catalog_id) -> entity_id.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, suspendedEntityIds: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: true, suspendedEntityIds: [] });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: deliveries } = await admin.from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', member.org_id);
  if (!deliveries?.length) return NextResponse.json({ ok: true, suspendedEntityIds: [] });

  const catalogIds = [...new Set(deliveries.map((d) => d.catalog_id as string))];
  const { data: members } = await admin.from('matchdeal_investor_members').select('id, catalog_entity_id').in('catalog_entity_id', catalogIds);
  if (!members?.length) return NextResponse.json({ ok: true, suspendedEntityIds: [] });

  const memberIds = members.map((m) => m.id as string);
  const { data: profiles } = await admin.from('matchdeal_profiles')
    .select('membership_id, owner_suspended_at, platform_suspended_at')
    .eq('kind', 'investor').in('membership_id', memberIds);

  const suspendedCatalogIds = new Set(
    (members ?? [])
      .filter((m) => (profiles ?? []).some((p) =>
        p.membership_id === m.id && (p.owner_suspended_at || p.platform_suspended_at)))
      .map((m) => m.catalog_entity_id as string),
  );

  const suspendedEntityIds = deliveries
    .filter((d) => suspendedCatalogIds.has(d.catalog_id as string))
    .map((d) => d.entity_id as string);

  return NextResponse.json({ ok: true, suspendedEntityIds: [...new Set(suspendedEntityIds)] });
}
