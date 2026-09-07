// Prompt 576 Fase 2 §7 — one format for every health signal, computed once
// so both /api/backoffice/system-status (the unified list) and Attention
// (which surfaces only the non-ok ones) read the exact same checks.
//
// Email delivery and Gap engine already had a real yes/no elsewhere in this
// codebase (queue/summary's old systemNominal proxy, gap-engine-health) —
// this cites those same sources, never a second definition. AI costs is the
// one signal with no existing yes/no anywhere; the comment on
// AI_COST_SPIKE_THRESHOLD below states its exact definition in one sentence,
// on purpose, so the number on screen and the number in this comment can
// never quietly drift apart.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { repeatedQuestionCount } from './gap-engine-health';
import { checkVirusTotalKeyHealth } from './upload-security';

export interface SystemSignal {
  key: string; name: string;
  /** true = nominal, false = needs a look, null = no signal to judge by yet — never treated as either. */
  ok: boolean | null;
  detail: string;
  checkedAt: string;
}

// AI costs' definition, verbatim, cited by both this comment and the detail
// string it produces: THIS MONTH's spend so far (day 1 through today) is
// compared against LAST MONTH's spend over the SAME day range (day 1
// through the same day-of-month) — never the whole prior month, which would
// bias every reading before month-end toward "under budget". ok=false when
// the ratio is >= this threshold. No comparison is drawn — ok=null, "no
// baseline yet" — when ai_call_log has no row older than the start of that
// comparison window; a table that did not exist yet is not evidence of zero
// spend.
export const AI_COST_SPIKE_THRESHOLD = 2;

async function emailDeliverySignal(admin: SupabaseClient): Promise<SystemSignal> {
  const checkedAt = new Date().toISOString();
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ count: total }, { count: failures }] = await Promise.all([
    admin.from('email_send_log').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
    admin.from('email_send_log').select('id', { count: 'exact', head: true }).in('status', ['failed', 'render_failed']).gte('created_at', since24h),
  ]);
  return {
    key: 'email', name: 'Email delivery', ok: (failures ?? 0) === 0,
    detail: `${failures ?? 0} failures / ${total ?? 0} sent, 24h`, checkedAt,
  };
}

async function gapEngineSignal(admin: SupabaseClient): Promise<SystemSignal> {
  const checkedAt = new Date().toISOString();
  const repeated = await repeatedQuestionCount(admin);
  if (repeated === null) {
    return { key: 'gap_engine', name: 'Gap engine', ok: null, detail: 'Not available yet', checkedAt };
  }
  return {
    key: 'gap_engine', name: 'Gap engine', ok: repeated === 0,
    detail: `${repeated} repeated question(s) — must be 0, DB-enforced`, checkedAt,
  };
}

async function aiCostsSignal(admin: SupabaseClient): Promise<SystemSignal> {
  const checkedAt = new Date().toISOString();
  const now = new Date();
  const dom = now.getDate();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthSameDayEnd = new Date(now.getFullYear(), now.getMonth() - 1, dom + 1);

  const [{ data: earliest }, { data: thisMonthRows }, { data: lastMonthRows }] = await Promise.all([
    admin.from('ai_call_log').select('created_at').order('created_at', { ascending: true }).limit(1),
    admin.from('ai_call_log').select('cost_eur').gte('created_at', thisMonthStart.toISOString()),
    admin.from('ai_call_log').select('cost_eur').gte('created_at', lastMonthStart.toISOString()).lt('created_at', lastMonthSameDayEnd.toISOString()),
  ]);

  const earliestAt = earliest?.[0]?.created_at ? new Date(earliest[0].created_at as string) : null;
  if (!earliestAt || earliestAt >= lastMonthStart) {
    return { key: 'ai_costs', name: 'AI costs', ok: null, detail: 'No baseline yet — not enough history to compare a prior month', checkedAt };
  }

  const thisMonthTotal = (thisMonthRows ?? []).reduce((s, r) => s + ((r.cost_eur as number) ?? 0), 0);
  const lastMonthTotal = (lastMonthRows ?? []).reduce((s, r) => s + ((r.cost_eur as number) ?? 0), 0);

  if (lastMonthTotal === 0) {
    if (thisMonthTotal === 0) {
      return { key: 'ai_costs', name: 'AI costs', ok: true, detail: 'No AI spend recorded this month or last month at this point', checkedAt };
    }
    return {
      key: 'ai_costs', name: 'AI costs', ok: false,
      detail: `This month has €${thisMonthTotal.toFixed(2)} of spend where last month had none at the same point — no ratio to compare`,
      checkedAt,
    };
  }

  const ratio = thisMonthTotal / lastMonthTotal;
  return {
    key: 'ai_costs', name: 'AI costs', ok: ratio < AI_COST_SPIKE_THRESHOLD,
    detail: `This month is at ${ratio.toFixed(1)}× last month's total at the same day (threshold ${AI_COST_SPIKE_THRESHOLD}×) — €${thisMonthTotal.toFixed(2)} vs €${lastMonthTotal.toFixed(2)}`,
    checkedAt,
  };
}

async function scanHealthSignal(): Promise<SystemSignal> {
  const checkedAt = new Date().toISOString();
  const health = await checkVirusTotalKeyHealth();
  return { key: 'scan_health', name: 'Scan health', ok: health.ok, detail: health.detail, checkedAt };
}

export async function getSystemSignals(admin: SupabaseClient): Promise<SystemSignal[]> {
  return Promise.all([
    emailDeliverySignal(admin),
    gapEngineSignal(admin),
    aiCostsSignal(admin),
    scanHealthSignal(),
  ]);
}
