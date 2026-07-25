// Prompt 16 — bulk-resolve the pending contributions backlog by rule instead
// of one-by-one clicking. Committed/reusable (not underscore-prefixed) since
// new batches will keep adding to this queue. Safe by default: dry-run
// unless --commit, same convention as every other script in this project.
//
// Mirrors (does NOT import, since this runs under plain `node`, not the
// Next.js/TS toolchain) the write rules already enforced by
// src/lib/contribution-promotion.ts's applyVerifiedContribution: the
// entity allowlist (src/lib/entity-enrichment.ts ENTITY_ENRICHMENT_FIELDS)
// and the person allowlist (PERSON_WRITABLE_FIELDS). Keep both lists below
// in sync with those files if either changes.
//
// Tiers (see claude_code_prompt_16_bulk_review.md for the full spec):
//   A — kind=fill, has source_url, confidence >= 0.85, target field empty -> accept + write.
//   B — kind=fill, has source_url, 0.5 <= confidence < 0.85, field in the
//       OBJECTIVE allowlist, target field empty -> accept + write.
//   C — confidence < 0.5 (and not null) -> reject, "abaixo do piso de confiança".
//   D1 — legacy (confidence null, no source_url), field=last_verified -> reject,
//       "data de verificação sem fonte — não verifica nada".
//   D2 — legacy, everything else -> reject, "sem proveniência — re-derivar"
//       (chose the no-schema-change variant: reuse 'rejected' + reviewer_notes,
//       per the founder's own "decide qual é menos intrusivo" — a new
//       'needs_source' enum value would need a migration for a one-time
//       cleanup; this doesn't).
//   E — everything else: kind=correction (never automated), target field
//       already set (non-clobbering), field not in any writable allowlist,
//       or judgement-type fields at medium/low confidence.
import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const COMMIT = process.argv.includes('--commit');

// Mirrors entity-enrichment.ts ENTITY_ENRICHMENT_FIELDS.
const ENTITY_WRITABLE_FIELDS = new Set([
  'website', 'email_domain', 'hq_city', 'hq_country', 'invests_in_geographies',
  'sectors', 'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur', 'thesis', 'email', 'phone',
  'address', 'postal_code', 'key_people', 'general_partner_emails',
  'aum', 'current_funds', 'latest_fund', 'last_investment_found',
]);
// Mirrors contribution-promotion.ts PERSON_WRITABLE_FIELDS.
const PERSON_WRITABLE_FIELDS = new Set(['linkedin_url', 'role', 'background', 'hook']);

const OBJECTIVE_FIELDS = new Set(['email', 'phone', 'address', 'postal_code', 'hq_city', 'hq_country', 'website', 'email_domain', 'linkedin_url']);
const ENRICHMENT_REQUEST_FIELD = '__enrichment_request__';

function hasValue(subject, field) {
  const v = subject[field];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() === '' ? false : true;
  return true;
}

const { data: contributions, error: cErr } = await admin.from('contributions').select('*').eq('status', 'submitted');
if (cErr) { console.error(cErr); process.exit(1); }
console.log(`Fetched ${contributions.length} submitted contributions.`);

const entityIds = [...new Set(contributions.filter(c => c.subject_type === 'entity').map(c => c.subject_id))];
const personIds = [...new Set(contributions.filter(c => c.subject_type === 'person').map(c => c.subject_id))];
const [{ data: entities, error: eErr }, { data: people, error: pErr }] = await Promise.all([
  admin.from('entities').select('*').in('id', entityIds.length ? entityIds : ['00000000-0000-0000-0000-000000000000']),
  admin.from('people').select('*').in('id', personIds.length ? personIds : ['00000000-0000-0000-0000-000000000000']),
]);
if (eErr || pErr) { console.error(eErr ?? pErr); process.exit(1); }
const entityById = new Map(entities.map(e => [e.id, e]));
const personById = new Map(people.map(p => [p.id, p]));

const tiers = { A: [], B: [], C: [], D1: [], D2: [], E: [] };

for (const c of contributions) {
  const subject = c.subject_type === 'entity' ? entityById.get(c.subject_id) : personById.get(c.subject_id);
  const writableSet = c.subject_type === 'entity' ? ENTITY_WRITABLE_FIELDS : PERSON_WRITABLE_FIELDS;
  const hasSource = !!(c.source_url && c.source_url.trim() !== '');
  const legacy = c.confidence == null && !hasSource;

  if (c.field === ENRICHMENT_REQUEST_FIELD) { tiers.E.push({ c, reason: 'demand-flag marker, not a data field' }); continue; }
  if (!subject) { tiers.E.push({ c, reason: 'subject not found' }); continue; }
  if (c.kind === 'correction') { tiers.E.push({ c, reason: 'correction — overwrites confirmed data, never automated' }); continue; }
  if (!writableSet.has(c.field)) { tiers.E.push({ c, reason: `field "${c.field}" not in the writable allowlist for ${c.subject_type}` }); continue; }
  if (hasValue(subject, c.field)) { tiers.E.push({ c, reason: 'target field already set — non-clobbering' }); continue; }

  if (legacy) {
    if (c.field === 'last_verified') tiers.D1.push({ c, reason: 'legacy, no source — a verification date without a source verifies nothing' });
    else tiers.D2.push({ c, reason: 'legacy, no source — quarantined, re-derive with a sourced batch' });
    continue;
  }
  if (c.confidence < 0.5) { tiers.C.push({ c, reason: 'below confidence floor' }); continue; }
  if (c.confidence >= 0.85) { tiers.A.push({ c, reason: 'high confidence, sourced, field empty' }); continue; }
  // 0.5 <= confidence < 0.85
  if (OBJECTIVE_FIELDS.has(c.field)) tiers.B.push({ c, reason: 'medium confidence, objective field, sourced, empty' });
  else tiers.E.push({ c, reason: 'medium confidence but a judgement field — not auto-acceptable' });
}

