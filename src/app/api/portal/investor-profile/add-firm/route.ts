// Identity verification Fase A (prompt 63), Bloco 1 — "My firm isn't
// listed." Creates a new catalog_entities row (verification_status
// 'pending' — the existing enum/RLS axis already keeps non-verified rows
// out of founder catalog reads and packs, see 0002_catalog.sql; no new
// status needed), links the investor to it immediately so onboarding
// continues (never a dead end), and records who proposed it for backoffice
// review. If the investor's email domain happens to match the website they
// gave, domain_verified is set true right away — no reason to make them
// wait on admin review when the same evidence link/route.ts already trusts
// is present.
//
// Prompt 573 §D — before any of that: search the catalog for this name/
// website FIRST. This route used to create a new firm unconditionally,
// which is how the same real fund ends up in the catalog twice — once as
// someone's verified entry, once as a stranger's still-pending duplicate.
// A probable match blocks the create and files an investor_entity_claims
// row against the EXISTING entity instead (the same table/flow
// /api/portal/claims already uses for "claim this profile"), so the
// investor still lands somewhere real rather than at a dead end. Gated on
// investorEntityClaimsAvailable() — if that table isn't there yet, this
// falls back to the old unconditional-create behavior rather than erroring.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { checkInvestorDomainMatch, isAutoEligible } from '@/lib/investor-domain-match';
import { assertNotViewer } from '@/lib/developer-viewer';
import { findCatalogMatch } from '@/lib/catalog-dedupe';
import { evaluateClaimDomain } from '@/lib/investor-entity-claims';
import { investorEntityClaimsAvailable } from '@/lib/investor-entity-claims-capability';

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

  const body = await req.json().catch(() => ({})) as { name?: string; website?: string };
  const name = body.name?.trim();
  const website = body.website?.trim() || null;
  if (!name) return NextResponse.json({ ok: false, error: 'Firm name is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (await investorEntityClaimsAvailable()) {
    const [{ data: catalog }, { data: aliases }] = await Promise.all([
      admin.from('catalog_entities').select('id, name, website'),
      admin.from('entity_aliases').select('catalog_id, alias'),
    ]);
    const match = findCatalogMatch({ name, website }, catalog ?? [], (aliases ?? []).map((a) => ({ catalog_id: a.catalog_id as string, alias: a.alias as string })));

    if (match) {
      const { data: matchedEntity } = await admin.from('catalog_entities').select('id, name, website, email').eq('id', match.id).single();
      if (matchedEntity) {
        const { count: pendingCount } = await admin.from('investor_entity_claims')
          .select('id', { count: 'exact', head: true }).eq('claimant_user_id', user.id).eq('status', 'pending');
        // Same 3-pending cap /api/portal/claims enforces — this route is a
        // second door into the same table, not an exemption from its rules.
        if ((pendingCount ?? 0) >= 3) {
          return NextResponse.json({ ok: false, error: 'You already have the maximum number of pending claims.' }, { status: 429 });
        }
        const { data: existingPending } = await admin.from('investor_entity_claims')
          .select('id').eq('catalog_entity_id', match.id).eq('claimant_user_id', user.id).eq('status', 'pending').maybeSingle();
        if (existingPending) {
          return NextResponse.json({ ok: true, matchedExisting: true, entityName: matchedEntity.name, claimId: existingPending.id, alreadyPending: true });
        }

        const verdict = evaluateClaimDomain({ claimantEmail: email, entityWebsite: matchedEntity.website as string | null, entityEmail: matchedEntity.email as string | null });
        const { data: claim, error: claimErr } = await admin.from('investor_entity_claims').insert({
          catalog_entity_id: match.id, claimant_user_id: user.id, claimant_email: email,
          claimant_email_domain: verdict.claimantDomain, entity_domain_at_claim: verdict.entityDomain,
          domain_match: verdict.domainMatch,
        }).select('id').single();
        if (claimErr) return NextResponse.json({ ok: false, error: claimErr.message }, { status: 500 });

        return NextResponse.json({
          ok: true, matchedExisting: true, entityName: matchedEntity.name, claimId: claim.id,
          matchReason: match.reason, domainMatch: verdict.domainMatch,
        });
      }
    }
  }

  const { data: entity, error: entityError } = await admin.from('catalog_entities')
    .insert({ name, website, type: 'vc', verification_status: 'pending', source: 'investor_added', catalog_status: 'imported' })
    .select('id, name, website').single();
  if (entityError || !entity) return NextResponse.json({ ok: false, error: entityError?.message ?? 'Could not create entity.' }, { status: 500 });

  await admin.from('investor_added_entities').insert({ catalog_entity_id: entity.id, added_by_user_id: user.id, added_by_email: email });

  const verdict = website
    ? checkInvestorDomainMatch({ email, firmName: entity.name, entities: [{ id: entity.id, name: entity.name, website: entity.website }] })
    : null;
  const domainVerified = verdict ? isAutoEligible(verdict) : false;

  const { data: member, error: memberError } = await admin.from('matchdeal_investor_members')
    .upsert({ user_id: user.id, catalog_entity_id: entity.id, status: 'active', domain_verified: domainVerified, verification_method: domainVerified ? 'domain' : 'none' }, { onConflict: 'user_id,catalog_entity_id' })
    .select('id').single();
  if (memberError || !member) return NextResponse.json({ ok: false, error: memberError?.message ?? 'Could not link.' }, { status: 500 });

  return NextResponse.json({ ok: true, membershipId: member.id, entityName: entity.name, domainVerified });
}
