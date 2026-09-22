// Prompt 348 §B/§C/§E — the investor's own "Watching" list: delta against
// each watch's baseline snapshot, mechanical threshold alerts, and the two
// private orderings (closest to my criteria / most changed). Nothing here
// ever reaches the founder — this whole response is investor-private.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId, resolveInvestorProfile } from '@/lib/portal-access';
import { getActiveWatchesForInvestor, getSnapshotData } from '@/lib/investor-watching-db';
import { readSnapshotData } from '@/lib/startup-snapshot';
import { computeSnapshotDelta, deltaMagnitude, sortWatchItems, type WatchSort } from '@/lib/investor-watching';
import { computeMatchScore, type InvestorThesis, type StartupRound } from '@/lib/investor-match-score';
import { conditionKindLabel, detectConditionFulfillment, reapresentationMessage, type ConditionKind } from '@/lib/reevaluation-conditions';
import { reevaluationAlertsAvailable } from '@/lib/reevaluation-capability';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ items: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (!investorCatalogEntityId || !investorProfile) return NextResponse.json({ items: [] });

  const watches = await getActiveWatchesForInvestor(admin, investorCatalogEntityId);
  if (watches.length === 0) return NextResponse.json({ items: [] });

  const thesis: InvestorThesis = {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
    exclusionsSectors: investorProfile.exclusions_sectors, exclusionsNotes: investorProfile.exclusions_notes,
  };

  const sortParam = new URL(req.url).searchParams.get('sort');
  const sort: WatchSort = sortParam === 'most_changed' ? 'most_changed' : 'closest_to_criteria';

  const items = await Promise.all(watches.map(async (watch) => {
    const [{ data: org }, current] = await Promise.all([
      admin.from('orgs').select('id, name, one_liner, sectors, stage, country, round_target_eur, round_min_ticket_eur, round_instruments').eq('id', watch.org_id).single(),
      readSnapshotData(admin, watch.org_id),
    ]);
    const round: StartupRound = {
      sectors: org?.sectors ?? [], stage: org?.stage ?? null, country: org?.country ?? null,
      roundTargetEur: org?.round_target_eur ?? null, roundMinTicketEur: org?.round_min_ticket_eur ?? null,
      roundInstruments: org?.round_instruments ?? [],
    };
    const { score: matchScore } = computeMatchScore(thesis, round);

    const baseline = watch.baseline_snapshot_id ? await getSnapshotData(admin, watch.baseline_snapshot_id) : null;
    const changedFields = baseline ? computeSnapshotDelta(baseline, current) : [];

    // §C — class 1/2 traction evidence accepted since the investor's last
    // visit. Simplification, documented: gated on the claim being
    // 'accepted' (founder-confirmed) rather than per-document access —
    // never exceeds what the Overview's own traction section already shows
    // this investor at their current disclosure level (level >= 1), so it
    // can't leak anything the dossier itself wouldn't.
    const since = watch.last_seen_at ?? watch.requested_at;
    const { data: newClaims } = await admin.from('company_claims').select('statement, evidence_class')
      .eq('org_id', watch.org_id).eq('status', 'accepted').in('evidence_class', [1, 2]).gt('updated_at', since);
    const newClass1 = (newClaims ?? []).filter((c) => c.evidence_class === 1);
    const newClass2 = (newClaims ?? []).filter((c) => c.evidence_class === 2);

    // Roadmap has no explicit "completed" flag in this schema — approximated
    // as "a milestone changed since last visit" (documented simplification).
    const { data: newRoadmap } = await admin.from('company_roadmap_milestones').select('id')
      .eq('org_id', watch.org_id).gt('updated_at', since);

    const deltaScore = deltaMagnitude({
      changedFieldsCount: changedFields.length, newClass1Count: newClass1.length,
      newClass2Count: newClass2.length, newRoadmapCount: (newRoadmap ?? []).length,
    });

    return {
      watchId: watch.id, orgId: watch.org_id, orgName: org?.name ?? 'A startup', oneLiner: org?.one_liner ?? null,
      matchScore, deltaScore, changedFields, newClass1Statements: newClass1.map((c) => c.statement),
      newClass2Statements: newClass2.map((c) => c.statement), newRoadmapCount: (newRoadmap ?? []).length,
      lastSeenAt: watch.last_seen_at,
    };
  }));

  // §C — match-score-above threshold, evaluated here (lazy, at read time —
  // no cron, matching this codebase's existing "no sub-daily schedule"
  // Hobby-plan constraint and the reawakening engine's own on-demand
  // posture). A fresh crossing is recorded once as an alert; re-reading the
  // list never re-fires it (matchScoreCrossedThreshold needs a PRIOR score,
  // which the investor_watch_thresholds row doesn't track today — so this
  // records the alert the first time the CURRENT score is found above the
  // threshold and no alert of this kind exists yet for this watch, rather
  // than a true crossing-edge detection; flagged as a simplification).
  await Promise.all(items.map(async (item) => {
    const { data: thresholds } = await admin.from('investor_watch_thresholds').select('id, kind, threshold_value')
      .eq('watch_id', item.watchId).eq('kind', 'match_score_above');
    for (const t of thresholds ?? []) {
      const value = t.threshold_value as number;
      if (item.matchScore <= value) continue;
      const { data: existingAlert } = await admin.from('investor_watch_alerts').select('id')
        .eq('watch_id', item.watchId).eq('kind', 'match_score_above').gte('created_at', item.lastSeenAt ?? '1970-01-01').limit(1);
      if (existingAlert && existingAlert.length > 0) continue;
      await admin.from('investor_watch_alerts').insert({
        watch_id: item.watchId, kind: 'match_score_above',
        fact_text: `Match score for ${item.orgName} rose above ${value}% (now ${item.matchScore}%).`,
      });
    }
  }));

  // Prompt 716 Pedido B — extends this SAME lazy, on-read alert mechanism
  // (never a second one, never a cron) with the reevaluation-condition
  // kinds. Gated by reevaluationAlertsAvailable() — the capability probe
  // that only turns on once Prompt 715's schema is actually in production
  // (Pedido 716 §8's own explicit feature-flag instruction). Each
  // condition fires at most once (fulfilled_at is only ever set once,
  // checked here before writing); definitive_pass rows are never even
  // selected.
  if (await reevaluationAlertsAvailable()) {
    await Promise.all(items.map(async (item) => {
      const watch = watches.find((w) => w.id === item.watchId);
      if (!watch) return;
      const { data: conditions } = await admin.from('investor_reevaluation_conditions')
        .select('id, condition_kind, obstacle, decided_at').eq('watch_id', item.watchId).is('fulfilled_at', null).eq('definitive_pass', false);
      for (const condition of conditions ?? []) {
        const kind = condition.condition_kind as ConditionKind;
        const fulfillment = await detectConditionFulfillment(admin, watch.org_id, kind, condition.decided_at as string);
        if (!fulfillment) continue;
        const now = new Date().toISOString();
        // Guard against a race between two concurrent reads: only the
        // update that actually flips fulfilled_at (still null) proceeds to
        // write the alert — a second concurrent call sees rowCount 0 and
        // stops, so the same condition can never fire twice.
        const { data: updated } = await admin.from('investor_reevaluation_conditions')
          .update({ fulfilled_at: now, fulfilled_fact_text: fulfillment.factText })
          .eq('id', condition.id as string).is('fulfilled_at', null).select('id');
        if (!updated || updated.length === 0) continue;
        await admin.from('investor_watch_alerts').insert({
          watch_id: item.watchId, kind, condition_id: condition.id,
          fact_text: reapresentationMessage(conditionKindLabel(kind), fulfillment.factText, now),
        });
      }
    }));
  }

  return NextResponse.json({ items: sortWatchItems(items, sort), sort });
}
