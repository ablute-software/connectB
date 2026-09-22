// Prompt 662 — one-off importer for enriquecimento_investidores_espanha_
// lote_03.xlsx (3 entities: Ship2B Ventures, Nara Capital, CRB Health Tech;
// 6 people; entity-level signals; sources; person content). Not repeatable
// like import-investor-base.mjs — the ENTIDADES sheet uses its own 75-
// column shape (English field names), not the EU/UK base's Portuguese one,
// so this script does its own mapping instead of feeding
// import_investor_base(). Reuses that function's own per-field machinery
// (catalog_entity_apply_field — same rank/blank/conflict rules, same
// admin_audit_log trail) rather than reimplementing it.
//
// Reads the sheets as pre-dumped JSON (openpyxl has no equivalent in this
// project's Node dependencies; the xlsx was dumped once via a Python
// script, see the session's own scratchpad) rather than parsing the
// original .xlsx here.
//
// §5 rules, applied:
//   1. NOT_PUBLIC / 2. CONFLICT / 3. CONDITIONAL — read from AUDITORIA_
//      CAMPOS's own per-field `status`, never inferred from a blank cell.
//      A mapped field whose audited status isn't FOUND is skipped on its
//      real column and, if it has a value at all, written to extra_facts
//      with that status instead — never silently dropped, never treated as
//      resolved. CRB's two CONFLICT fields (initial_ticket,
//      commercial_maturity) never reach check_min_eur/check_max_eur.
//   4. Never overwrite confirmed with blank — catalog_entity_apply_field's
//      own blank-fill rule; moot here since every row is brand new.
//   5. Not ready for contact — pipeline_status has no catalog_entities
//      column (it is a per-org pipeline concept); nothing here touches any
//      org's pipeline. Nothing here sets is_test or any outreach flag.
//   6. Bullnet / Invivo (RECHECK) are not in ENTIDADES at all — nothing to
//      exclude, they were never candidates for import.
//
// Deliberately NOT imported into this shared, multi-tenant catalog: FIT_
// ABLUTE, ACTIONABILITY, recommendation, hard_gates, next_action,
// comparable_differences, score_rationale's ablute-specific half, cleanup_
// action — one customer's own fit assessment of an investor, not a fact
// about the investor (catalog-entity-extra-facts.ts's own header explains
// why). They stay in the archived .xlsx, ablute_'s own record.
//
// Usage: node scripts/import-lote03-spain.mjs [--commit]
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { CATALOG_ENTITY_EXTRA_FACT_KEYS } from '../src/lib/catalog-entity-extra-facts.ts';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const COMMIT = process.argv.includes('--commit');
const BATCH = 'lote03_espanha_20260922';

const SCRATCH = 'C:\\Users\\nunom\\AppData\\Local\\Temp\\claude\\C--Users-nunom-Documents-projetos-Code-ConnectB\\d614c1e6-9ef8-4b8d-a299-e0602655bfbc\\scratchpad';
const loadSheet = (name) => JSON.parse(readFileSync(`${SCRATCH}\\lote03_${name}.json`, 'utf8')).records;

const entidades = loadSheet('ENTIDADES');
const pessoas = loadSheet('PESSOAS');
const sinais = loadSheet('SINAIS_ENTIDADE');
const fontes = loadSheet('FONTES');
const conteudos = loadSheet('CONTEUDO_PESSOAS');
const auditoria = loadSheet('AUDITORIA_CAMPOS');

const nn = (v) => (v === '' || v == null ? null : v);
const auditStatus = (entityName, field, personName = null) => {
  const row = auditoria.find((a) => a.entity === entityName && a.field === field
    && (personName ? a.person_name === personName : a.record_type === 'ENTITY'));
  return row?.status ?? null; // null = not audited at all (a process/meta field)
};

const COUNTRY = { 'Espanha': 'ES' };

