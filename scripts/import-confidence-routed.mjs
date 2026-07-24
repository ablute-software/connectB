// Confidence-routed import for the v2.1 (country-by-country discovery) and
// v3.1 (small-batch contact/people deep-dive) external research prompts —
// see DECISIONS.md. Zero API cost: research happens outside the app; this
// script only writes already-collected CSV data into the database.
//
// Per-field confidence routing (the whole point of this script):
//   high         -> written directly onto the entity's structured column,
//                   same non-clobbering rule as every other writer in this
//                   codebase (never overwrites a field that already has a
//                   value, human-entered or otherwise).
//   medium / low -> NOT written directly. Inserted as a pending
//                   `contributions` row (source:'ai', status:'submitted')
//                   via the exact same mechanism contribution-promotion.ts
//                   already uses for AI-web-search proposals — so it shows
//                   up in ContributionBox's existing Accept/Reject UI with
//                   its source_url/evidence attached, no new UI needed.
//   not found    -> no-op. Field stays empty. No confidence, no ambiguity.
//
// Two CSV shapes, auto-detected from the header:
//   v2.1 ("First Check Min_confidence" present) — entity-CREATION pass,
//     same field mapping as the three prior batch imports, except First/
//     Follow-on Check Min/Max, AUM, Current Fund(s), Latest Fund, and Last
//     Investment Found are confidence-routed instead of blind-written or
//     dumped into notes. Follow-on Min/Max has no dedicated schema column
//     (out of scope per the founder's own field list) — it still has
//     nowhere to be *written*, confidence-routed or not, so it stays in
//     `notes` exactly as in the prior three batches.
//   v3.1 ("Street_confidence" present) — entity-UPDATE-only pass: matches
//     each row to an EXISTING entity by normalized firm name (the same
//     dedup key used for creation), and confidence-routes just its six
//     contact fields (Street->address, Postal Code, Email, Phone, Key
//     People, General Partner Emails). Never creates a new entity — a row
//     that doesn't match anything existing is reported, not inserted.
//     LinkedIn has no confidence field in v3.1 and no entity-level column
//     either (only Person.linkedin_url exists) — flagged in the report,
//     not written anywhere.
//
// Safe by default: dry-run unless --commit is passed. Same guard as the
// prior three batch-import scripts (whose real bug was that the OLD
// opt-in `--dry-run` flag meant any other invocation wrote for real).
import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG_ID = 'bca54499-03c8-469b-a48d-b9f442e44f69';

