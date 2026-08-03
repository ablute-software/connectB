// Investor Workspace Network (prompt 62.2) — "who else from your firm is
// here." Read-only, visibility-only per the prompt (no invite/permission
// management this pass). Reuses matchdeal_investor_members as-is — no
// schema change.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const own = await resolveActiveInvestorMember(admin, user.id);
  if (!own) return NextResponse.json({ linked: false });

  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', own.catalog_entity_id).maybeSingle();

  const { data: colleagues } = await admin.from('matchdeal_investor_members').select('id, user_id')
    .eq('catalog_entity_id', own.catalog_entity_id).eq('status', 'active').neq('id', own.id);

  const memberIds = (colleagues ?? []).map((c) => c.id as string);
  const { data: profiles } = memberIds.length
    ? await admin.from('matchdeal_profiles').select('membership_id, representative_name').eq('kind', 'investor').in('membership_id', memberIds)
    : { data: [] as { membership_id: string; representative_name: string | null }[] };
  const nameByMemberId = new Map((profiles ?? []).map((p) => [p.membership_id as string, p.representative_name as string | null]));

  const list = await Promise.all((colleagues ?? []).map(async (c) => {
    const { data } = await admin.auth.admin.getUserById(c.user_id as string);
    return { email: data.user?.email ?? 'unknown', name: nameByMemberId.get(c.id as string) ?? null };
  }));

  return NextResponse.json({ linked: true, entityName: entity?.name ?? null, colleagues: list });
}
