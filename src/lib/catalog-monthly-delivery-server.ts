// Prompt 179 §B — server-side counterpart of unlockPack() (store-supabase.tsx).
// unlockPack runs client-side under the founder's own session (RLS-scoped to
// their org); this runs from the daily /api/automations cron, with the
// service-role client, across every org whose monthly delivery is due
// (catalog-monthly-delivery.ts's monthlyDeliveryDue). Deliberately mirrors
// unlockPack's own mechanism (catalog_top_matches -> entities +
// catalog_deliveries -> enqueue enrichment) rather than a second, divergent
// implementation — see catalog-fit-bucket.ts for the shared scoring bucket.
//
// One thing this does NOT do that unlockPack does: write to
// packs/pack_unlocks. Those track the old, now-inert curated-pack model
// (Prompt 139's own header: "packs/pack_items ficam na base, inertes, para
// rollback facil") — a monthly quota bump isn't "unlocking a pack", there's
// no packId for it to reference, and nothing reads pack_unlocks for
// anything catalog-quota-related today (confirmed: only unlockPack itself
// writes it, purely for its own dedupe-by-packId guard, which doesn't apply
// here). catalog_deliveries is the real, current record of what was
// delivered and why — that's what this writes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fitBucketFromScore } from './catalog-fit-bucket';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from './pipeline-unlock';
import { normalizePlan } from './plans';
import { monthlyDeliveryStamp } from './catalog-monthly-delivery';
import { preferDeclaredList, preferDeclaredValue, resolveClaimedInvestorProfile } from './claimed-investor-profile';

export interface MonthlyDeliveryOrgRow {
  id: string;
  plan: string | null;
  catalog_quota: number | null;
  catalog_last_monthly_delivery: string | null;
  is_test?: boolean | null;
}

export interface MonthlyDeliveryResult {
  orgId: string;
  ran: boolean;
  newQuota?: number;
  delivered?: number;
  reason?: string;
}