// Nuno's own rule (662 §3): NOT_PUBLIC and CONFLICT are states, never
// collapsed into a bare null. A NOT_PUBLIC field legitimately has no raw
// value (nothing was found) — that is exactly the case this must still
// record, not skip.
const STATUS_MAP = { NOT_PUBLIC: 'not_public', CONFLICT: 'conflict', CONDITIONAL: 'conditional' };
function extraFact(raw, auditedStatus, evidenceAt, note = null) {
  return { value: raw ?? null, status: STATUS_MAP[auditedStatus] ?? 'known', source: null, checked_at: evidenceAt, note };
}

// field -> the name catalog_entity_apply_field expects (catalog_entity_field_column)
const DIRECT_FIELD_MAP = {
  canonical_url: 'website', general_email: 'email', phone: 'phone', address: 'address',
  pitch_form: 'submission_channel', submission_status: 'submission_channel_type',
  sectors: 'sectors', geography: 'geographies', aum: 'aum', fund_size: 'current_funds',
  vehicle: 'latest_fund', pitch_email: 'general_partner_emails',
};
const LEVEL = 'verified_by_admin'; // confidence_0_1 is 0.87-0.9 across all three — careful, sourced research, same tier import_investor_base gives its own "Confiança: Alta" rows

const report = { entities: [], people: [], sources: 0, skippedNoAuditOrNotFound: [] };

async function applyField(entityId, entityName, field, value, evidenceAt) {
  if (value == null) return;
  if (!COMMIT) { report.entities.at(-1).wouldApply.push({ field, value }); return; }
  const { data: ok, error } = await admin.rpc('catalog_entity_apply_field', {
    p_catalog_id: entityId, p_field: field, p_value: value, p_level: LEVEL, p_evidence_at: evidenceAt,
  });
  if (error) throw new Error(`${entityName}.${field}: ${error.message}`);
  if (!ok) report.entities.at(-1).blocked = [...(report.entities.at(-1).blocked ?? []), field];
}

