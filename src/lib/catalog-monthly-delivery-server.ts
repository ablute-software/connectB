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

export interface MonthlyDeliveryOrgRow {
  id: string;
  plan: string | null;
  catalog_quota: number | null;
  catalog_last_monthly_delivery: string | null;
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

  // p_limit = quota menos o que já foi entregue, nunca dentro da função de
  // scoring. NÃO é já a mesma contagem do unlockPack: desde a migração 0170,
  // unlockPack (e o trigger na BD) contam só `via_pack IS NOT NULL`, e esta
  // via insere com via_pack = null (linha ~110). Não replicar aqui o mesmo
  // `.not('via_pack','is',null)` — como estas entregas passariam a não contar
  // contra nada, a quota subiria todos os meses com o incremento enquanto o
  // consumido ficaria em ~0 e cada corrida entregaria a quota inteira em vez
  // do incremento. Manter o count total mantém o p_limit ≈ incremento, mas
  // herda o mesmo sintoma que 0170 corrigiu do outro lado: linhas que não são
  // consumo de quota (bulk-seed, notificações de interesse) ocupam quota —
  // ablute_ tem 525 linhas contra quota=40, portanto p_limit = 0 e esta via
  // não entregaria nada. Fechar isto a sério exige decidir se a entrega
  // mensal consome quota (e então marcá-la como tal, em vez de via_pack null)
  // ou se a quota É o orçamento mensal; nenhuma org tem
  // catalog_last_monthly_delivery preenchido, por isso ainda nunca correu.
  const { count: deliveredCount } = await admin
    .from('catalog_deliveries').select('catalog_id', { count: 'exact', head: true }).eq('org_id', org.id);
  const pLimit = Math.max(0, newQuota - (deliveredCount ?? 0));
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
    const id = crypto.randomUUID();
    deliveredIds.push(c.id as string);
    newEntities.push({
      id, org_id: org.id, name, type: c.type, hq_city: c.hq_city, hq_country: c.hq_country,
      invests_in_geographies: [], website: c.website, website_verified: true,
      email_domain_verified: false, stage_min: c.stage_min, stage_max: c.stage_max,
      check_min_eur: c.check_min_eur, check_max_eur: c.check_max_eur,
      sectors: c.sectors, thesis: c.thesis, fit_score: fitBucketFromScore(scoreById.get(c.id as string) ?? 0), wave: 1,
      submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
      status: 'not_contacted', source: 'catalog',
    });
  }

  if (newEntities.length) {
    const { error: insertErr } = await admin.from('entities').insert(newEntities);
    if (insertErr) return { orgId: org.id, ran: true, newQuota, delivered: 0, reason: insertErr.message };
  }
  if (deliveredIds.length) {
    await admin.from('catalog_deliveries').insert(deliveredIds.map((cid, i) => ({
      org_id: org.id, catalog_id: cid, entity_id: newEntities[i]?.id, via_pack: null,
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