export async function deliverMonthlyForOrg(
  admin: SupabaseClient, org: MonthlyDeliveryOrgRow, nowIso: string,
): Promise<MonthlyDeliveryResult> {
  // Prompt 201 §2 — orgs de teste saem aqui, antes de tudo: sem crescer
  // quota, sem entregar, sem enfileirar enriquecimento. O guarda vive na
  // função e não só no filtro do route.ts de propósito — nenhum chamador
  // futuro pode contorná-lo por esquecimento. A 2026-08-15 isto exclui 8 das
  // 11 orgs em produção (as 5 "(demo)", Sherlock Deal_ test, Test & trial e
  // Caramel Biscuit, todas já com is_test=true), ou seja 234 das 260
  // entidades que a primeira corrida entregaria — e o custo de AI todo que
  // vinha atrás delas, já que as 265 entidades elegíveis do catálogo estão
  // em enrichment_status='pending' e cada entrega enfileira mesmo um job.
  if (org.is_test) return { orgId: org.id, ran: false, reason: 'org de teste (is_test)' };

  const tier = normalizePlan(org.plan);
  const increment = PLAN_PIPELINE_MONTHLY_ADDITION[tier];
  const currentQuota = org.catalog_quota ?? 0;
  const newQuota = currentQuota + increment;
  const stamp = monthlyDeliveryStamp(nowIso);

  // Atomic idempotency guard, in addition to the caller's own
  // monthlyDeliveryDue() pre-filter: only proceeds if the row's marker
  // ISN'T already this month's stamp — covers both "never run" (null) and
  // "ran for an earlier month". If a concurrent/retried invocation already
  // claimed this org's stamp for this month, this UPDATE matches zero rows
  // and .select().maybeSingle() returns null, so this run backs off cleanly
  // instead of double-crediting the quota.
  const { data: updated, error: updateErr } = await admin
    .from('orgs')
    .update({ catalog_quota: newQuota, catalog_last_monthly_delivery: stamp })
    .eq('id', org.id)
    .or(`catalog_last_monthly_delivery.is.null,catalog_last_monthly_delivery.neq.${stamp}`)
    .select('id')
    .maybeSingle();
  if (updateErr) return { orgId: org.id, ran: false, reason: updateErr.message };
  if (!updated) return { orgId: org.id, ran: false, reason: 'already ran for this org this month (race)' };

  // Mesma derivação de p_limit que unlockPack — quota menos o que já foi
  // entregue e conta para quota — nunca dentro da própria função de scoring.
  // Decisão do Prompt 199 (migração 0171): a quota é o orçamento de
  // investidores introduzidos ao founder, e esta entrega mensal consome-o
  // tal como um unlock manual. Por isso o filtro é `quota_exempt = false`, e
  // não `via_pack` — esta via não tem pack nenhum (insere via_pack null,
  // linha ~110), portanto filtrar por via_pack isentava-a por acidente e
  // cada corrida entregaria a quota inteira em vez do incremento. Sem
  // filtro nenhum era o sintoma inverso: as 524 linhas isentas de ablute_
  // (bulk-seed de 2026-07-27 + notificações de interesse) contra quota=40
  // davam p_limit = 0 e esta via nunca entregava nada.
  const { count: deliveredCount } = await admin
    .from('catalog_deliveries').select('catalog_id', { count: 'exact', head: true }).eq('org_id', org.id).eq('quota_exempt', false);
  // Prompt 201 §1 — o tecto é o incremento do plano, nunca o buraco todo
  // entre a quota e o consumido. `newQuota - deliveredCount` só seria uma
  // "entrega mensal" se a quota tivesse andado sempre colada ao consumo; na
  // prática foi inflacionada por testes e backfills durante semanas, portanto
  // a primeira corrida virava um despejo de atraso acumulado em vez de um
  // mês. A quota continua a crescer na mesma (newQuota não muda) — o que
  // fica preso é quanto sai por corrida.
  const pLimit = Math.max(0, Math.min(increment, newQuota - (deliveredCount ?? 0)));
  if (pLimit === 0) return { orgId: org.id, ran: true, newQuota, delivered: 0 };

  const { data: matches, error: matchErr } = await admin.rpc('catalog_top_matches', { p_org_id: org.id, p_limit: pLimit });
  if (matchErr || !matches?.length) return { orgId: org.id, ran: true, newQuota, delivered: 0, reason: matchErr?.message };

  const scored = matches as { catalog_id: string; score: number }[];
  const catalogIds = scored.map((m) => m.catalog_id);
  const [{ data: catalogRows }, { data: ownedRows }] = await Promise.all([
    admin.from('catalog_entities').select('*').in('id', catalogIds),
    admin.from('entities').select('name').eq('org_id', org.id),
  ]);
  const scoreById = new Map(scored.map((m) => [m.catalog_id, m.score]));
  const ownedNames = new Set((ownedRows ?? []).map((r) => (r.name as string).toLowerCase()));

  const newEntities: Record<string, unknown>[] = [];
  const deliveredIds: string[] = [];
  for (const c of (catalogRows ?? []) as Record<string, unknown>[]) {
    const name = c.name as string;
    if (ownedNames.has(name.toLowerCase())) continue;
    // Prompt 285 §3 — a suspended/deleted catalog entity (manual checkbox
    // or the cross-org threshold, moderation-actions.ts) must not reach a
    // new org's pipeline. Confirmed by grep before this prompt: this
    // column was read nowhere in this file.
    const moderationStatus = c.moderation_status as string | null | undefined;
    if (moderationStatus && moderationStatus !== 'active') continue;
    const id = crypto.randomUUID();
    deliveredIds.push(c.id as string);
    // Prompt 407 §A/§B.1 — a claimed, complete investor profile's own
    // declared fields take precedence over researched catalog data, field
    // by field, at this exact copy-into-entities point (the one place
    // this data ever gets written into the founder's own CRM — confirmed
    // by tracing every reader of db.entities before this change).
    // Excludes stage_min/stage_max on purpose: matchdeal_profiles.stages_invested
    // is an unordered list over a DIFFERENT stage vocabulary than
    // entities.stage_min/max's pair (src/lib/types.ts's Stage type has 5
    // values; the DB `stage` enum has 7, in non-monotonic creation order)
    // — no established, confident conversion between the two exists
    // anywhere in this codebase, and guessing one risks showing a founder
    // an invented stage range instead of the already-correct researched
    // one. Flagged in the report, not solved here.
    const claimed = await resolveClaimedInvestorProfile(admin, c.id as string);
    newEntities.push({
      id, org_id: org.id, name, type: c.type, hq_city: c.hq_city, hq_country: c.hq_country,
      invests_in_geographies: preferDeclaredList(claimed?.geographies, c.geographies as string[] | null),
      website: preferDeclaredValue(claimed?.website ?? null, c.website as string | null), website_verified: true,
      email_domain_verified: false, stage_min: c.stage_min, stage_max: c.stage_max,
      check_min_eur: preferDeclaredValue(claimed?.ticketMinEur ?? null, c.check_min_eur as number | null),
      check_max_eur: preferDeclaredValue(claimed?.ticketMaxEur ?? null, c.check_max_eur as number | null),
      sectors: preferDeclaredList(claimed?.sectors, c.sectors as string[] | null),
      thesis: preferDeclaredValue(claimed?.description ?? null, c.thesis as string | null),
      fit_score: fitBucketFromScore(scoreById.get(c.id as string) ?? 0), wave: 1,
      submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
      status: 'not_contacted', source: 'catalog',
      // Prompt 407 §B.4 — provenance snapshot for this one delivery event;
      // migration 0257. See that migration's own comment for why this is
      // point-in-time rather than a live claim-status flag.
      claimed_profile_at_delivery: !!claimed,
    });
  }

  if (newEntities.length) {
    const { error: insertErr } = await admin.from('entities').insert(newEntities);
    if (insertErr) return { orgId: org.id, ran: true, newQuota, delivered: 0, reason: insertErr.message };
  }
  if (deliveredIds.length) {
    // quota_exempt: false é o default da coluna (0171), explícito aqui de
    // propósito — é o call site que documenta a decisão de que a entrega
    // mensal consome quota. via_pack fica null porque não veio de pack
    // nenhum, o que já não tem nada a ver com quota.
    await admin.from('catalog_deliveries').insert(deliveredIds.map((cid, i) => ({
      org_id: org.id, catalog_id: cid, entity_id: newEntities[i]?.id, via_pack: null, quota_exempt: false,
    })));
    await enqueueEnrichment(admin, org.id, deliveredIds);
  }

  return { orgId: org.id, ran: true, newQuota, delivered: newEntities.length };
}

