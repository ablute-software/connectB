// Automation engine tick — production entry point (Vercel cron).
// vercel.json schedules: { "crons": [{ "path": "/api/automations", "schedule": "0 9 * * *" }] }
// (Vercel Hobby plan allows only 1x/day — this fires daily but the
// automation-rules tick below and the monthly catalog delivery job each
// decide independently whether there's anything to actually do today.)
//
// In demo mode the automation-rules tick runs client-side (store.runAutomationTick).
// Prompt 498 — server-side rule evaluation (src/lib/rules.ts) IS now wired to
// this route: runAutomationRulesSweep, at the bottom, feeds live per-org data
// to the same pure functions and turns what they return into real founder
// tasks. It never sends anything: tasks only, draft-review by construction.
//
// Prompt 179 §B — this route now ALSO runs the monthly catalog-quota-growth
// job (previously entirely unbuilt — see plans.ts's own "not yet built"
// comment on PLAN_PIPELINE_MONTHLY_ADDITION). Piggybacked here rather than a
// second cron entry specifically because of the Hobby-plan 1x/day cron
// limit named in the prompt.
//
// Prompt 161 §C.2 — also runs the Pioneer badge-grant sweep. Unlike the
// monthly catalog job, no day-of-month gate: a Pioneer redemption's
// benefit_ends_at can fall on any day, and runPioneerExpiryJob is cheap and
// idempotent (skips orgs already badged), so it just runs every tick.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { monthlyDeliveryDue } from '@/lib/catalog-monthly-delivery';
import { catalogMonthlyDeliveryAvailable } from '@/lib/catalog-monthly-delivery-capability';
import { deliverMonthlyForOrg, type MonthlyDeliveryOrgRow, type MonthlyDeliveryResult } from '@/lib/catalog-monthly-delivery-server';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';
import { runPioneerExpiryJob } from '@/lib/pioneer-server';
import { computeAndStoreOverviewSnapshot } from '@/lib/metrics-snapshot';
import { recheckPendingMalwareScans, retroscanNotScannedDocuments, recheckPendingScansGeneric, recheckMatchdealPhotoScans } from '@/lib/upload-security';
import { runInterestReminderSweep, type InterestReminderSweepResult } from '@/lib/interest-reminder-sweep';
import {
  malwareScanAvailable, investorVerificationScanAvailable, ndaScanAvailable,
  matchdealPhotoScanAvailable, supportAttachmentScanAvailable, companyMediaScanAvailable,
} from '@/lib/upload-security-capability';
import { gapReconciliationsAvailable } from '@/lib/document-extraction-capability';
import { runReconciliationForOrg } from '@/lib/reconciliation';
import { automationRulesSweepAvailable } from '@/lib/automation-rules-capability';
import { runAutomationRulesSweep, type AutomationRulesSweepResult } from '@/lib/automation-rules-tick-server';

