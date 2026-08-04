// Investor Workspace shell (prompt 57) — link this session to a real
// matchdeal_investor_members row, so the About tab has somewhere to write
// the profile. Reuses investor-domain-match.ts (Prompt 41) rather than
// reimplementing verification: the signed-in email's domain matching the
// catalog entity's own domain sets domain_verified=true immediately.
//
// Identity verification Fase A (prompt 63) — a domain mismatch used to hard
// -block linking here (403, dead end: "encontrámos algo parecido mas o
// domínio não bate", e.g. the LINCE Capital case). That's exactly the
// "caminho sem saída" this prompt fixes: a mismatch now still links
// (domain_verified=false, identity_status computes to
// pending_verification — see investor-identity.ts), so onboarding
// continues while the investor can strengthen verification later (document
// upload, Bloco 3) or a founder manually verifies the entity in backoffice.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { checkInvestorDomainMatch, isAutoEligible } from '@/lib/investor-domain-match';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { catalog_entity_id } = body as { catalog_entity_id?: string };
  if (!catalog_entity_id) return NextResponse.json({ ok: false, error: 'catalog_entity_id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: entity } = await admin.from('catalog_entities').select('id, name, website').eq('id', catalog_entity_id).maybeSingle();
  if (!entity) return NextResponse.json({ ok: false, error: 'Entity not found.' }, { status: 404 });

  const verdict = checkInvestorDomainMatch({
    email, firmName: entity.name, entities: [{ id: entity.id, name: entity.name, website: entity.website }],
  });
  const domainVerified = isAutoEligible(verdict);

  const { data: member, error } = await admin.from('matchdeal_investor_members')
    .upsert({ user_id: user.id, catalog_entity_id, status: 'active', domain_verified: domainVerified }, { onConflict: 'user_id,catalog_entity_id' })
    .select('id').single();
  if (error || !member) return NextResponse.json({ ok: false, error: error?.message ?? 'Could not link.' }, { status: 500 });

  return NextResponse.json({ ok: true, membershipId: member.id, entityName: entity.name, domainVerified, verdict: verdict.kind });
}
