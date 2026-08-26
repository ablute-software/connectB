// Prompt 384 §E.3 — one-off backfill: any org_market_data.competitors
// free-text entry migrates into the real structured path (market_companies
// + org_competitors), same dedup-by-name/domain discipline as the app's own
// addOrUpdateCompetitor (src/lib/market-competitor-write.ts) — reimplemented
// inline here (name-match only, no domain to match on for these legacy rows)
// since this is a plain Node script, not a Next.js route. Never deletes the
// old column — "se existe é autêntico, migrar, nunca apagar sem migrar."
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) { console.error('Missing Supabase env vars.'); process.exit(1); }
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: rows, error } = await admin
  .from('org_market_data')
  .select('org_id, competitors')
  .not('competitors', 'eq', '[]');
if (error) { console.error(error.message); process.exit(1); }

const legacy = (rows ?? []).filter((r) => Array.isArray(r.competitors) && r.competitors.length > 0);
console.log(`Found ${legacy.length} org(s) with legacy free-text competitors.`);
if (legacy.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

const { data: existingCompanies } = await admin.from('market_companies').select('id, name');
const companyIdByLowerName = new Map((existingCompanies ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

let migrated = 0;
for (const row of legacy) {
  for (const c of row.competitors) {
    const name = (c?.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let companyId = companyIdByLowerName.get(key);
    if (!companyId) {
      const description = [c.country, c.stage, c.funding].filter(Boolean).join(' · ') || null;
      const { data: created, error: createErr } = await admin.from('market_companies')
        .insert({ name, description, source_quality: 'founder_provided', updated_at: new Date().toISOString() })
        .select('id').single();
      if (createErr) { console.error(`Could not create company "${name}": ${createErr.message}`); continue; }
      companyId = created.id;
      companyIdByLowerName.set(key, companyId);
    }
    const { error: upsertErr } = await admin.from('org_competitors').upsert({
      org_id: row.org_id, market_company_id: companyId, relation: 'direct',
      note: c.note ?? null, positioning: c.note ?? null, added_by: 'founder', updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,market_company_id' });
    if (upsertErr) { console.error(`Could not link "${name}" to org ${row.org_id}: ${upsertErr.message}`); continue; }
    migrated += 1;
  }
}
console.log(`Migrated ${migrated} legacy competitor entr${migrated === 1 ? 'y' : 'ies'} into org_competitors. org_market_data.competitors left untouched (never written again by the app, per §E.2).`);
