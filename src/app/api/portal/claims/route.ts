// "Claim this profile" (item, 2026-08-07 — Nuno's decision B). POST creates
// a pending investor_entity_claims row with the domain-match evidence
// snapshotted at claim time (see investor-entity-claims.ts); GET returns
// the caller's own claims. Every write is service-role — RLS on
// investor_entity_claims only ever grants the claimant SELECT on their own
// rows (see migration 0145's own comment).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { evaluateClaimDomain } from '@/lib/investor-entity-claims';
import { investorEntityClaimsAvailable } from '@/lib/investor-entity-claims-capability';
import { accountModerationAvailable } from '@/lib/account-moderation-capability';
import { pipelineTestFlagAvailable } from '@/lib/pipeline-test-flag-capability';
import { sendClaimDisputeNotice } from '@/lib/investor-entity-claim-notify';

// §3.4 — "máx. 3 claims pendentes por utilizador". The (entity, user)
// one-pending-at-a-time rule is a DB constraint (migration 0145's partial
// unique index); this is the app-level per-USER cap across all entities.
const MAX_PENDING_CLAIMS_PER_USER = 3;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  if (!(await investorEntityClaimsAvailable())) return NextResponse.json({ ok: true, claims: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: claims, error } = await admin.from('investor_entity_claims')
    .select('id, catalog_entity_id, status, domain_match, created_at, resolved_at')
    .eq('claimant_user_id', user.id).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const entityIds = [...new Set((claims ?? []).map((c) => c.catalog_entity_id as string))];
  const { data: entities } = entityIds.length
    ? await admin.from('catalog_entities').select('id, name').in('id', entityIds) : { data: [] };
  const nameById = new Map((entities ?? []).map((e) => [e.id as string, e.name as string]));

  return NextResponse.json({
    ok: true,
    claims: (claims ?? []).map((c) => ({ ...c, entityName: nameById.get(c.catalog_entity_id as string) ?? 'Unknown' })),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  if (!(await investorEntityClaimsAvailable())) return NextResponse.json({ ok: false, error: 'Claiming a profile isn\'t available yet.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  // §3.5 absolute block — an unconfirmed email can't be the proof the whole
  // domain check rests on, so the claim never even gets created.
  if (!user.email_confirmed_at || !user.email) {
    return NextResponse.json({ ok: false, error: 'Confirm your email before claiming a profile.' }, { status: 403 });
  }

  const { catalogEntityId, requestedRole } = await req.json().catch(() => ({})) as { catalogEntityId?: string; requestedRole?: string };
  if (!catalogEntityId) return NextResponse.json({ ok: false, error: 'catalogEntityId is required.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: entity, error: entityErr } = await admin.from('catalog_entities')
    .select('id, name, website, email, general_partner_emails, is_test, moderation_status')
    .eq('id', catalogEntityId).maybeSingle();
  if (entityErr) return NextResponse.json({ ok: false, error: entityErr.message }, { status: 500 });
  if (!entity) return NextResponse.json({ ok: false, error: 'This profile no longer exists.' }, { status: 404 });

  // §3.5 absolute blocks — a test/demo catalog row or a suspended/deleted
  // one can never be claimed, full stop, before anything else is checked.
  if (await pipelineTestFlagAvailable() && (entity as { is_test?: boolean }).is_test) {
    return NextResponse.json({ ok: false, error: 'This profile cannot be claimed.' }, { status: 403 });
  }
  if (await accountModerationAvailable() && (entity as { moderation_status?: string }).moderation_status
    && (entity as { moderation_status?: string }).moderation_status !== 'active') {
    return NextResponse.json({ ok: false, error: 'This profile cannot be claimed.' }, { status: 403 });
  }

  const { count: pendingCount } = await admin.from('investor_entity_claims')
    .select('id', { count: 'exact', head: true }).eq('claimant_user_id', user.id).eq('status', 'pending');
  if ((pendingCount ?? 0) >= MAX_PENDING_CLAIMS_PER_USER) {
    return NextResponse.json({ ok: false, error: 'You already have the maximum number of pending claims.' }, { status: 429 });
  }

  const { data: existingPending } = await admin.from('investor_entity_claims')
    .select('id').eq('catalog_entity_id', catalogEntityId).eq('claimant_user_id', user.id).eq('status', 'pending').maybeSingle();
  if (existingPending) return NextResponse.json({ ok: true, claimId: existingPending.id, alreadyPending: true });

  const verdict = evaluateClaimDomain({ claimantEmail: user.email, entityWebsite: entity.website as string | null, entityEmail: entity.email as string | null });

  // §3.3 — an entity already claimed and approved isn't a hard block for a
  // second claimant; it becomes a dispute, and the current owner(s) get
  // told right away (independent of whatever the backoffice later decides).
  const { data: existingApproved } = await admin.from('investor_entity_claims')
    .select('claimant_email').eq('catalog_entity_id', catalogEntityId).eq('status', 'approved');
  const isDispute = (existingApproved ?? []).length > 0;

  const evidence = {
    claimantDomain: verdict.claimantDomain, entityDomain: verdict.entityDomain,
    entityDomainIsFreemail: verdict.entityDomainIsFreemail, roleMailbox: verdict.roleMailbox,
    isDispute, disputedOwnerEmails: isDispute ? (existingApproved ?? []).map((c) => c.claimant_email) : [],
    requestedRole: requestedRole?.trim() || null,
  };

  const { data: claim, error: insertErr } = await admin.from('investor_entity_claims').insert({
    catalog_entity_id: catalogEntityId, claimant_user_id: user.id, claimant_email: user.email,
    claimant_email_domain: verdict.claimantDomain, entity_domain_at_claim: verdict.entityDomain,
    domain_match: verdict.domainMatch, requested_role: requestedRole?.trim() || null, evidence,
  }).select('id').single();
  if (insertErr) {
    // The partial unique index (one pending per entity+user) can still race
    // a concurrent request past the pre-check above — report it the same
    // way as finding it directly, not as a generic 500.
    if (insertErr.code === '23505') return NextResponse.json({ ok: true, alreadyPending: true });
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  if (isDispute) {
    const ownerEmails = [...new Set((existingApproved ?? []).map((c) => c.claimant_email as string).filter((e) => e !== user.email))];
    await sendClaimDisputeNotice({ ownerEmails, disputantEmail: user.email, entityName: entity.name as string }).catch(() => {});
  }

  return NextResponse.json({ ok: true, claimId: claim.id, domainMatch: verdict.domainMatch, isDispute });
}
