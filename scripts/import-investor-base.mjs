// Prompt 639 §3 / 640 — feeds a human-verified investor base to
// public.import_investor_base() and prints its report.
//
// Usage:
//   node scripts/import-investor-base.mjs                      # dry run (default)
//   node scripts/import-investor-base.mjs --commit             # apply
//   node scripts/import-investor-base.mjs --dir <folder> --batch <batch_id> [--commit]
//
// The folder holds the six sheets as CSV plus the two reconciliation sheets
// (see supabase/seeds/base_investidores_eu_uk/LEIA-ME.md). This script does
// no mapping of its own — every rule lives in the SQL function, so a dry run
// and an apply are the same code path and the report is the same report.
// What it does do, because it can and the database cannot: run every
// personal signal through the worker's own Article 9 net
// (supabase/functions/enrichment-worker/special-category.ts — the deployed
// module, imported directly, not a copy) and mark the ones the net rejects,
// so the function skips them and audits the rejection (639 §2.5).
//
// Dry run by default, same convention as import-investor-intel.mjs: the
// function performs every write and then raises with the report, so nothing
// persists until --commit.
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { findSpecialCategoryMention } from '../supabase/functions/enrichment-worker/special-category.ts';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(2); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback; };
const COMMIT = argv.includes('--commit');
const DIR = resolve(flag('--dir', 'supabase/seeds/base_investidores_eu_uk'));
const BATCH = flag('--batch', 'base_investidores_eu_uk_v2_20260909');

// RFC 4180: quoted fields, doubled quotes, newlines inside quotes, BOM.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
const sheet = (name) => parseCsv(readFileSync(join(DIR, name), 'utf8'));

const investors = sheet('Investidores.csv');
const people = sheet('Pessoas.csv');
const hooks = sheet('Conteudos_Hooks.csv');
const signals = sheet('Sinais_Pessoais.csv');
const sources = sheet('Fontes.csv');
const recInv = sheet('reconciliacao_investidores.csv');
const recPpl = sheet('reconciliacao_pessoas.csv');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s ?? '');
const invById = new Map(recInv.map((r) => [r.ID_Investidor, r]));
const pplById = new Map(recPpl.map((r) => [r.ID_Pessoa, r]));

for (const inv of investors) {
  const rec = invById.get(inv.ID_Investidor);
  inv.catalog_entity_id = rec && isUuid(rec.catalog_entity_id) ? rec.catalog_entity_id : null;
}
for (const p of people) {
  const rec = pplById.get(p.ID_Pessoa);
  p.catalog_person_id = rec && isUuid(rec.catalog_person_id) ? rec.catalog_person_id : null;
  p.accao = rec?.accao || 'CRIAR';
}
let netRejected = 0;
for (const s of signals) {
  const hit = findSpecialCategoryMention(`${s['Sinal_Público']} — ${s['Hook_Seguro']}`);
  s.net_rejected = hit ? 'true' : 'false';
  if (hit) { s.net_term = hit.term; s.net_marker = hit.marker; netRejected += 1; }
}

const payload = { investors, people, hooks, signals, sources };
console.log(`batch ${BATCH} · ${COMMIT ? 'APPLY' : 'DRY RUN'} · ${investors.length} investors · ${people.length} people · ${hooks.length} contents · ${signals.length} signals (${netRejected} rejected by the net) · ${sources.length} sources`);

const started = Date.now();
const { data, error } = await admin.rpc('import_investor_base', { p_batch_id: BATCH, p_payload: payload, p_dry_run: !COMMIT });
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (error) {
  const m = /^DRY_RUN (.*)$/s.exec(error.message ?? '');
  if (m) {
    console.log(`dry run rolled back after ${secs}s — report:`);
    console.log(JSON.stringify(JSON.parse(m[1]), null, 2));
    process.exit(0);
  }
  console.error(`FAILED after ${secs}s:`, error.message, error.details ?? '', error.hint ?? '');
  process.exit(1);
}
console.log(`applied in ${secs}s — report:`);
console.log(JSON.stringify(data, null, 2));