for (const e of entidades) {
  const name = e.canonical_name;
  const entry = { name, wouldApply: [], extraFacts: {}, skippedConflict: [] };
  report.entities.push(entry);

  // -------------------------------------------------------------- create
  const [city, countryRaw] = (e.headquarters ?? '').split(',').map((s) => s.trim());
  const hqCountry = COUNTRY[countryRaw] ?? null;
  let entityId = null;
  if (COMMIT) {
    const { data: existing } = await admin.from('catalog_entities').select('id').eq('name', name).maybeSingle();
    if (existing) { entityId = existing.id; entry.reused = true; }
    else {
      const { data: created, error } = await admin.from('catalog_entities').insert({
        name, type: 'vc', verification_status: 'verified', catalog_status: 'verified',
        source: 'verified_import', verified_at: e.verified_at, is_test: false, enrichment_status: 'pending',
        verified_fields: {},
      }).select('id').single();
      if (error) throw new Error(`create ${name}: ${error.message}`);
      entityId = created.id;
      await admin.from('admin_audit_log').insert({
        action: 'import_entity_created', subject_type: 'catalog_entity', subject_id: entityId,
        detail: { batch: BATCH, name },
      });
    }
  }
  entry.entityId = entityId;

  // ------------------------------------------------------- mapped fields
  for (const [srcField, destField] of Object.entries(DIRECT_FIELD_MAP)) {
    const status = auditStatus(name, srcField);
    if (status && status !== 'FOUND') {
      entry.skippedConflict.push({ field: srcField, status });
      entry.extraFacts[srcField] = extraFact(nn(e[srcField]), status, e.verified_at, `normally maps to ${destField}; not written there — see extra_facts instead`);
      continue;
    }
    let value = nn(e[srcField]);
    // ';' only, matching import_investor_base's own precedent — a ','
    // inside one sector/geography phrase ("Envelhecimento saudável,
    // qualidade de vida e clima") is common enough here that splitting on
    // it too would fragment a single item, not just separate real ones.
    if (destField === 'sectors' || destField === 'geographies') value = value ? value.split(/\s*;\s*/).filter(Boolean) : null;
    await applyField(entityId, name, destField, value, e.verified_at);
  }
  if (hqCountry) { await applyField(entityId, name, 'hq_city', city, e.verified_at); await applyField(entityId, name, 'hq_country', hqCountry, e.verified_at); }
  const thesis = [e.strategy, e.activity, e.criteria].filter(Boolean).join(' · ');
  if (thesis) await applyField(entityId, name, 'thesis', thesis, e.verified_at);
  const keyPeople = [e.best_person, e.second_person].filter(Boolean).join('; ');
  if (keyPeople) await applyField(entityId, name, 'key_people', keyPeople, e.verified_at);

  // stage + ticket: real destinations (stage_min/max, check_min/max_eur)
  // exist, but only via a word-list/numeric parse this script hasn't
  // verified against lote 03's own free text — parked in extra_facts
  // rather than guessing a mapping. initial_ticket also carries CRB's own
  // CONFLICT when that's its audited status (two sources disagree on the
  // range itself).
  if (e.stage) entry.extraFacts.stage = extraFact(e.stage, auditStatus(name, 'stage'), e.verified_at, 'free text — not parsed into stage_min/stage_max');
  if (e.initial_ticket) entry.extraFacts.initial_ticket = extraFact(e.initial_ticket, auditStatus(name, 'initial_ticket'), e.verified_at, 'free text — not parsed into check_min_eur/check_max_eur');

  // offices beyond the first -> notes, same precedent as
  // import_investor_base's own "other offices: ..." handling
  const officeList = (e.offices ?? '').split(/\s*;\s*/).filter(Boolean);
  if (officeList.length > 1 && COMMIT) {
    const note = `other offices: ${officeList.slice(1).join('; ')}`;
    await admin.from('catalog_entities').update({ notes: note }).eq('id', entityId);
  }

  // ------------------------------------------------------------ extra_facts
  for (const key of CATALOG_ENTITY_EXTRA_FACT_KEYS) {
    if (entry.extraFacts[key]) continue; // already set above (stage, initial_ticket, or a skipped mapped field)
    const raw = e[key];
    const status = auditStatus(name, key);
    if (raw == null && !status) continue; // never audited and nothing present — truly nothing to record
    entry.extraFacts[key] = extraFact(raw, status, e.verified_at);
  }
  if (COMMIT && Object.keys(entry.extraFacts).length) {
    const { data: cur } = await admin.from('catalog_entities').select('extra_facts').eq('id', entityId).single();
    const { error: updErr } = await admin.from('catalog_entities')
      .update({ extra_facts: { ...(cur?.extra_facts ?? {}), ...entry.extraFacts } }).eq('id', entityId);
    if (updErr) throw new Error(`${name} extra_facts: ${updErr.message}`);
  }

  // --------------------------------------------------------------- people
  const entityPeople = pessoas.filter((p) => p.entity_canonical_name === name);
  for (const p of entityPeople) {
    const pEntry = { name: p.person_name, entity: name };
    report.people.push(pEntry);
    let personId = null;
    if (COMMIT) {
      const { data: existingP } = await admin.from('catalog_people')
        .select('id').eq('entity_id', entityId).eq('full_name', p.person_name).maybeSingle();
      if (existingP) { personId = existingP.id; pEntry.reused = true; }
      else {
        const li = nn(p.linkedin_public);
        const { data: createdP, error } = await admin.from('catalog_people').insert({
          full_name: p.person_name, entity_id: entityId, linkedin_url: li, linkedin_verified: !!li,
          hook_status: 'to_research', source_kind: 'manual', source_url: nn(p.profile_url),
          source_confidence: 'recorded', source_recorded_at: p.verified_at,
        }).select('id').single();
        if (error) throw new Error(`create person ${p.person_name}: ${error.message}`);
        personId = createdP.id;
        await admin.from('admin_audit_log').insert({
          action: 'import_person_created', subject_type: 'catalog_person', subject_id: personId,
          detail: { batch: BATCH, entity_id: entityId, name: p.person_name },
        });
      }
    }
    pEntry.personId = personId;

    const title = nn(p.current_role);
    const kind = /partner/i.test(title ?? '') ? 'partner' : /principal/i.test(title ?? '') ? 'principal'
      : /associate|analyst/i.test(title ?? '') ? 'associate' : /advisor/i.test(title ?? '') ? 'advisor'
      : /chair|board/i.test(title ?? '') ? 'board_member' : 'other';
    if (COMMIT) {
      const { data: existingAff } = await admin.from('catalog_person_affiliations').select('id').eq('person_id', personId).eq('entity_id', entityId).maybeSingle();
      if (!existingAff) {
        await admin.from('catalog_person_affiliations').insert({
          person_id: personId, entity_id: entityId, title, kind, is_primary: true, current: true,
        });
      }
    }

    // background: same concat-only-if-blank precedent as import_investor_base
    const bg = [
      p.education && `Education: ${p.education}`,
      p.clinical_scientific_engineering_experience && `Experience: ${p.clinical_scientific_engineering_experience}`,
      p.previous_companies && `Previously: ${p.previous_companies}`,
      p.responsibilities && `Role: ${p.responsibilities}`,
    ].filter(Boolean).join(' · ') || null;
    if (COMMIT) {
      const { data: existingResearch } = await admin.from('catalog_people_research').select('person_id, background').eq('person_id', personId).maybeSingle();
      if (!existingResearch) {
        await admin.from('catalog_people_research').insert({ person_id: personId, background: bg, verified_fields: bg ? { background: LEVEL } : {} });
      } else if (bg && !existingResearch.background) {
        await admin.from('catalog_people_research').update({ background: bg, verified_fields: { background: LEVEL } }).eq('person_id', personId);
      }
    }
  }
}

