// Prompt 274 — supervised first real trial of the enrichment campaign
// (5 entities, the prompt's own explicit "com o Nuno a ver os resultados
// antes de abrir o cap"). Same enqueue/invoke/collect logic as the new
// Next.js routes (src/lib/enrichment-campaign.ts,
// src/app/api/backoffice/catalog/enrichment-campaign/*), reimplemented
// standalone here (server-only TS modules aren't importable from a plain
// Node script) so this can run against real production without a live
// browser session — same precedent as scripts/_prompt137_invoke.mjs and
// scripts/_prompt137_queue_fill.mjs, the original Prompt 137 pilot
// scripts. Uses the service-role key (same auth path pg_cron itself uses),
// never a user session. Does not modify the worker or its provenance
// rules — only enqueues into enrichment_jobs and invokes the existing
// Edge Function, exactly like the real UI would.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const WORKER_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/enrichment-worker`;
const CAP = 5;
const PRIORITY = 1;

async function enqueue(targetType, targetId, layer) {
  const { data: active } = await admin.from('enrichment_jobs').select('id')
    .eq('target_type', targetType).eq('target_id', targetId).eq('layer', layer)
    .in('status', ['queued', 'running']).maybeSingle();
  if (active) return { jobId: active.id, alreadyQueued: true };
  const { data: created, error } = await admin.from('enrichment_jobs')
    .insert({ target_type: targetType, target_id: targetId, layer, priority: PRIORITY, requested_by_org_id: null })
    .select('id').single();
  if (error) throw new Error(`enqueue ${targetType}/${targetId} L${layer} failed: ${error.message}`);
  return { jobId: created.id, alreadyQueued: false };
}

async function invokeWorker(layer) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ maxJobs: 1, layer }),
  });
  return res.json();
}

async function readJob(jobId) {
  const { data } = await admin.from('enrichment_jobs')
    .select('status, last_error, cost_eur, tokens_in, tokens_out, web_calls').eq('id', jobId).single();
  return data ?? { status: 'unknown' };
}

