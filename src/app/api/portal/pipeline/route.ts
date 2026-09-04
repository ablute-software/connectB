// Investor Workspace Pipeline (prompt 58) — startups presented gradually by
// thesis match, in waves, mirroring the founder-side pipeline's own
// doseamento principle.
//
// Prompt 120 Block A — eligibility used to be "orgs this investor already
// has an active access_grants row for", which inverted the funnel: a grant
// belongs to diligence (the founder consenting to open the data room), not
// discovery. Eligibility became published MatchDeal startup profiles only
// (eligiblePipelineOrgIds in portal-access.ts) — the same population
// visible in the swipe deck.
//
// P132-A — that was one inversion too far: a startup that grants an
// investor real data-room access (the strongest consent signal this app
// has) could still be entirely absent from that investor's own Pipeline if
// its MatchDeal profile wasn't published — Access granted said "you have a
// relationship here", Pipeline said "this startup doesn't exist". Eligibility
// below is now pipelineEligibleOrgIds()'s union (published ∪ active grant ∪
// already-decided) — see that function and getPipelineWaves' own header for
// the full reasoning. access_grants still gates the data room itself (each
// card's hasDataRoomAccess) and still gates whether Interested/Pass can be
// recorded below — that authorization boundary hasn't moved, just which
// orgIds are allowed to reach it.
//
// AP-06..16 — Interested/Pass is now an ORG-LEVEL decision recorded in
// investor_relationship_decisions via the decide_investor_relationship()
// SQL function (migrations 0077/0078): one atomic transaction that records
// the decision AND, for a fresh 'passed', revokes every access_grants row
// held by anyone on the investor's team — so a race between two teammates
// can only ever produce one winner, and a partial failure can't leave
// "decided" with access still open. matchdeal_swipes (per-user, the
// original Prompt 58/60 mechanism) and investor_ticket_signals/
// createArchiveEntry keep being written too, additively, because the
// existing Archive tab and ticket-signal surfacing still read them
// directly — investor_relationship_decisions is the new source of truth
// for the decision itself, not a replacement for that display plumbing.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId, resolveInvestorProfile } from '@/lib/portal-access';
import { createArchiveEntry } from '@/lib/investor-archive';
import { getPipelineWaves, pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { logEvent } from '@/lib/analytics-events';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { recordInvestorDecisionFact } from '@/lib/ecosystem-facts';
import { assertNotViewer } from '@/lib/developer-viewer';
import { closedOrgGuard } from '@/lib/org-closed';
import { investorInterestNotifyAvailable } from '@/lib/investor-interest-notify-capability';

// AP-08 — free text, not the old fixed category list. Max 1000 chars,
// not blank/whitespace-only.
const REASON_MAX_LEN = 1000;
function validReason(reason: string | undefined): reason is string {
  return !!reason && reason.trim().length > 0 && reason.length <= REASON_MAX_LEN;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await getPipelineWaves(sb, admin, user.id, email);
  // Item 14 — the wave-gate was opacity-only: locked-wave card data (startup
  // names, sectors, round terms) was still sent to the browser and sitting
  // in the DOM, readable/selectable regardless of the CSS. This is the only
  // caller of getPipelineWaves that serves the browser directly (CSV
  // export, the message/startup-detail routes, all stay server-side and
  // keep the full result), so the strip happens here, not in the shared
  // lib function — a locked wave now leaves the server as a count only.
  if (result.linked) {
    // Prompt 850 §C — kind/discoveryIndex must survive the strip: they are
    // what the panel labels a locked wave with ("Wave 2 — locked until the
    // wave above is treated"). Only the card data goes.
    const waves = result.waves.map((w) => (w.unlocked
      ? w
      : { index: w.index, kind: w.kind, discoveryIndex: w.discoveryIndex, unlocked: w.unlocked, items: [], hiddenCount: w.items.length }));
    return NextResponse.json({ ...result, waves });
  }
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; action?: 'pass' | 'interest'; reason?: string };
  const { orgId, action, reason } = body;
  if (!orgId || (action !== 'pass' && action !== 'interest')) {
    return NextResponse.json({ ok: false, error: 'orgId and a valid action are required.' }, { status: 400 });
  }
  // AP-08 — required, free text, max 1000 chars, not blank/whitespace-only.
  if (action === 'pass' && !validReason(reason)) {
    return NextResponse.json({ ok: false, error: 'A reason for passing is required (max 1000 characters).' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // AP-16 — "selected" fires even for a QA session (it's a real UI event,
  // no data written); "confirmed" below only fires past the QA short-circuit,
  // matching the non-contamination principle every other portal write
  // route already follows.
  await logEvent(admin, {
    organizationId: orgId, organizationType: 'startup', eventType: `matchdeal_pipeline_${action}_selected`, sourceOfAction: 'manual',
  });

  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (!investorProfile) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  // P132-A — authorized the same union the Pipeline GET now shows
  // (published ∪ active grant ∪ already-decided), not published-only — a
  // startup that granted this investor real data-room access must be
  // decidable even if its MatchDeal profile was never published.
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(orgId)) return NextResponse.json({ ok: false, error: 'This startup is not on the matching graph yet.' }, { status: 403 });
  // Prompt 556 §C — a closed org can still be in the union above through an
  // EXISTING decision (history never disappears), so it has to be refused
  // here explicitly: there is nobody left to be interested in, or to pass on.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;

  // Prompt 196 A — this used to be a hard requirement (409 if absent), which
  // desynced from the eligibility check just above: pipelineEligibleOrgIds
  // (P132-A) already lets a startup onto the Pipeline without a published
  // MatchDeal profile (published ∪ active grant ∪ already-decided), so a
  // startup could be visible here but undecidable. The real source of truth
  // for the decision, investor_relationship_decisions (via
  // decide_investor_relationship() below), keys on org_id/
  // investor_catalog_entity_id only — confirmed in migration 0078, no
  // MatchDeal identifier anywhere in that function. The ONLY thing this
  // profile is still needed for is target_profile_id on the legacy
  // matchdeal_swipes write further down (kept only for the existing
  // Archive/ticket-signal UI, which still reads that table directly) — so
  // it's now optional, read once, and that one write skips itself when it's
  // absent instead of blocking the whole decision.
  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id')
    .eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();

  // AP-14 — the decision belongs to the ORGANIZATION, not this one user.
  // matchdeal_investor_members is per team member; catalog_entity_id is
  // the stable investor-org identity (same convention admin_org_actions
  // and matchdeal_pairings already use).
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });

  // Legacy per-user swipe — kept for the existing Archive/ticket-signal UI,
  // which still reads matchdeal_swipes directly. pass_reason stays a fixed
  // category here (the old check constraint) — the REAL free-text reason
  // lives on investor_relationship_decisions.reason_detail below, which is
  // the new source of truth for the decision itself. Prompt 196 A —
  // target_profile_id is a matchdeal_profiles id, so this write only makes
  // sense (and is now only attempted) when startupProfile exists; a
  // startup with no published MatchDeal profile just has no swipe row,
  // exactly like it already has no swipe deck card to have produced one.
  if (startupProfile) {
    await admin.from('matchdeal_swipes').upsert({
      actor_profile_id: investorProfile.id, target_profile_id: startupProfile.id,
      direction: action === 'pass' ? 'pass' : 'like',
      pass_reason: action === 'pass' ? 'other' : null,
    }, { onConflict: 'actor_profile_id,target_profile_id' });
  }

  if (action === 'interest') {
    const { ticket_min, ticket_max } = investorProfile as { ticket_min: number | null; ticket_max: number | null };
    await admin.from('investor_ticket_signals').insert({
      org_id: orgId, person_id: person?.id ?? null, investor_email: email,
      range_min_eur: ticket_min, range_max_eur: ticket_max, range_label: 'Interested via Pipeline',
    });
  } else {
    // A pass automatically archives (Prompt 60 bullet 1) — the startup
    // isn't discarded, it's deal flow the investor can reopen later with
    // full history intact. Kept even though AP-06 disables reversal for
    // the NEW decision — this just keeps the existing Archive tab working
    // for the card's UI placement; investor_relationship_decisions below
    // is what actually blocks any future reopen-and-redecide.
    await createArchiveEntry(admin, orgId, email, 'pass', reason ?? null);
  }

  // AP-09/AP-14 — the atomic core. One DB transaction: record the org's
  // decision (racing teammates can't both win), and if it's a fresh
  // 'passed', revoke every access_grants row for this org held by anyone
  // on the investor's team, in the SAME transaction — so a failure here
  // can't leave "decision recorded, access still open".
  const { data: teamRows } = await admin.from('matchdeal_investor_members').select('user_id')
    .eq('catalog_entity_id', investorCatalogEntityId).eq('status', 'active');
  const teamEmails = await Promise.all((teamRows ?? []).map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id as string);
    return data?.user?.email ?? null;
  }));
  const investorEmails = [...new Set([email, ...teamEmails.filter((e): e is string => !!e)])];

  const { data: decisionResult, error: decisionError } = await admin.rpc('decide_investor_relationship', {
    p_org_id: orgId, p_investor_catalog_entity_id: investorCatalogEntityId, p_decision: action === 'pass' ? 'passed' : 'interested',
    p_reason_detail: action === 'pass' ? reason : (reason ?? null), p_decided_by: user.id, p_investor_emails: investorEmails,
  }).single();
  if (decisionError) return NextResponse.json({ ok: false, error: decisionError.message }, { status: 500 });

  const result = decisionResult as { inserted: boolean; existing_decision: string; revoked_count: number };
  if (!result.inserted) {
    // AP-14 — lost the race, or a teammate already decided earlier.
    // Nothing was written by this call; report what's actually on record.
    await logEvent(admin, {
      organizationId: orgId, organizationType: 'startup', eventType: 'matchdeal_pipeline_decision_conflict',
      result: result.existing_decision, sourceOfAction: 'manual',
    });
    return NextResponse.json({ ok: false, error: `Already decided (${result.existing_decision}) by someone on your team.`, existingDecision: result.existing_decision }, { status: 409 });
  }

  await logEvent(admin, {
    organizationId: orgId, organizationType: 'startup', eventType: `matchdeal_pipeline_${action}_confirmed`, sourceOfAction: 'manual',
  });
  // Prompt 122 Block B (F1) §2.2 — best-effort observation of a decision
  // that already happened via the RPC above; never influences the decision
  // itself, zero touches to decide_investor_relationship.
  await recordInvestorDecisionFact(admin, { orgId, decision: action === 'pass' ? 'pass' : 'interest' });

  // Prompt 126 E — an email alone (below) isn't durable: if Resend isn't
  // configured, or the founder misses it, "expressed interest" never
  // actually lands anywhere inside their own workspace. Best-effort, same
  // posture as the email block — a failure here never un-does the decision
  // that already committed above via decide_investor_relationship.
  if (action === 'interest' && await investorInterestNotifyAvailable()) {
    // Bug fix (2026-08-06) — supabase-js's rpc() never throws; it always
    // resolves to { data, error }. The old bare try/catch never actually
    // caught anything because there was nothing to catch — every failure
    // of this RPC (e.g. the entities_has_identity_evidence violation fixed
    // in migration 0127/0129) resolved silently, `.error` unread, with
    // zero trace anywhere. Still best-effort (a failure here never undoes
    // the decision itself, already recorded above) — just no longer mute.
    const { error: notifyError } = await admin.rpc('matchdeal_record_interest_notification', {
      p_org_id: orgId, p_catalog_id: investorCatalogEntityId, p_reason_detail: reason ?? null,
      // Prompt 555 — WHICH member acted. Their profile wins field by field in
      // matchdeal_investor_firm_view; the firm's other active members only
      // fill the gaps. Without it the projection falls back to
      // most-recently-updated, which for a two-member firm can hand the
      // founder a half-filled profile over a complete one.
      p_investor_profile_id: investorProfile.id,
    });
    if (notifyError) console.error('matchdeal_record_interest_notification failed', notifyError);
  }

  if (action === 'pass') {
    await logEvent(admin, {
      organizationId: orgId, organizationType: 'startup', eventType: 'matchdeal_pipeline_access_revoked',
      result: String(result.revoked_count), sourceOfAction: 'automatic',
    });
  }

  // AP-07/AP-11/AP-12 — notify the founder. Best-effort, same pattern as
  // every other portal write route (soft-commit, questions) — a failed
  // send never un-does the decision or the revocation that already
  // committed above.
  let notifyFailed = false;
  if (resendConfigured) {
    const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', orgId).single();
    const to = (org?.sender_email as string | null) ?? null;
    if (to) {
      const heading = action === 'interest' ? 'An investor is interested' : 'An investor has passed';
      const body = action === 'interest'
        ? `An investor on your Pipeline confirmed interest in ${org?.name ?? 'your startup'}.`
        : `An investor on your Pipeline has passed on ${org?.name ?? 'your startup'}.${reason ? `\n\nReason: ${reason}` : ''}`;
      try {
        await sendTransactionalEmail({
          to, subject: heading,
          html: transactionalTemplate({ heading, body, ctaLabel: 'Review in your workspace', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/pipeline` }),
          context: { orgId, kind: 'other' },
        });
      } catch {
        notifyFailed = true;
      }
    }
  }
  await admin.from('investor_relationship_decisions')
    .update({ notified_at: notifyFailed ? null : new Date().toISOString(), notify_failed: notifyFailed })
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId);
  await logEvent(admin, {
    organizationId: orgId, organizationType: 'startup',
    eventType: notifyFailed ? 'matchdeal_pipeline_notify_failed' : 'matchdeal_pipeline_startup_notified', sourceOfAction: 'automatic',
  });

  return NextResponse.json({ ok: true, revokedCount: result.revoked_count });
}