// Same due-check + dedupe-insert as /api/pipeline/enqueue-enrichment, minus
// the HTTP round trip and the user-session requirement — this already runs
// with the service-role client, server-to-server, no founder session exists
// in a cron invocation.
async function enqueueEnrichment(admin: SupabaseClient, orgId: string, catalogIds: string[]): Promise<void> {
  const { data: catalogRows } = await admin
    .from('catalog_entities').select('id, enrichment_status, enrichment_stale_after').in('id', catalogIds);
  const now = new Date();
  const due = (catalogRows ?? []).filter((c) => {
    if (c.enrichment_status === 'pending') return true;
    return !!c.enrichment_stale_after && new Date(c.enrichment_stale_after as string) < now;
  });
  for (const c of due) {
    const { data: active } = await admin.from('enrichment_jobs').select('id')
      .eq('target_type', 'entity').eq('target_id', c.id).eq('layer', 1)
      .in('status', ['queued', 'running']).maybeSingle();
    if (active) continue;
    const { error } = await admin.from('enrichment_jobs').insert({
      target_type: 'entity', target_id: c.id, layer: 1, priority: 150, requested_by_org_id: orgId,
    });
    if (error && error.code !== '23505') console.error('[catalog-monthly-delivery] enqueue-enrichment failed', c.id, error.message);
  }
}