const CSV_PATH = process.argv[2];
const COMMIT = process.argv.includes('--commit');
if (!CSV_PATH || CSV_PATH.startsWith('--')) {
  console.error('Usage: node scripts/import-confidence-routed.mjs <path-to-csv> [--commit]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvText = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const [header, ...rawRows] = parseCsv(csvText);
const rows = rawRows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
console.log(`Parsed ${rows.length} data rows from ${CSV_PATH}.`);

const IS_V21 = header.includes('First Check Min_confidence');
const IS_V31 = header.includes('Street_confidence');
if (!IS_V21 && !IS_V31) {
  console.error('Could not detect CSV shape — expected either "First Check Min_confidence" (v2.1) or "Street_confidence" (v3.1) in the header.');
  process.exit(1);
}
console.log(`Detected shape: ${IS_V21 ? 'v2.1 (entity creation)' : 'v3.1 (entity update, contact fields only)'}`);

const LEGAL_SUFFIXES = /\b(inc|incorporated|ltd|llc|lda|sa|gmbh|scr|capital|ventures|partners|vc|fund|group|co)\b/g;
function normalizeName(name) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(LEGAL_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeDomain(url) {
  if (!url) return null;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProto).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch { return null; }
}
const na = (v) => (!v || v.toLowerCase() === 'not found' ? undefined : v);

// entity-enrichment.ts's coercion logic, inlined (plain Node has no TS loader
// here) — kept in sync with src/lib/entity-enrichment.ts by hand; the real
// module is what the app ships and what's unit-tested.
const NUMERIC_FIELDS = new Set(['check_min_eur', 'check_max_eur']);
function coerceValue(field, raw) {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (NUMERIC_FIELDS.has(field)) {
    if (trimmed.includes('-')) return undefined;
    const n = Number(trimmed.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return trimmed;
}
function entityHasValue(entity, field) {
  const v = entity[field];
  if (Array.isArray(v)) return v.length > 0;
  return v != null && v !== '';
}

const CONFIDENCE_NUMERIC = { medium: 0.6, low: 0.35 };

// The core routing decision for one (field, rawValue, confidence) triple
// against one entity. Returns a tagged result the caller applies (direct
// write) or collects (pending contribution) or ignores (empty/skipped).
function routeField(entity, entityField, rawValue, confidence, sourceUrl, evidence) {
  const value = na(rawValue);
  if (!value) return { action: 'empty' };
  if (entityHasValue(entity, entityField)) return { action: 'skipped_already_set' };
  const conf = (confidence || '').toLowerCase();
  if (conf === 'high') {
    const coerced = coerceValue(entityField, value);
    if (coerced === undefined) return { action: 'empty' }; // fails to coerce -> dropped, not guessed
    return { action: 'direct', field: entityField, value: coerced };
  }
  if (conf === 'medium' || conf === 'low') {
    return {
      action: 'pending',
      field: entityField, value,
      confidence: CONFIDENCE_NUMERIC[conf],
      source_url: sourceUrl || undefined,
      note: evidence ? `External research import (${IS_V21 ? 'v2.1' : 'v3.1'}), confidence ${conf}: "${evidence}"` : `External research import (${IS_V21 ? 'v2.1' : 'v3.1'}), confidence ${conf}.`,
    };
  }
  // No/unrecognised confidence value on a non-empty field — should not
  // happen for a confidence-tracked column; treat conservatively as empty
  // rather than guessing which bucket it belongs in.
  return { action: 'empty' };
}

const STAGE_VALUES = ['pre_seed', 'seed', 'series_a', 'later'];
const STAGE_MAP = { 'pre-seed': 'pre_seed', seed: 'seed', 'series a': 'series_a', 'series b': 'later', growth: 'later' };
function mapStageRange(stageFocusRaw) {
  if (!stageFocusRaw) return { min: undefined, max: undefined };
  const tokens = stageFocusRaw.split(';').map((t) => t.trim().toLowerCase());
  const mapped = tokens.map((t) => STAGE_MAP[t]).filter(Boolean);
  if (!mapped.length) return { min: undefined, max: undefined };
  const order = (s) => STAGE_VALUES.indexOf(s);
  return { min: mapped.reduce((a, b) => (order(b) < order(a) ? b : a)), max: mapped.reduce((a, b) => (order(b) > order(a) ? b : a)) };
}
const TYPE_MAP = {
  'vc fund': 'vc', 'corporate vc': 'corporate_vc', 'public venture investor': 'public_body',
  'angel network': 'angel_network', 'university venture investor': 'public_body',
  'venture studio': 'accelerator', other: 'family_office', 'family office': 'family_office',
};

const counts = { direct: 0, pending: 0, empty: 0, skipped_already_set: 0, non_eur_to_notes: 0 };
const pendingContributions = [];
const directWritesByEntityId = new Map(); // entity id -> {field: value} patch, batched per entity
const unmatchedV31 = [];
const entitiesToCreate = [];

if (IS_V21) {
  // Confidence-tracked field groups: CSV column -> {entityField, isNumericEurGate}
  // isNumericEurGate: only route into the EUR-denominated column when Currency === EUR,
  // same discipline as the three prior batches — a non-EUR value has nowhere
  // structured to go under this rule and is left in notes untouched.
  const CONF_FIELDS_V21 = [
    { csv: 'First Check Min', entityField: 'check_min_eur', eurGated: true },
    { csv: 'First Check Max', entityField: 'check_max_eur', eurGated: true },
    { csv: 'AUM', entityField: 'aum', eurGated: false },
    { csv: 'Current Fund(s)', entityField: 'current_funds', eurGated: false },
    { csv: 'Latest Fund', entityField: 'latest_fund', eurGated: false },
    { csv: 'Last Investment Found', entityField: 'last_investment_found', eurGated: false },
  ];

  const { data: existing } = await admin.from('entities').select('id, name, website').eq('org_id', ORG_ID);
  const existingByName = new Map(), existingByDomain = new Map();
  for (const e of existing) {
    existingByName.set(normalizeName(e.name), e);
    const d = normalizeDomain(e.website);
    if (d) existingByDomain.set(d, e);
  }
  const seenInBatch = new Map();
  const skippedDup = [];
  const unmappedTypes = new Set();

  for (const row of rows) {
    const name = row['Firm Name'];
    const typeRaw = (row.Type || '').toLowerCase();
    if (!TYPE_MAP[typeRaw]) unmappedTypes.add(row.Type);
    const n = normalizeName(name);
    const d = normalizeDomain(na(row.Website));
    const match = existingByName.get(n) || (d ? existingByDomain.get(d) : undefined);
    if (match) { skippedDup.push({ name, against: match.name, reason: existingByName.get(n) ? 'name' : 'domain' }); continue; }
    if (seenInBatch.has(n)) { skippedDup.push({ name, against: seenInBatch.get(n), reason: 'name (within this CSV)' }); continue; }
    seenInBatch.set(n, name);

    const type = TYPE_MAP[typeRaw];
    const website = na(row.Website) ? `https://${row.Website.replace(/^https?:\/\//i, '')}` : undefined;
    const street = na(row.Street), postal = na(row['Postal Code']);
    const sectors = na(row['Sector Tags']) ? row['Sector Tags'].split(';').map((s) => s.trim()).filter(Boolean) : [];
    const geos = na(row['Investment Geography']) ? row['Investment Geography'].split(';').map((s) => s.trim()).filter(Boolean) : [];
    const { min: stage_min, max: stage_max } = mapStageRange(row['Stage Focus']);
    const currency = (row.Currency || '').toUpperCase();

    const entityDraft = {
      org_id: ORG_ID, name, type: type || 'vc',
      website, email_domain: normalizeDomain(na(row.Website)) || undefined,
      email: na(row.Email), phone: na(row.Phone),
      address: street, postal_code: postal,
      hq_city: na(row.City), hq_country: na(row.Country),
      invests_in_geographies: geos, sectors, stage_min, stage_max,
      thesis: na(row['Thesis Summary']), source_url: na(row.Sources),
      website_verified: false, email_domain_verified: false,
      submission_channel_type: 'unknown', hard_filter_status: 'not_applicable', status: 'not_contacted',
    };

    // Confidence-routed fields, applied against this not-yet-created draft:
    // "already has a value" can only mean "this row itself already filled
    // it" (a fresh entity has nothing else yet) — so a 'high'-confidence
    // value here always writes; medium/low still becomes a pending
    // contribution rather than being written straight into the new row,
    // exactly like an existing entity would get.
    const noteLines = [`Imported from ${CSV_PATH.split(/[\\/]/).pop()} dataset (${row['Unique ID']}).`];
    const rowPendingFields = [];
    for (const { csv, entityField, eurGated } of CONF_FIELDS_V21) {
      const raw = row[csv];
      const confidence = row[`${csv}_confidence`];
      const sourceUrl = row[`${csv}_source`];
      const evidence = row[`${csv}_evidence`];
      if (eurGated && currency !== 'EUR') {
        // No EUR-denominated column to route into regardless of confidence —
        // preserve in notes so the figure isn't silently lost, unrouted.
        // Counted separately from "empty" — this is a FOUND value, just one
        // with nowhere structured to go, not a genuine "not found".
        if (na(raw)) { noteLines.push(`${csv} (${currency || 'currency unstated'}): ${raw}${confidence ? ` [confidence: ${confidence}]` : ''}.`); counts.non_eur_to_notes++; }
        else counts.empty++;
        continue;
      }
      const result = routeField({}, entityField, raw, confidence, sourceUrl, evidence);
      if (result.action === 'direct') { entityDraft[result.field] = result.value; counts.direct++; }
      else if (result.action === 'pending') { rowPendingFields.push(result); counts.pending++; }
      else counts.empty++;
    }
    if (na(row['Follow-on Min']) || na(row['Follow-on Max'])) {
      noteLines.push(`Follow-on (${currency || 'currency unstated'}): ${na(row['Follow-on Min']) || '?'}–${na(row['Follow-on Max']) || '?'}.`);
    }
    if (na(row['Lead or Follow'])) noteLines.push(`Lead or follow: ${row['Lead or Follow']}.`);
    if (na(row['Year Founded'])) noteLines.push(`Founded: ${row['Year Founded']}.`);
    if (na(row['Portfolio Examples'])) noteLines.push(`Portfolio examples: ${row['Portfolio Examples']}.`);
    if (na(row['Exit Examples'])) noteLines.push(`Exit examples: ${row['Exit Examples']}.`);
    if (na(row['Key People'])) noteLines.push(`Key people: ${row['Key People']}.`);
    if (na(row.Active) && row.Active.toLowerCase() !== 'yes') noteLines.push(`Activity flag: ${row.Active}.`);
    if (na(row['Confidence Notes'])) noteLines.push(row['Confidence Notes']);
    entityDraft.notes = noteLines.join(' ');

    entitiesToCreate.push({ draft: entityDraft, pendingFields: rowPendingFields });
  }

  console.log(`\nTo create: ${entitiesToCreate.length}. Skipped as duplicates: ${skippedDup.length}.`);
  if (unmappedTypes.size) console.log('Type values with no explicit mapping (fell back to "vc"):', [...unmappedTypes]);
  console.log('\n--- confidence routing (First/Follow-on Check, AUM, Current/Latest Fund, Last Investment Found) ---');
  console.log(`direct (high): ${counts.direct}   pending (medium/low): ${counts.pending}   empty/not found: ${counts.empty}   found but non-EUR (kept in notes only): ${counts.non_eur_to_notes}`);
  console.log('\n--- sample of first 2 entity drafts ---');
  console.log(JSON.stringify(entitiesToCreate.slice(0, 2), null, 2));
  console.log('\n--- skipped duplicates ---');
  console.log(JSON.stringify(skippedDup, null, 2));

  if (!COMMIT) { console.log('\nDry run only — nothing written. Re-run with --commit to apply.'); process.exit(0); }

  for (const { draft, pendingFields } of entitiesToCreate) {
    const { data: inserted, error } = await admin.from('entities').insert(draft).select('id').single();
    if (error) { console.error('insert failed for', draft.name, error.message); continue; }
    for (const p of pendingFields) {
      pendingContributions.push({
        subject_type: 'entity', subject_id: inserted.id, org_id: ORG_ID,
        field: p.field, value: p.value, source: 'ai', confidence: p.confidence,
        source_url: p.source_url, note: p.note, status: 'submitted',
      });
    }
  }
} else {
  // v3.1 — update-only pass against EXISTING entities, matched by name.
  const { data: existing } = await admin.from('entities').select('*').eq('org_id', ORG_ID);
  const existingByName = new Map();
  for (const e of existing) existingByName.set(normalizeName(e.name), e);

  const CONF_FIELDS_V31 = [
    { csv: 'Street', entityField: 'address' },
    { csv: 'Postal Code', entityField: 'postal_code' },
    { csv: 'Email', entityField: 'email' },
    { csv: 'Phone', entityField: 'phone' },
    { csv: 'Key People', entityField: 'key_people' },
    { csv: 'General Partner Emails', entityField: 'general_partner_emails' },
  ];

  for (const row of rows) {
    const name = row['Firm Name'];
    const entity = existingByName.get(normalizeName(name));
    if (!entity) { unmatchedV31.push(name); continue; }
    const rowSourceUrl = row.Sources; // v3.1 has no per-field _source column — falls back to the row's own Sources list
    const patch = {};
    for (const { csv, entityField } of CONF_FIELDS_V31) {
      const raw = row[csv];
      const confidence = row[`${csv}_confidence`];
      const result = routeField(entity, entityField, raw, confidence, rowSourceUrl, undefined);
      if (result.action === 'direct') { patch[result.field] = result.value; entity[result.field] = result.value; counts.direct++; }
      else if (result.action === 'pending') {
        pendingContributions.push({
          subject_type: 'entity', subject_id: entity.id, org_id: ORG_ID,
          field: result.field, value: result.value, source: 'ai', confidence: result.confidence,
          source_url: result.source_url, note: result.note, status: 'submitted',
        });
        counts.pending++;
      } else if (result.action === 'skipped_already_set') counts.skipped_already_set++;
      else counts.empty++;
    }
    // LinkedIn: no confidence field in v3.1, no entity-level column either —
    // flagged, never written.
    if (Object.keys(patch).length) directWritesByEntityId.set(entity.id, patch);
  }

  console.log(`\nMatched ${directWritesByEntityId.size + [...existingByName.values()].filter((e) => pendingContributions.some((p) => p.subject_id === e.id)).length} of ${rows.length} rows to existing entities. Unmatched (no direct/pending change and no existing entity found): ${unmatchedV31.length}.`);
  console.log('\n--- confidence routing (Street/Postal/Email/Phone/Key People/GP Emails) ---');
  console.log(`direct (high): ${counts.direct}   pending (medium/low): ${counts.pending}   already-set (skipped, non-clobber): ${counts.skipped_already_set}   empty/not found: ${counts.empty}`);
  if (unmatchedV31.length) console.log('\n--- unmatched firm names (not found in DB — no entity to update) ---\n' + JSON.stringify(unmatchedV31, null, 2));
  console.log('\n--- sample of first 3 direct-write patches ---');
  console.log(JSON.stringify([...directWritesByEntityId.entries()].slice(0, 3), null, 2));
  console.log('\n--- sample of first 3 pending contributions ---');
  console.log(JSON.stringify(pendingContributions.slice(0, 3), null, 2));

  if (!COMMIT) { console.log('\nDry run only — nothing written. Re-run with --commit to apply.'); process.exit(0); }

  for (const [id, patch] of directWritesByEntityId) {
    const { error } = await admin.from('entities').update(patch).eq('id', id);
    if (error) console.error('update failed for', id, error.message);
  }
}

if (COMMIT && pendingContributions.length) {
  const { error } = await admin.from('contributions').insert(pendingContributions);
  if (error) console.error('contributions insert failed', error.message);
}

if (COMMIT) {
  const report = { counts, pendingContributionsCount: pendingContributions.length, unmatchedV31 };
  writeFileSync(new URL(`./import-confidence-routed_${Date.now()}_report.json`, import.meta.url), JSON.stringify(report, null, 2));
  console.log('\nDone. Report written.');
}
