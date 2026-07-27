#!/usr/bin/env node
// Prompt B — backfill entities (layer 2, private to the ablute_ org) into
// catalog_entities (layer 1, the global platform catalogue), then seed
// catalog_deliveries so the ablute_ org is never re-delivered its own rows,
// then build the country + Starter Europe packs.
//
// Idempotent by design: every catalogue row is keyed on source_entity_id
// (unique, migration 0038), so re-running upserts instead of duplicating.
// Safe to run repeatedly as entities get enriched.
//
//   node scripts/backfill-catalog.mjs --dry-run   # counts only, writes nothing
//   node scripts/backfill-catalog.mjs             # writes
//
// Reads credentials from .env.local (service role — REST only, no DDL; the
// columns this depends on come from migration 0038, run separately).
import fs from 'node:fs';
import path from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const ABLUTE_ORG_ID = 'bca54499-03c8-469b-a48d-b9f442e44f69';
const BATCH = 100;

// A country gets its own pack once it has at least this many verified rows.
const COUNTRY_PACK_MIN = 10;
// "Starter Europe" — the best verified rows that also have a named person.
const STARTER_SIZE = 25;

const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const pick = (k) => env.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1]?.trim();
const URL = pick('NEXT_PUBLIC_SUPABASE_URL');
const KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathAndQuery} → ${res.status} ${text.slice(0, 400)}`);
  return { rows: text ? JSON.parse(text) : null, range: res.headers.get('content-range') };
}

// Fetch every row, paging past PostgREST's default cap.
async function fetchAll(table, select, extra = '') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { rows } = await rest(`${table}?select=${select}${extra}&order=id.asc&limit=1000&offset=${from}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ── The quality gate ────────────────────────────────────────────────────
// "Verified" means we hold at least one confirmed way to reach the entity.
// Approved criterion (Prompt B): an email, a phone, or a real submission
// channel whose type we actually know.
function hasConfirmedContact(e) {
  return !!(
    e.email ||
    e.phone ||
    (e.submission_channel && e.submission_channel_type && e.submission_channel_type !== 'unknown')
  );
}

// Starter Europe criterion (approved as a proxy): a named person plus a
// reachable address. entities has no entity-level LinkedIn column — that
// lives on people, which is outside this backfill — so key_people carries
// the "named person" signal.
function isStarterGrade(e) {
  return !!(e.key_people && (e.email || e.general_partner_emails));
}

// ── Country normalisation ───────────────────────────────────────────────
// entities.hq_country is free text and holds BOTH full names and ISO-2
// codes for the same country ("Germany" 62 rows and "DE" 1; "France" 42 and
// "FR" 6; "Portugal" 8 and "PT" 8; also Austria/AT, Spain/ES, United
// Kingdom/UK). catalog_entities is consistently ISO-2 in its existing rows
// (DE, FR, PT), and nothing in the codebase branches on the value — it is
// display-only. Left as-is, every one of those countries would be split
// across two buckets and its pack would silently miss rows.
//
// This is a mapping, not an invented value: an unrecognised country is
// passed through untouched, and null stays null.
const ISO2 = {
  'germany': 'DE', 'france': 'FR', 'portugal': 'PT', 'spain': 'ES',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB',
  'netherlands': 'NL', 'the netherlands': 'NL', 'holland': 'NL',
  'sweden': 'SE', 'belgium': 'BE', 'norway': 'NO', 'ireland': 'IE',
  'austria': 'AT', 'denmark': 'DK', 'switzerland': 'CH', 'luxembourg': 'LU',
  'italy': 'IT', 'finland': 'FI', 'poland': 'PL', 'czech republic': 'CZ',
  'czechia': 'CZ', 'estonia': 'EE', 'lithuania': 'LT', 'latvia': 'LV',
  'bulgaria': 'BG', 'hungary': 'HU', 'romania': 'RO', 'malta': 'MT',
  'gibraltar': 'GI', 'greece': 'GR', 'slovakia': 'SK', 'slovenia': 'SI',
  'croatia': 'HR', 'cyprus': 'CY', 'iceland': 'IS', 'liechtenstein': 'LI',
  'united states': 'US', 'united states of america': 'US', 'usa': 'US',
  'brazil': 'BR', 'israel': 'IL', 'canada': 'CA',
  'united arab emirates': 'AE', 'uae': 'AE',
};
function normalizeCountry(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^[A-Z]{2}$/.test(t)) return t === 'UK' ? 'GB' : t;
  return ISO2[t.toLowerCase()] ?? t;
}

