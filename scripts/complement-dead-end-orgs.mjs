// Prompt 879 (path 3) — complement the four orgs left holding dead-end
// investors with reachable alternatives they have not been delivered yet.
//
// The 554 pre-3-Sept dead ends are not deleted (path 2 deprioritises them,
// they keep their history and their fallback email). This adds, alongside
// them, investors that DO have a person to contact — drawn from the same
// catalog_top_matches the monthly delivery uses, so every one is verified,
// active, a genuine fit (score >= 55) and has a reachable person by
// construction. Bounded per org by how many dead ends it holds, so it is a
// proportional top-up, never a flood; catalog_top_matches caps it at the
// reachable supply that actually qualifies (ablute_ has all but ~4 of the
// reachable catalog already, so it gets those few and no more).
//
// Two guards, both via deliverCatalogMatches options:
//   quotaExempt        — this is our fix for a gap we left, not the founder's
//                        own draw, and it must not be blocked for an org
//                        already at its quota ceiling.
//   skipEnrichmentEnqueue — the 645 spend freeze: deliver, but queue no paid
//                        enrichment work.
//
//   node scripts/complement-dead-end-orgs.mjs           # dry run (default)
//   node scripts/complement-dead-end-orgs.mjs --commit  # apply
import { readFileSync } from 'fs';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

// Node 24 strips the TS types on import, but its ESM resolver will not
// complete the app's extensionless relative imports ("./catalog-fit-bucket").
// Register a tiny resolve hook that retries a failed extensionless relative
// specifier with .ts/.tsx, then dynamic-import the delivery module. Inlined
// via a data: URL so this script is self-contained (scripts/_* is gitignored,
// so an external loader file could not travel with it).
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    if ((spec.startsWith('./') || spec.startsWith('../')) && !/\\.[a-zA-Z0-9]+$/.test(spec)) {
      for (const ext of ['.ts', '.tsx']) { try { return await next(spec + ext, ctx); } catch { /* try next */ } }
    }
    throw e;
  }
}`), import.meta.url);

const { deliverCatalogMatches } = await import('../src/lib/catalog-delivery-core.ts');

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(2); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes('--commit');

// The four affected orgs and how many dead ends each holds (verified in SQL
// 2026-09-10). pLimit = dead-end count: a proportional complement. Krohnsty
// is the org id that actually holds the dead end (there are two orgs by that
// name; the other has none).
const TARGETS = [
  { name: 'ablute_', orgId: 'bca54499-03c8-469b-a48d-b9f442e44f69', pLimit: 554 },
  { name: 'Estojo', orgId: 'b618b763-81ef-4d6c-bf82-697a2d175783', pLimit: 7 },
  { name: 'New company (please rename in Settings)', orgId: '2bdd0d96-dc3e-4058-a6a2-862beb2ef8cb', pLimit: 2 },
  { name: 'Krohnsty', orgId: '54f1bf67-66a3-4c60-8e1b-9ec39ea2c0dd', pLimit: 1 },
];

const COMPLEMENT_ACTION = 'catalog_complement_delivered';

async function alreadyComplemented(orgId) {
  const { data } = await admin.from('admin_audit_log')
    .select('id').eq('action', COMPLEMENT_ACTION).eq('subject_id', orgId).limit(1).maybeSingle();
  return !!data;
}

async function main() {
  for (const t of TARGETS) {
    // Idempotency: catalog_top_matches always returns FRESH undelivered
    // matches, so a second --commit would deliver another batch. An audit
    // marker per org makes a re-run a no-op — the complement is a one-off.
    if (await alreadyComplemented(t.orgId)) { console.log(`\n${t.name} — already complemented, skipping.`); continue; }
    const { data: matches, error } = await admin.rpc('catalog_top_matches', { p_org_id: t.orgId, p_limit: t.pLimit });
    if (error) { console.error(`${t.name}: catalog_top_matches failed:`, error.message); process.exit(1); }
    const ids = (matches ?? []).map((m) => m.catalog_id);
    let names = [];
    if (ids.length) {
      const { data: rows } = await admin.from('catalog_entities').select('name, hq_country').in('id', ids);
      names = (rows ?? []).map((r) => `${r.name}${r.hq_country ? ` (${r.hq_country})` : ''}`);
    }
    console.log(`\n${t.name} — dead ends ${t.pLimit}, reachable alternatives available now: ${ids.length}`);
    for (const n of names.slice(0, 12)) console.log(`   + ${n}`);
    if (names.length > 12) console.log(`   … +${names.length - 12} more`);

    if (!COMMIT) continue;
    const res = await deliverCatalogMatches(admin, t.orgId, t.pLimit, null, { quotaExempt: true, skipEnrichmentEnqueue: true });
    if (res.error) { console.error(`${t.name}: delivery error:`, res.error); process.exit(1); }
    // Mark the org complemented even when 0 were delivered (no qualified
    // supply) — the decision was made and re-running should not keep probing.
    await admin.from('admin_audit_log').insert({
      admin_user_id: null, action: COMPLEMENT_ACTION, subject_type: 'org', subject_id: t.orgId,
      detail: { prompt: '879', requested: t.pLimit, delivered: res.delivered },
    }).then(() => {}, (e) => console.error('audit insert failed (non-fatal):', e?.message));
    console.log(`   → delivered ${res.delivered}`);
  }
  if (!COMMIT) console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
  else console.log('\ndone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