// ----------------------------------------------------- entity-level signals
for (const s of sinais) {
  const entry = report.entities.find((r) => r.name === s.entity);
  if (!entry) continue;
  const supports = /fund_close|eligibility|investment_period/.test(s.category) ? 'thesis' : 'hook';
  report.sources += 1;
  if (!COMMIT || !entry.entityId) continue;
  const { data: exists } = await admin.from('catalog_entity_enrichment_sources')
    .select('id').eq('entity_id', entry.entityId).eq('source_url', s.source_url).maybeSingle();
  if (exists) continue;
  await admin.from('catalog_entity_enrichment_sources').insert({
    entity_id: entry.entityId, source_url: s.source_url, source_type: 'manual_research',
    quality: 'read_full_text', supports, verified_at: s.verified_at, published_at: s.date, batch_id: BATCH,
    notes: [s.factual_observation, s.practical_implication].filter(Boolean).join(' — '),
  });
}

// ------------------------------------------------------------------ fontes
for (const f of fontes) {
  const entry = report.entities.find((r) => r.name === f.entity);
  report.sources += 1;
  if (!COMMIT || !entry?.entityId) continue;
  const { data: exists } = await admin.from('catalog_entity_enrichment_sources')
    .select('id').eq('entity_id', entry.entityId).eq('source_url', f.source_url).maybeSingle();
  if (exists) continue;
  await admin.from('catalog_entity_enrichment_sources').insert({
    entity_id: entry.entityId, source_url: f.source_url, source_type: 'manual_research',
    quality: 'domain_verified_not_full_text_read', supports: 'thesis', verified_at: f.verified_at, batch_id: BATCH,
    notes: f.source_title,
  });
}

// -------------------------------------------------------- person content
for (const c of conteudos) {
  const entry = report.entities.find((r) => r.name === c.entity_canonical_name);
  const person = report.people.find((p) => p.name === c.person_name && p.entity === c.entity_canonical_name);
  report.sources += 1;
  if (!COMMIT || !entry?.entityId) continue;
  const { data: exists } = await admin.from('catalog_entity_enrichment_sources')
    .select('id').eq('entity_id', entry.entityId).eq('source_url', c.source_url).maybeSingle();
  if (exists) continue;
  await admin.from('catalog_entity_enrichment_sources').insert({
    entity_id: entry.entityId, person_id: person?.personId ?? null, source_url: c.source_url,
    source_type: 'manual_research', quality: 'read_full_text', supports: 'hook',
    verified_at: c.verified_at, published_at: c.publication_date, batch_id: BATCH,
    notes: [c.source_title, c.factual_summary].filter(Boolean).join(' — '),
  });
}

console.log(`batch ${BATCH} · ${COMMIT ? 'APPLY' : 'DRY RUN'}`);
console.log(JSON.stringify(report, null, 2));