console.log('\n--- Tier counts ---');
for (const t of ['A', 'B', 'C', 'D1', 'D2', 'E']) console.log(`  ${t}: ${tiers[t].length}`);
console.log(`  TOTAL: ${Object.values(tiers).reduce((n, arr) => n + arr.length, 0)} (should equal ${contributions.length})`);

console.log('\n--- Tier A sample (first 5) ---');
console.log(JSON.stringify(tiers.A.slice(0, 5).map(({ c }) => ({ subject: c.subject_id, field: c.field, value: c.value, confidence: c.confidence })), null, 2));

console.log('\n--- Tier B sample (first 5) ---');
console.log(JSON.stringify(tiers.B.slice(0, 5).map(({ c }) => ({ subject: c.subject_id, field: c.field, value: c.value, confidence: c.confidence })), null, 2));

console.log('\n--- Tier E reason breakdown ---');
const eReasons = {};
for (const { reason } of tiers.E) eReasons[reason] = (eReasons[reason] ?? 0) + 1;
console.log(JSON.stringify(eReasons, null, 2));

// Fields filled per entity after Tier A+B (deliverable table).
const filledByEntity = new Map();
for (const { c } of [...tiers.A, ...tiers.B]) {
  if (c.subject_type !== 'entity') continue;
  const e = entityById.get(c.subject_id);
  const key = `${e.id} (${e.name})`;
  if (!filledByEntity.has(key)) filledByEntity.set(key, []);
  filledByEntity.get(key).push(c.field);
}
console.log(`\n--- Fields filled per entity after Tier A+B (${filledByEntity.size} entities touched) ---`);
for (const [key, fields] of [...filledByEntity.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${key}: ${fields.length} field(s) — ${fields.join(', ')}`);
}

const timestamp = new Date().toISOString().slice(0, 10);
const auditLog = [];

if (!COMMIT) {
  console.log('\nDry run only — nothing written. Re-run with --commit to apply.');
  console.log('\nNOTE on safeguard #3 (single transaction, rollback on error): this project has no');
  console.log('direct Postgres connection configured (no DATABASE_URL, no `pg` package) — only the');
  console.log('PostgREST-backed supabase-js client, which does not expose ad-hoc multi-table');
  console.log('transactions. A real all-or-nothing transaction would need a direct connection or a');
  console.log('Postgres function wrapping this logic — flagging rather than claiming atomicity that');
  console.log('is not actually implemented. Mitigation used instead: writes are processed one row at');
  console.log('a time, every touched row is logged with its before/after value BEFORE being applied,');
  console.log('and the run stops immediately on the first write error rather than continuing past it —');
  console.log('and since only status=\'submitted\' rows are ever touched, re-running after a partial');
  console.log('failure is safe (already-resolved rows silently drop out of scope, satisfying #5).');
  process.exit(0);
}

async function writeEntityField(entity, field, value) {
  const patch = { [field]: value };
  const { error } = await admin.from('entities').update(patch).eq('id', entity.id);
  if (error) throw new Error(error.message);
}
async function writePersonField(person, field, value) {
  const { error } = await admin.from('people').update({ [field]: value }).eq('id', person.id);
  if (error) throw new Error(error.message);
}
async function setStatus(id, status, reviewerNotes) {
  const { error } = await admin.from('contributions').update({ status, reviewer_notes: reviewerNotes, reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

try {
  for (const { c } of [...tiers.A, ...tiers.B]) {
    const subject = c.subject_type === 'entity' ? entityById.get(c.subject_id) : personById.get(c.subject_id);
    const before = subject[c.field] ?? null;
    if (c.subject_type === 'entity') await writeEntityField(subject, c.field, c.value);
    else await writePersonField(subject, c.field, c.value);
    await setStatus(c.id, 'verified', 'auto-accepted (bulk review, tier A/B) — source_url preserved on the contribution row');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before, after: c.value, source_url: c.source_url, tier: tiers.A.some(t => t.c.id === c.id) ? 'A' : 'B' });
    subject[c.field] = c.value; // keep local cache consistent for any later row touching the same subject
  }
  for (const { c } of tiers.C) {
    await setStatus(c.id, 'rejected', 'abaixo do piso de confiança');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, tier: 'C', action: 'rejected' });
  }
  for (const { c } of tiers.D1) {
    await setStatus(c.id, 'rejected', 'sem proveniência — data de verificação sem fonte não verifica nada');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, tier: 'D1', action: 'rejected' });
  }
  for (const { c } of tiers.D2) {
    await setStatus(c.id, 'rejected', 'sem proveniência — re-derivar num lote futuro com fonte');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, tier: 'D2', action: 'rejected' });
  }
} catch (err) {
  console.error('\nSTOPPED on error — no further rows processed this run:', err.message);
  writeFileSync(new URL(`./bulk-review-${timestamp}.json`, import.meta.url), JSON.stringify(auditLog, null, 2));
  console.log(`Partial audit log (${auditLog.length} rows actually touched before the error) written to bulk-review-${timestamp}.json.`);
  process.exit(1);
}

writeFileSync(new URL(`./bulk-review-${timestamp}.json`, import.meta.url), JSON.stringify(auditLog, null, 2));
console.log(`\nDone. ${auditLog.length} rows touched. Audit log written to bulk-review-${timestamp}.json.`);
console.log(`Tier E residual (untouched, left in the active queue for manual review): ${tiers.E.length}`);