async function main() {
  console.log(`Fetching top ${CAP} priority candidates...`);
  const { data: entities, error } = await admin.from('catalog_entities')
    .select('id, name, verification_status, is_test, enrichment_status');
  if (error) throw error;
  const { data: deliveries } = await admin.from('catalog_deliveries').select('catalog_id');
  const deliveredCount = new Map();
  for (const d of deliveries ?? []) deliveredCount.set(d.catalog_id, (deliveredCount.get(d.catalog_id) ?? 0) + 1);

  const candidates = (entities ?? [])
    .filter((e) => !e.is_test && e.enrichment_status === 'pending')
    .map((e) => ({ id: e.id, name: e.name, verified: e.verification_status === 'verified', deliveredCount: deliveredCount.get(e.id) ?? 0 }))
    .sort((a, b) =>
      (b.deliveredCount > 0 ? 1 : 0) - (a.deliveredCount > 0 ? 1 : 0)
      || (b.verified ? 1 : 0) - (a.verified ? 1 : 0)
      || b.deliveredCount - a.deliveredCount
      || a.name.localeCompare(b.name))
    .slice(0, CAP);

  console.log(`Candidates: ${candidates.map((c) => c.name).join(', ')}`);

  const report = { entities: [], totalCostEur: 0, hooksGained: 0, peopleResearched: 0 };

  for (const c of candidates) {
    console.log(`\n=== ${c.name} (${c.id}) — delivered:${c.deliveredCount} verified:${c.verified} ===`);
    const enq = await enqueue('entity', c.id, 1);
    console.log(`  enqueue L1: ${enq.alreadyQueued ? 'already queued' : 'enqueued'} (job ${enq.jobId})`);
    // BUG FOUND LIVE (this trial): a retried job keeps its ORIGINAL
    // created_at, so it stays at the front of its priority tier — a
    // single invoke-then-move-to-next-candidate loop just keeps
    // re-claiming the SAME stuck job instead of ever reaching the next
    // one (confirmed: 33N Ventures alone absorbed 3 of the first 5
    // invocations; 3 of 5 candidates never got attempted at all). Fix:
    // keep invoking for THIS entity until its own job reaches a terminal
    // status (done/skipped/failed), not just once — bounded at 4 tries,
    // one more than the worker's own 3-attempt cap so a final requeue
    // still gets read back correctly instead of stopping one short.
    let job = { status: 'queued' };
    for (let attempt = 0; attempt < 4 && job.status === 'queued'; attempt++) {
      const invoked = await invokeWorker(1);
      if (invoked.skipped) { console.log(`  STOPPED: worker disabled (${invoked.reason})`); report.stopped = invoked.reason; break; }
      if (invoked.stopped) { console.log(`  STOPPED: daily cost cap reached (spent €${invoked.spentToday} of €${invoked.cap})`); report.stopped = invoked.reason; break; }
      job = await readJob(enq.jobId);
    }
    if (report.stopped) break;
    console.log(`  L1 result: status=${job.status} reason=${job.last_error ?? '-'} cost=€${(job.cost_eur ?? 0).toFixed(5)} webCalls=${job.web_calls ?? 0}`);
    report.totalCostEur += job.cost_eur ?? 0;

    const entityReport = { name: c.name, id: c.id, layer1Status: job.status, layer1Reason: job.last_error, layer1CostEur: job.cost_eur ?? 0, people: [] };

    if (job.status === 'done') {
      const { data: affiliations } = await admin.from('catalog_person_affiliations')
        .select('person_id, catalog_people!inner(id, full_name, hook_status)').eq('entity_id', c.id);
      const seen = new Set();
      const people = [];
      for (const a of affiliations ?? []) {
        const p = a.catalog_people;
        if (p.hook_status === 'to_research' && !seen.has(p.id)) { seen.add(p.id); people.push(p); }
      }
      console.log(`  people needing Layer 2: ${people.length}`);
      for (const p of people) {
        const enqP = await enqueue('person', p.id, 2);
        // Same head-of-line fix as Layer 1 above.
        let jobP = { status: 'queued' };
        for (let attempt = 0; attempt < 4 && jobP.status === 'queued'; attempt++) {
          const invokedP = await invokeWorker(2);
          if (invokedP.skipped) { console.log(`  STOPPED (Layer 2): worker disabled (${invokedP.reason})`); report.stopped = invokedP.reason; break; }
          if (invokedP.stopped) { console.log(`  STOPPED (Layer 2): daily cost cap reached (spent €${invokedP.spentToday} of €${invokedP.cap})`); report.stopped = invokedP.reason; break; }
          jobP = await readJob(enqP.jobId);
        }
        if (report.stopped) break;
        const { data: personRow } = await admin.from('catalog_people').select('hook_status').eq('id', p.id).maybeSingle();
        const hookWritten = personRow?.hook_status === 'researched';
        console.log(`    ${p.full_name}: status=${jobP.status} hookWritten=${hookWritten} cost=€${(jobP.cost_eur ?? 0).toFixed(5)}`);
        report.totalCostEur += jobP.cost_eur ?? 0;
        report.peopleResearched++;
        if (hookWritten) report.hooksGained++;
        entityReport.people.push({ name: p.full_name, status: jobP.status, hookWritten, costEur: jobP.cost_eur ?? 0 });
      }
    }
    report.entities.push(entityReport);
    if (report.stopped) break;
  }

  console.log('\n\n=== FINAL REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nTotal: ${report.entities.length} entities attempted, ${report.entities.filter((e) => e.layer1Status === 'done').length} enriched, ${report.peopleResearched} people researched, ${report.hooksGained} hooks gained, €${report.totalCostEur.toFixed(5)} spent.`);
  if (report.stopped) console.log(`Stopped early: ${report.stopped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
