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
import { deliverCatalogMatches } from './catalog-delivery-core';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from './pipeline-unlock';
import { normalizePlan } from './plans';
import { monthlyDeliveryStamp } from './catalog-monthly-delivery';

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

  // Prompt 536 §2 — the match/insert/enqueue body that used to live here
  // now lives in catalog-delivery-core.ts, shared with the founder-triggered
  // /api/pipeline-unlock/deliver route. Behaviour here is unchanged: the
  // cron already awaited its inserts in order, which is why the monthly path
  // never lost a catalog_deliveries row (Estojo 13/13, "New company" 10/10 in
  // production) while the parallel client-side unlockPack did (Krohnsty 3/0).
  // Sharing it is what stops that difference from existing at all.
  const { delivered, error: deliveryErr } = await deliverCatalogMatches(admin, org.id, pLimit, null);
  if (deliveryErr) return { orgId: org.id, ran: true, newQuota, delivered, reason: deliveryErr };
  return { orgId: org.id, ran: true, newQuota, delivered };
}