// Only copy what the catalogue actually models. Never invent a value:
// an absent field stays null rather than being guessed or defaulted.
function toCatalogRow(e) {
  const status = hasConfirmedContact(e) ? 'verified' : 'imported';
  return {
    source_entity_id: e.id,
    name: e.name,
    type: e.type,
    hq_city: e.hq_city ?? null,
    hq_country: normalizeCountry(e.hq_country),
    sectors: e.sectors ?? null,
    stage_min: e.stage_min ?? null,
    stage_max: e.stage_max ?? null,
    check_min_eur: e.check_min_eur ?? null,
    check_max_eur: e.check_max_eur ?? null,
    thesis: e.thesis ?? null,
    website: e.website ?? null,
    catalog_status: status,
    // verification_status is the field that actually gates founder-facing
    // reads (the catalog_read RLS policy) and the unlockPack copy logic, so
    // it must move in lockstep with catalog_status or every backfilled
    // "verified" row would be invisible and unusable. Approved in review.
    verification_status: status === 'verified' ? 'verified' : 'pending',
    verified_at: status === 'verified' ? new Date().toISOString() : null,
    source: 'backfill_entities',
    email: e.email ?? null,
    phone: e.phone ?? null,
    address: e.address ?? null,
    postal_code: e.postal_code ?? null,
    submission_channel: e.submission_channel ?? null,
    submission_channel_type: e.submission_channel_type ?? null,
    key_people: e.key_people ?? null,
    general_partner_emails: e.general_partner_emails ?? null,
    aum: e.aum ?? null,
    current_funds: e.current_funds ?? null,
    latest_fund: e.latest_fund ?? null,
    last_investment_found: e.last_investment_found ?? null,
  };
}