// Prompt 201 §3 — limiar de sinal, não de aborto.
const MONTHLY_DELIVERY_ALERT_THRESHOLD = 100;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    return NextResponse.json({
      ok: false,
      message: 'Database not configured — engine runs in demo mode (client-side tick from the Outbox page).',
    });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  let monthlyDelivery: { ranFor: number; results: MonthlyDeliveryResult[]; totalDelivered: number } | null = null;
  if (await catalogMonthlyDeliveryAvailable()) {
    const { data: orgs } = await admin.from('orgs').select('id, plan, catalog_quota, catalog_last_monthly_delivery, is_test');
    // is_test filtrado já aqui para nem sequer iterar sobre contas de teste —
    // deliverMonthlyForOrg tem o mesmo guarda, que é o autoritativo (Prompt
    // 201 §2). Este é só para o log de baixo contar o que interessa.
    const due = ((orgs ?? []) as MonthlyDeliveryOrgRow[])
      .filter((o) => !o.is_test)
      .filter((o) => monthlyDeliveryDue(o.catalog_last_monthly_delivery, now));
    const results: MonthlyDeliveryResult[] = [];
    for (const org of due) {
      // Sequential, not Promise.all — this writes money-equivalent state
      // (catalog_quota) org-by-org; today's org count is small (early-stage
      // product) and a serverless-function timeout mid-batch should only
      // ever strand orgs not yet reached (each org's own update is atomic),
      // never leave one half-applied.
      results.push(await deliverMonthlyForOrg(admin, org, now));
    }
    // Prompt 201 §3 — defesa a mais, não substitui o tecto por org. Não
    // aborta nada: só dá sinal se o pressuposto "cada org entrega no máximo
    // o incremento do plano" alguma vez deixar de bater certo. Com os
    // travões §1+§2 a primeira corrida (1 de Setembro) deve ficar nas ~20
    // entidades; passar de 100 significa que algo mudou e ninguém reparou.
    const totalDelivered = results.reduce((sum, r) => sum + (r.delivered ?? 0), 0);
    console.log(`[automations] entrega mensal: ${results.length} orgs, ${totalDelivered} entidades`);
    if (totalDelivered > MONTHLY_DELIVERY_ALERT_THRESHOLD) {
      console.error(`[automations] ALERTA: entrega mensal devolveu ${totalDelivered} entidades (limiar ${MONTHLY_DELIVERY_ALERT_THRESHOLD}) — verificar o tecto por org`);
    }
    monthlyDelivery = { ranFor: results.length, results, totalDelivered };
  }

  let pioneerBadges: { orgsGranted: number } | null = null;
  if (await pioneerBadgeAvailable()) {
    pioneerBadges = await runPioneerExpiryJob(admin, now);
  }

  // Prompt 295 §3 — guarantees at least 1 overview snapshot/day even if no
  // developer opens /metrics that day, so History never has a gap wider
  // than 24h. The Hobby plan's 1x/day cron cap (CLAUDE.md) is exactly why
  // this can't also be the "adjust frequency to traffic" mechanism the
  // Nuno asked for — Prompt 296's popup (a developer's own manual
  // decision, session by session) is that mechanism instead.
  let metricsSnapshot: { stored: boolean } | null = null;
  try {
    metricsSnapshot = await computeAndStoreOverviewSnapshot(admin, { triggeredBy: 'daily_cron' });
  } catch (e) {
    console.error('[automations] daily metrics snapshot failed:', e);
  }

  // Prompt 301 §3 — re-checks any document still 'pending' a VirusTotal
  // verdict (a genuinely new file at upload time never gets a synchronous
  // one — see upload-security.ts's own header). Cheap hash lookups only,
  // never a re-submission.
  let malwareScanSweep: { checked: number; resolved: number; flagged: number } | null = null;
  try {
    if (await malwareScanAvailable()) malwareScanSweep = await recheckPendingMalwareScans(admin);
  } catch (e) {
    console.error('[automations] daily malware-scan sweep failed:', e);
  }

  // Prompt 369 §A3 — the gap that let 67 real documents sit
  // 'not_scanned' forever (migration 0205 marked pre-existing rows that way
  // and nothing ever scanned them afterward): a small, rate-limit-friendly
  // trickle so a bulk-imported org's backlog drains on its own instead of
  // needing a manual one-off script the next time this happens.
  let retroscanSweep: { checked: number; resolved: number; flagged: number } | null = null;
  try {
    if (await malwareScanAvailable()) retroscanSweep = await retroscanNotScannedDocuments(admin);
  } catch (e) {
    console.error('[automations] daily not_scanned retro-scan sweep failed:', e);
  }

  // Prompt 305 §A — same daily re-check, for the four secondary upload
  // paths Prompt 301's original sweep never covered.
  //
  // Adversarial-review follow-up: this used to run all four inside ONE
  // Promise.all + one shared try/catch — a real exception in any single
  // sweep (not just a capability probe returning false, which never
  // throws) would reject the whole Promise.all and silently blank out the
  // other three results too, contradicting this comment's own claim of
  // independence. Each sweep now gets its own try/catch so one failure is
  // reported as exactly that — one failure — never mistaken for "nothing
  // ran" on the other three.
  async function runSecondarySweep(label: string, fn: () => Promise<{ checked: number; resolved: number; flagged: number }>) {
    try {
      return await fn();
    } catch (e) {
      console.error(`[automations] daily secondary malware-scan sweep (${label}) failed:`, e);
      return null;
    }
  }
  const [investorDocs, ndas, matchdealPhotos, supportAttachments, companyMedia] = await Promise.all([
    runSecondarySweep('investorVerificationDocuments', async () => (await investorVerificationScanAvailable())
      ? recheckPendingScansGeneric(admin, { table: 'investor_verification_documents', idColumn: 'id', hashColumn: 'content_sha256', statusColumn: 'malware_scan_status', checkedAtColumn: 'malware_scan_checked_at' })
      : { checked: 0, resolved: 0, flagged: 0 }),
    runSecondarySweep('ndas', async () => (await ndaScanAvailable())
      ? recheckPendingScansGeneric(admin, { table: 'ndas', idColumn: 'id', hashColumn: 'content_sha256', statusColumn: 'malware_scan_status', checkedAtColumn: 'malware_scan_checked_at' })
      : { checked: 0, resolved: 0, flagged: 0 }),
    runSecondarySweep('matchdealPhotos', async () => (await matchdealPhotoScanAvailable())
      ? recheckMatchdealPhotoScans(admin) : { checked: 0, resolved: 0, flagged: 0 }),
    runSecondarySweep('supportAttachments', async () => (await supportAttachmentScanAvailable())
      ? recheckPendingScansGeneric(admin, { table: 'support_attachment_scans', idColumn: 'id', hashColumn: 'content_sha256', statusColumn: 'malware_scan_status', checkedAtColumn: 'malware_scan_checked_at' })
      : { checked: 0, resolved: 0, flagged: 0 }),
    // Prompt 353 — company_media's own images/videos, same daily re-check.
    // video_link rows never enter this sweep (they're written 'clean' at
    // insert time, never 'pending' — nothing to re-check).
    runSecondarySweep('companyMedia', async () => (await companyMediaScanAvailable())
      ? recheckPendingScansGeneric(admin, { table: 'company_media', idColumn: 'id', hashColumn: 'content_sha256', statusColumn: 'malware_scan_status', checkedAtColumn: 'malware_scan_checked_at' })
      : { checked: 0, resolved: 0, flagged: 0 }),
  ]);
  const secondaryMalwareScanSweep = { investorVerificationDocuments: investorDocs, ndas, matchdealPhotos, supportAttachments, companyMedia };

  // Prompt 398 §3 — daily sweep for the "interest_request_unanswered"
  // automation: its own dedicated function, not the generic (still
  // unbuilt) automation-rules engine — same pattern as every other real
  // job in this route.
  let interestReminderSweep: InterestReminderSweepResult | null = null;
  try {
    interestReminderSweep = await runInterestReminderSweep(admin, new Date());
  } catch (e) {
    console.error('[automations] daily interest-reminder sweep failed:', e);
  }

  // Prompt 465 §D — the daily safety net: whatever no client got around to
  // requesting (CRON_ONLY paths like the investor-portal doc-summary
  // trigger — see ensureDocumentSummary's own comment — or simply a
  // founder who never revisited the app) still gets reconciled at least
  // once a day, closing the gap the two dead `void
  // runReconciliationForOrg(...)` triggers removed in §A used to (never
  // actually) cover. Same sequential-not-Promise.all discipline as the
  // monthly delivery block above and for the same reason: a timeout mid-
  // sweep should only ever strand orgs not yet reached. Cheap by
  // construction (computeReconciliationSignature makes an unchanged org a
  // no-op AI call). No batching/ordering by staleness: verified by SQL
  // before writing this that production has 11 orgs total, 3 of them real
  // — a full unbatched sweep costs nothing at that scale. Add batching back
  // only if a real number says otherwise.
  let reconciliationSweep: { orgsChecked: number; orgsRan: number } | null = null;
  if (await gapReconciliationsAvailable()) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const { data: reconcileOrgs } = await admin.from('orgs').select('id, is_test');
    const dueOrgs = ((reconcileOrgs ?? []) as { id: string; is_test: boolean | null }[]).filter((o) => !o.is_test);
    let orgsRan = 0;
    for (const org of dueOrgs) {
      try {
        const outcome = await runReconciliationForOrg(admin, apiKey, org.id);
        if (outcome.error) console.error(`[automations] reconciliation failed for org=${org.id}:`, outcome.error);
        // Prompt 480 §7 — the cron goes through the same lock as everyone
        // else and gives up SILENTLY when another run holds it: there is no
        // founder here to warn, and tomorrow's sweep tries again. Logged
        // rather than counted, so a sweep that skipped everything is
        // distinguishable from one that found nothing to do.
        else if (outcome.skipped) console.log(`[automations] reconciliation skipped for org=${org.id}: lock held by another run`);
        else if (outcome.ran) orgsRan++;
      } catch (e) {
        console.error(`[automations] reconciliation threw for org=${org.id}:`, (e as Error).message);
      }
    }
    console.log(`[automations] daily reconciliation sweep: ${dueOrgs.length} orgs checked, ${orgsRan} ran`);
    reconciliationSweep = { orgsChecked: dueOrgs.length, orgsRan };
  }

  // Prompt 498 — o TODO que esteve aqui desde o início: o tick de regras
  // (src/lib/rules.ts) a correr sobre a base de dados real, e não só
  // client-side em modo demo. Mesmo padrão de loop por org, mesma tolerância
  // a erro por org, mesma disciplina de idempotência que os sweeps acima.
  // Só cria TAREFAS — nunca despacha nada (ver automation-rules-tick-server.ts).
  let automationRulesSweep: AutomationRulesSweepResult | null = null;
  try {
    if (await automationRulesSweepAvailable()) {
      automationRulesSweep = await runAutomationRulesSweep(admin, new Date(now));
      console.log(`[automations] tick de regras: ${automationRulesSweep.orgsWithRulesEnabled}/${automationRulesSweep.orgsChecked} orgs com regras ligadas, ${automationRulesSweep.tasksCreated} tarefas criadas`);
    }
  } catch (e) {
    console.error('[automations] tick de regras falhou:', e);
  }

  return NextResponse.json({
    ok: true,
    message: 'Engine tick complete.',
    automationRulesSweep,
    monthlyDelivery,
    pioneerBadges,
    metricsSnapshot,
    malwareScanSweep,
    retroscanSweep,
    secondaryMalwareScanSweep,
    interestReminderSweep,
    reconciliationSweep,
  });
}
