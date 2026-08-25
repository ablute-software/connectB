// Prompt 380 §B / Prompt 381 — enqueue the never-enqueued backlog.
//
// This script ONLY ENQUEUES. It never calls an AI model itself: the existing
// enrichment-worker (Deno edge function, cron every 15 min, BATCH_SIZE 5)
// is what actually spends money, at its own pace. That is deliberate —
// "ritmo do cron existente, sem burst; é aceitável levar dias".
//
// SAFETY: does nothing at all without `--go`. Default is a dry run that
// prints the exact backlog and the tranche split.
//
// BACKLOG DEFINITION (Prompt 380 §0 asked for this to be explicit, because
// two independent counts disagreed — 415 vs 526 — purely on definition):
//   * delivered: appears in catalog_deliveries (any org, any time)
//   * never enqueued: has NO enrichment_jobs row with target_type='entity',
//     of ANY status. done/failed/skipped/queued all count as "was enqueued".
//     Jobs for the entity's PEOPLE (target_type='person') do NOT count —
//     that is the definitional choice, and it is why the two counts differed:
//     526 was computed against target_type='catalog_entity', a value that
//     does not exist in this schema (the real values are 'entity'/'person'),
//     so it matched nothing and returned every delivered row.
//   * excluding is_test entities (QA fixtures never cost real money)
//   * still enrichment_status='pending'
//   => 413 entities, measured 2026-08-25.
//
// TRANCHES (Prompt 381): tranche 1 is the part that actually matters to the
// founder's raise — entities in ablute_'s own pipeline with real relevance
// (wave 1-2, status not dormant/passed/not_a_fit) — enqueued at a better
// priority so the worker takes them first. Tranche 2 is everything else.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const CAMPAIGN = 'backfill-2026-08';
const PRIORITY_TRANCHE_1 = 50;   // lower = sooner (worker orders priority asc)
const PRIORITY_TRANCHE_2 = 200;
const ABLUTE_ORG = 'bca54499-03c8-469b-a48d-b9f442e44f69';

const args = process.argv.slice(2);
const GO = args.includes('--go');
const TRANCHE = args.includes('--tranche=2') ? 2 : 1;
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] || 0) || null;

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function loadBacklog() {
  const [{ data: deliveries }, { data: jobs }, { data: entities }] = await Promise.all([
    admin.from('catalog_deliveries').select('catalog_id, org_id, entity_id'),
    admin.from('enrichment_jobs').select('target_id').eq('target_type', 'entity'),
    admin.from('catalog_entities').select('id, name, is_test, enrichment_status'),
  ]);
  const enqueued = new Set((jobs ?? []).map((j) => j.target_id));
  const entityById = new Map((entities ?? []).map((e) => [e.id, e]));

  // ablute_'s own pipeline rows, for the tranche-1 relevance test.
  const { data: pipeline } = await admin.from('entities')
    .select('id, wave, status').eq('org_id', ABLUTE_ORG);
  const pipelineById = new Map((pipeline ?? []).map((e) => [e.id, e]));

  const seen = new Set();
  const backlog = [];
  for (const d of deliveries ?? []) {
    if (seen.has(d.catalog_id)) continue;
    const ce = entityById.get(d.catalog_id);
    if (!ce || ce.is_test || ce.enrichment_status !== 'pending') continue;
    if (enqueued.has(d.catalog_id)) continue;
    seen.add(d.catalog_id);

    const own = d.org_id === ABLUTE_ORG ? pipelineById.get(d.entity_id) : null;
    const relevant = !!own && (own.wave === 1 || own.wave === 2)
      && !['dormant', 'passed', 'not_a_fit'].includes(own.status);
    backlog.push({ catalogId: d.catalog_id, name: ce.name, orgId: d.org_id, tranche: relevant ? 1 : 2 });
  }
  return backlog;
}

const backlog = await loadBacklog();
const t1 = backlog.filter((b) => b.tranche === 1);
const t2 = backlog.filter((b) => b.tranche === 2);

console.log(`Backlog: ${backlog.length} entities never enqueued (tranche 1: ${t1.length}, tranche 2: ${t2.length}).`);

if (!GO) {
  console.log('\nDRY RUN — nothing was enqueued. Re-run with --go to enqueue.');
  console.log('Tranche 1 sample:', t1.slice(0, 10).map((b) => b.name));
  console.log('Tranche 2 sample:', t2.slice(0, 10).map((b) => b.name));
  process.exit(0);
}

const chosen = (TRANCHE === 1 ? t1 : t2).slice(0, LIMIT ?? undefined);
if (chosen.length === 0) { console.log('Nothing to enqueue for this tranche.'); process.exit(0); }

const rows = chosen.map((b) => ({
  target_type: 'entity', target_id: b.catalogId, layer: 1,
  priority: TRANCHE === 1 ? PRIORITY_TRANCHE_1 : PRIORITY_TRANCHE_2,
  campaign: CAMPAIGN,
  // requested_by_org_id deliberately left null: this is a platform-run
  // campaign, not one org's request — and it keeps the campaign's cost
  // separable in the ai_call_log mirror.
}));

let inserted = 0;
for (let i = 0; i < rows.length; i += 50) {
  const chunk = rows.slice(i, i + 50);
  const { error, count } = await admin.from('enrichment_jobs').insert(chunk, { count: 'exact' });
  if (error) { console.error('insert failed:', error.message); break; }
  inserted += count ?? chunk.length;
  console.log(`enqueued ${inserted}/${rows.length}`);
}
console.log(`\nDone. Enqueued ${inserted} job(s) as campaign="${CAMPAIGN}", tranche ${TRANCHE}.`);
console.log('The worker (cron, every 15 min, batch 5) will process them at its own pace.');