function tally(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x) ?? '(null)';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN — nothing will be written ===\n' : '=== LIVE RUN ===\n');

  const entities = await fetchAll(
    'entities',
    '*',
    `&org_id=eq.${ABLUTE_ORG_ID}`
  );
  console.log(`entities in the ablute_ org: ${entities.length}`);

  const rows = entities.map(toCatalogRow);
  const verified = rows.filter((r) => r.catalog_status === 'verified');
  const imported = rows.filter((r) => r.catalog_status === 'imported');
  const starter = entities.filter(isStarterGrade);

  console.log(`  verified (confirmed contact): ${verified.length}`);
  console.log(`  imported (no contact yet):    ${imported.length}`);
  console.log(`  starter-grade (named person + email): ${starter.length}`);

  console.log('\nBy country (verified / total):');
  const byCountryTotal = new Map(tally(rows, (r) => r.hq_country));
  const byCountryVerified = new Map(tally(verified, (r) => r.hq_country));
  const countryRows = [...byCountryTotal.entries()].sort((a, b) => (byCountryVerified.get(b[0]) ?? 0) - (byCountryVerified.get(a[0]) ?? 0) || b[1] - a[1]);
  for (const [country, total] of countryRows) {
    const v = byCountryVerified.get(country) ?? 0;
    // A null country can clear the threshold on count alone but can never
    // become a pack — say so, rather than flagging it as one.
    const flag = country === '(null)' ? '  (no country — never packed)'
      : v >= COUNTRY_PACK_MIN ? '  ← pack' : '';
    console.log(`  ${String(country).padEnd(24)} ${String(v).padStart(4)} / ${String(total).padStart(4)}${flag}`);
  }

  const packCountries = countryRows
    .filter(([c]) => (byCountryVerified.get(c) ?? 0) >= COUNTRY_PACK_MIN && c !== '(null)')
    .map(([c]) => c);
  console.log(`\nCountry packs to create (>=${COUNTRY_PACK_MIN} verified): ${packCountries.length ? packCountries.join(', ') : 'none'}`);
  console.log(`Starter Europe pack: ${Math.min(STARTER_SIZE, starter.length)} rows`);

  console.log('\nBy type:');
  for (const [t, n] of tally(rows, (r) => r.type)) console.log(`  ${String(t).padEnd(24)} ${n}`);

  if (DRY_RUN) {
    console.log('\n=== DRY RUN complete — no writes performed ===');
    return;
  }

  // ── Upsert the catalogue rows ─────────────────────────────────────────
  console.log('\nUpserting catalog_entities...');
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await rest('catalog_entities?on_conflict=source_entity_id', {
      method: 'POST',
      body: JSON.stringify(chunk),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${rows.length}`);
  }
  console.log('\n  done.');

  // Read back the ids so deliveries and packs reference real catalogue rows.
  const catalog = await fetchAll('catalog_entities', 'id,source_entity_id,hq_country,catalog_status', '&source_entity_id=not.is.null');
  const byEntityId = new Map(catalog.map((c) => [c.source_entity_id, c]));
  console.log(`catalogue rows with provenance: ${catalog.length}`);

  // ── Seed catalog_deliveries for the ablute_ org ───────────────────────
  // These rows already live in the ablute_ pipeline; marking them delivered
  // is what stops a future pack unlock from duplicating them. The existing
  // unique(org_id, catalog_id) makes this idempotent.
  console.log('\nSeeding catalog_deliveries for the ablute_ org...');
  const deliveries = catalog
    .filter((c) => byEntityId.has(c.source_entity_id))
    .map((c) => ({
      org_id: ABLUTE_ORG_ID,
      catalog_id: c.id,
      entity_id: c.source_entity_id,
      via_pack: null,
    }));
  done = 0;
  for (let i = 0; i < deliveries.length; i += BATCH) {
    const chunk = deliveries.slice(i, i + BATCH);
    await rest('catalog_deliveries?on_conflict=org_id,catalog_id', {
      method: 'POST',
      body: JSON.stringify(chunk),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${deliveries.length}`);
  }
  console.log('\n  done.');

  // ── Packs ─────────────────────────────────────────────────────────────
  // Structural only: no price, no unlock economics (that is Phase 0).
  console.log('\nCreating packs...');
  const existingPacks = await fetchAll('packs', 'id,name');
  const packByName = new Map(existingPacks.map((p) => [p.name, p.id]));

  async function ensurePack(name, description) {
    if (packByName.has(name)) return packByName.get(name);
    const { rows } = await rest('packs', {
      method: 'POST',
      // price_eur is NOT NULL in the existing schema, so "not priced yet"
      // has to be expressed as 0 rather than null. These packs are
      // structural only — unlock economics are Phase 0 — so 0 reads as
      // "no price set", not as a deliberate free offer.
      body: JSON.stringify({ name, description, price_eur: 0, active: true }),
      headers: { Prefer: 'return=representation' },
    });
    const id = rows[0].id;
    packByName.set(name, id);
    return id;
  }

  async function setPackItems(packId, catalogIds) {
    const items = catalogIds.map((catalog_id) => ({ pack_id: packId, catalog_id }));
    for (let i = 0; i < items.length; i += BATCH) {
      await rest('pack_items?on_conflict=pack_id,catalog_id', {
        method: 'POST',
        body: JSON.stringify(items.slice(i, i + BATCH)),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
  }

  const COUNTRY_NAMES = {
    DE: 'Germany', UK: 'the United Kingdom', GB: 'the United Kingdom', FR: 'France',
    PT: 'Portugal', NL: 'the Netherlands', SE: 'Sweden', CH: 'Switzerland',
    IT: 'Italy', BE: 'Belgium', ES: 'Spain', DK: 'Denmark', FI: 'Finland',
    NO: 'Norway', IE: 'Ireland', AT: 'Austria', LU: 'Luxembourg', PL: 'Poland',
  };

  for (const country of packCountries) {
    const ids = catalog.filter((c) => c.hq_country === country && c.catalog_status === 'verified').map((c) => c.id);
    const label = COUNTRY_NAMES[country] ?? country;
    const packId = await ensurePack(
      `${label.replace(/^the /, '')} investors`,
      `Verified investor profiles headquartered in ${label}, with at least one confirmed contact route.`
    );
    await setPackItems(packId, ids);
    console.log(`  ${label}: ${ids.length} items`);
  }

  const starterIds = starter
    .map((e) => byEntityId.get(e.id))
    .filter((c) => c && c.catalog_status === 'verified')
    .slice(0, STARTER_SIZE)
    .map((c) => c.id);
  const starterPackId = await ensurePack(
    'Starter Europe',
    'A cross-border starting set: verified European investors with a named contact person and a direct email route.'
  );
  await setPackItems(starterPackId, starterIds);
  console.log(`  Starter Europe: ${starterIds.length} items`);

  console.log('\n=== LIVE RUN complete ===');
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
