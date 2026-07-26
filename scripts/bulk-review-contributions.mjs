// Prompt 16/18 — bulk-resolve the pending contributions backlog by rule
// instead of one-by-one clicking. Committed/reusable (not underscore-
// prefixed) since new batches keep adding to this queue. Safe by default:
// dry-run unless --commit, same convention as every other script here.
//
// v2 (prompt 18): the founder's own safeguard #1 ("never overwrite a filled
// field, in any tier") was written for tiers that WRITE. Applying it as a
// blanket first-check ahead of the status-only tiers (reject-for-no-
// provenance, reject-for-low-confidence) meant those never fired for a row
// whose field happened to already be set — so the 117 legacy rows mostly
// fell straight back into the queue instead of being quarantined, defeating
// the point. Rule order now: unwritable field, then legacy quarantine, then
// confidence floor, then correction (always manual), and ONLY THEN does the
// field-already-set check apply — split into "duplicate" (reject, pure
// noise) vs "divergent" (leave for a human — this is either new information
// or a mis-tagged correction).
//
// Mirrors (does NOT import — this runs under plain `node`, not the Next/TS
// toolchain) src/lib/entity-enrichment.ts's ENTITY_ENRICHMENT_FIELDS and
// src/lib/contribution-promotion.ts's PERSON_WRITABLE_FIELDS. Keep in sync.
import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const COMMIT = process.argv.includes('--commit');

// Mirrors entity-enrichment.ts ENTITY_ENRICHMENT_FIELDS (now includes 'name',
// but 'name' is always forced to rule 8 below regardless of kind/confidence
// — see the dedicated check).
const ENTITY_WRITABLE_FIELDS = new Set([
  'website', 'email_domain', 'hq_city', 'hq_country', 'invests_in_geographies',
  'sectors', 'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur', 'thesis', 'email', 'phone',
  'address', 'postal_code', 'key_people', 'general_partner_emails',
  'aum', 'current_funds', 'latest_fund', 'last_investment_found', 'name',
]);
// Mirrors contribution-promotion.ts PERSON_WRITABLE_FIELDS.
const PERSON_WRITABLE_FIELDS = new Set(['linkedin_url', 'role', 'background', 'hook']);

const OBJECTIVE_FIELDS = new Set(['email', 'phone', 'address', 'postal_code', 'hq_city', 'hq_country', 'website', 'email_domain', 'linkedin_url']);
const ENRICHMENT_REQUEST_FIELD = '__enrichment_request__';

function hasValue(subject, field) {
  const v = subject[field];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

// Prompt 19, 5.1 — a URL differing only in scheme/www/trailing-slash is the
// same site, not a different fact.
const URL_FIELDS = new Set(['website', 'linkedin_url']);
function normalizeUrl(v) {
  return String(v).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

// Prompt 19, 5.2 — country alias/ISO-code normalization. Canonical form is
// fixed here as the full name (not the code) per the founder's explicit
// convention — this is deliberately asymmetric: a code proposed over an
// existing full name is a duplicate (reject), but a full name proposed over
// an existing code is a real improvement (lets it through to the normal
// tiers). Covers the countries this batch actually touched; extend as new
// countries show up rather than guessing ahead.
const COUNTRY_CANONICAL = {
  uk: 'United Kingdom', gb: 'United Kingdom', 'united kingdom': 'United Kingdom',
  pt: 'Portugal', portugal: 'Portugal',
  at: 'Austria', austria: 'Austria',
  de: 'Germany', germany: 'Germany',
  ch: 'Switzerland', switzerland: 'Switzerland',
  nl: 'Netherlands', netherlands: 'Netherlands',
  be: 'Belgium', belgium: 'Belgium',
  fr: 'France', france: 'France',
  ie: 'Ireland', ireland: 'Ireland',
  es: 'Spain', spain: 'Spain',
  it: 'Italy', italy: 'Italy',
};
function canonicalCountry(v) {
  const key = String(v).trim().toLowerCase();
  return COUNTRY_CANONICAL[key] ?? null;
}

function normalizeForCompare(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return JSON.stringify([...v].map((x) => String(x).trim().toLowerCase()).sort());
  if (typeof v === 'number') return String(v);
  return String(v).trim().toLowerCase();
}

// Returns true when `proposed` should be treated as a duplicate of
// `current` for this field — either byte-identical after generic
// normalization, or (for the two special-cased field types) the same fact
// written a different way. The country case is intentionally asymmetric:
// only a code-over-full-name proposal counts as a duplicate; the reverse
// is a legitimate improvement and must fall through to the normal tiers.
function isDuplicateValue(field, current, proposed) {
  if (normalizeForCompare(current) === normalizeForCompare(proposed)) return true;
  if (URL_FIELDS.has(field) && typeof current === 'string' && typeof proposed === 'string') {
    return normalizeUrl(current) === normalizeUrl(proposed);
  }
  if (field === 'hq_country' && typeof current === 'string' && typeof proposed === 'string') {
    const currentCanon = canonicalCountry(current);
    const proposedCanon = canonicalCountry(proposed);
    if (currentCanon && proposedCanon && currentCanon === proposedCanon) {
      // Same country. Duplicate only if the incumbent is already canonical
      // (full name) or the proposal is not an improvement over it.
      const currentIsCanonicalForm = current.trim() === currentCanon;
      const proposedIsCanonicalForm = proposed.trim() === proposedCanon;
      if (currentIsCanonicalForm) return true; // any alias/code proposed over the canonical form is a no-op
      if (!proposedIsCanonicalForm) return true; // code-over-code or alias-over-alias — no real improvement either
      return false; // current is a code/alias, proposed is the canonical full name — let it through
    }
  }
  return false;
}

// The lote4 exception (prompt 18, rule 7; widened prompt 21, rule 7b): a
// fund's own team/personnel page is authoritative about who works there —
// 0.7 confidence there is "might be stale," not "might be wrong." That
// reasoning doesn't depend on the URL slug being literally "/team", or on
// English — a European roster can't assume every fund's team page is
// named that. The domain gate (same host as entity.website) is what does
// the actual safety work; the slug only says what kind of page it is.
//
// Matched per PATH SEGMENT (not substring), so "/steam-engine" doesn't
// falsely match "team". A segment matches if it's an exact hit in
// TEAM_PAGE_SEGMENTS, or its last hyphen-joined word is team/people/teamet
// (covers fund-specific slugs like "venionaire-team", "borski-team") —
// EXCEPT a segment containing "contact" never matches even if it happens
// to end in "-team" ("/contact-our-team" is a contact page, not a team
// roster; caught explicitly rather than relying on the suffix rule alone).
// Homepage (no segments), pure contact/get-in-touch pages, national
// registry domains (excluded by the domain gate itself), and bare
// firm-name slugs all correctly fall through to no-match.
const TEAM_PAGE_SEGMENTS = new Set([
  'team', 'teams', 'our-team', 'our-people', 'the-team', 'meet-the-team', 'fund-team', 'leadership',
  'people', 'our-partners', 'partners', 'management', 'board', 'who-we-are',
  'equipe', 'equipa', 'notre-equipe', 'chi-siamo', 'il-team', 'das-team', 'unser-team', 'ueber-uns',
  'folk', 'vart-team', 'mot-teamet', 'om-oss', 'teamet', 'ons-team', 'het-team', 'wie-we-zijn',
]);
function looksLikeTeamPageSegment(segment) {
  if (TEAM_PAGE_SEGMENTS.has(segment)) return true;
  if (segment.includes('contact')) return false;
  return /(^|-)(team|people|teamet)$/.test(segment);
}
// source_url is sometimes a single URL, sometimes several joined by "; "
// (older batches cited multiple sources per field). Splitting explicitly
// and checking each one avoids the trap of `new URL()` silently absorbing
// every URL after the first into one long percent-encoded pathname, which
// would make ANY later-cited /team link falsely match regardless of which
// URL is actually first/primary.
function isOwnTeamPage(entity, sourceUrl) {
  if (!entity.website || !sourceUrl) return false;
  let siteHost;
  try { siteHost = new URL(entity.website).hostname.replace(/^www\./, ''); } catch { return false; }
  const candidates = sourceUrl.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const u = new URL(candidate);
      if (u.hostname.replace(/^www\./, '') !== siteHost) continue;
      const segments = u.pathname.toLowerCase().split('/').filter(Boolean);
      if (segments.some(looksLikeTeamPageSegment)) return true;
    } catch { /* not a parseable URL on its own — skip */ }
  }
  return false;
}

const { data: contributions, error: cErr } = await admin.from('contributions').select('*').eq('status', 'submitted');
if (cErr) { console.error(cErr); process.exit(1); }
console.log(`Fetched ${contributions.length} submitted contributions.`);

const entityIds = [...new Set(contributions.filter((c) => c.subject_type === 'entity').map((c) => c.subject_id))];
const personIds = [...new Set(contributions.filter((c) => c.subject_type === 'person').map((c) => c.subject_id))];
const [{ data: entities, error: eErr }, { data: people, error: pErr }] = await Promise.all([
  admin.from('entities').select('*').in('id', entityIds.length ? entityIds : ['00000000-0000-0000-0000-000000000000']),
  admin.from('people').select('*').in('id', personIds.length ? personIds : ['00000000-0000-0000-0000-000000000000']),
]);
if (eErr || pErr) { console.error(eErr ?? pErr); process.exit(1); }
const entityById = new Map(entities.map((e) => [e.id, e]));
const personById = new Map(people.map((p) => [p.id, p]));

// rule1..rule8 buckets, per prompt 18's corrected order.
const buckets = { rule1: [], rule2: [], rule3: [], rule4: [], rule5dup: [], rule5div: [], rule6: [], rule7: [], rule8: [] };

for (const c of contributions) {
  const subject = c.subject_type === 'entity' ? entityById.get(c.subject_id) : personById.get(c.subject_id);
  const writableSet = c.subject_type === 'entity' ? ENTITY_WRITABLE_FIELDS : PERSON_WRITABLE_FIELDS;
  const hasSource = !!(c.source_url && c.source_url.trim() !== '');
  const legacy = c.confidence == null && !hasSource;

  // Rule 1 — unwritable field (includes the demand-flag marker and any
  // field not in either allowlist). A contribution the system can never
  // apply isn't pending work, it's garbage — reject, don't quarantine.
  if (!subject || c.field === ENRICHMENT_REQUEST_FIELD || !writableSet.has(c.field)) {
    buckets.rule1.push({ c, reason: !subject ? 'subject not found' : c.field === ENRICHMENT_REQUEST_FIELD ? 'demand-flag marker, not a data field' : `field "${c.field}" not in the writable allowlist for ${c.subject_type}` });
    continue;
  }

  // 'name' is the dedup/matching key — never auto-applied regardless of
  // kind/confidence/emptiness. Always manual (rule 8's residual bucket).
  if (c.field === 'name') { buckets.rule8.push({ c, reason: "name is the entity dedup/matching key — always manual review, never auto-applied" }); continue; }

  // Rule 2 — legacy, no provenance at all. Status-only change (quarantine
  // reject), so it does NOT wait on the field-already-set check.
  if (legacy) { buckets.rule2.push({ c, reason: c.field === 'last_verified' ? 'legacy, no source — a verification date without a source verifies nothing' : 'legacy, no source — quarantined, re-derive with a sourced batch' }); continue; }

  // Rule 3 — below the confidence floor. Also status-only.
  if (c.confidence < 0.5) { buckets.rule3.push({ c, reason: 'below confidence floor' }); continue; }

  // Rule 4 — corrections always go to a human, never automated.
  if (c.kind === 'correction') { buckets.rule4.push({ c, reason: 'correction — overwrites confirmed data, never automated' }); continue; }

  // Rule 5 — field already has a value: duplicate (pure noise, reject) vs
  // divergent (new information contradicting the base, or a mis-tagged
  // correction — needs a human).
  if (hasValue(subject, c.field)) {
    if (isDuplicateValue(c.field, subject[c.field], c.value)) buckets.rule5dup.push({ c, reason: 'duplicado, sem alteração' });
    else buckets.rule5div.push({ c, reason: 'divergent from current value — possibly new info, possibly a mis-tagged correction' });
    continue;
  }

  // Rule 6 — Tier A: high confidence, sourced, field empty.
  if (c.confidence >= 0.85) { buckets.rule6.push({ c, reason: 'high confidence, sourced, field empty' }); continue; }

  // Rule 7 — Tier B: medium confidence, sourced, field empty, objective
  // field OR the lote4 key_people/team-page exception.
  if (OBJECTIVE_FIELDS.has(c.field) || (c.field === 'key_people' && c.subject_type === 'entity' && isOwnTeamPage(subject, c.source_url))) {
    buckets.rule7.push({ c, reason: OBJECTIVE_FIELDS.has(c.field) ? 'medium confidence, objective field, sourced, empty' : 'medium confidence, key_people sourced from the fund\'s own team page' });
    continue;
  }

  // Rule 8 — everything else: judgement fields at medium confidence.
  buckets.rule8.push({ c, reason: 'medium confidence but a judgement field — not auto-acceptable' });
}

console.log('\n--- Rule counts (1-8, first match wins) ---');
console.log(`  1 (unwritable field)          : ${buckets.rule1.length}`);
console.log(`  2 (legacy, no provenance)      : ${buckets.rule2.length}`);
console.log(`  3 (below confidence floor)     : ${buckets.rule3.length}`);
console.log(`  4 (correction, always manual)  : ${buckets.rule4.length}`);
console.log(`  5a (duplicate, no change)      : ${buckets.rule5dup.length}`);
console.log(`  5b (divergent, needs a human)  : ${buckets.rule5div.length}`);
console.log(`  6 (Tier A — auto-accept)       : ${buckets.rule6.length}`);
console.log(`  7 (Tier B — auto-accept)       : ${buckets.rule7.length}`);
console.log(`  8 (real residual — manual)     : ${buckets.rule8.length}`);
const total = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);
console.log(`  TOTAL: ${total} (should equal ${contributions.length})`);

const manualTotal = buckets.rule4.length + buckets.rule5div.length + buckets.rule8.length;
console.log(`\nManual residual (rule 4 + 5b + 8, left in the active queue): ${manualTotal}`);

// Diagnostic: how did rows from a specific batch (note text) resolve?
// Useful for checking a batch-specific expectation without conflating it
// with whatever residual carried over from earlier passes.
function tagBreakdown(tag) {
  const match = (arr) => arr.filter(({ c }) => (c.note ?? '').toLowerCase().includes(tag)).length;
  return { rule1: match(buckets.rule1), rule2: match(buckets.rule2), rule3: match(buckets.rule3), rule4: match(buckets.rule4), rule5a: match(buckets.rule5dup), rule5b: match(buckets.rule5div), rule6: match(buckets.rule6), rule7: match(buckets.rule7), rule8: match(buckets.rule8) };
}
for (const tag of ['lote4', 'lote5']) {
  const b = tagBreakdown(tag);
  const total = Object.values(b).reduce((n, v) => n + v, 0);
  const residual = b.rule4 + b.rule5b + b.rule8;
  if (total === 0) continue;
  console.log(`\n--- "${tag}"-tagged rows (${total} total): ${JSON.stringify(b)} — residual ${residual} ---`);
}

console.log('\n--- Rule 7 team-page exception matches ---');
console.log(JSON.stringify(buckets.rule7.filter((b) => b.reason.includes('team page')).map(({ c }) => ({ entity: entityById.get(c.subject_id)?.name, source_url: c.source_url })), null, 2));

console.log('\n--- Rule 5b (divergent) — the interesting bucket ---');
console.log(JSON.stringify(buckets.rule5div.map(({ c }) => {
  const subject = c.subject_type === 'entity' ? entityById.get(c.subject_id) : personById.get(c.subject_id);
  return { name: subject?.name ?? subject?.full_name, field: c.field, current: subject[c.field], proposed: c.value, confidence: c.confidence, source_url: c.source_url };
}), null, 2));

const timestamp = new Date().toISOString().slice(0, 10);
const auditLog = [];

if (!COMMIT) {
  console.log('\nDry run only — nothing written. Re-run with --commit to apply.');
  console.log('\nNOTE on transaction safety (unchanged from the prior version, per the founder\'s');
  console.log('own confirmation — no real Postgres transaction is available in this project, no');
  console.log('DATABASE_URL/`pg`): rows processed one at a time, before/after logged BEFORE each');
  console.log('write, run stops on first error. Idempotent because only status=\'submitted\' rows');
  console.log('are ever touched.');
  process.exit(0);
}

async function writeEntityField(entity, field, value) {
  const { error } = await admin.from('entities').update({ [field]: value }).eq('id', entity.id);
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
  for (const { c } of [...buckets.rule6, ...buckets.rule7]) {
    const subject = c.subject_type === 'entity' ? entityById.get(c.subject_id) : personById.get(c.subject_id);
    const before = subject[c.field] ?? null;
    if (c.subject_type === 'entity') await writeEntityField(subject, c.field, c.value);
    else await writePersonField(subject, c.field, c.value);
    await setStatus(c.id, 'verified', 'auto-accepted (bulk review) — source_url preserved on the contribution row');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before, after: c.value, source_url: c.source_url, rule: buckets.rule6.some((b) => b.c.id === c.id) ? 6 : 7, action: 'accepted' });
    subject[c.field] = c.value;
  }
  for (const { c } of buckets.rule1) {
    await setStatus(c.id, 'rejected', 'campo fora do allowlist');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, rule: 1, action: 'rejected' });
  }
  for (const { c } of buckets.rule2) {
    const note = c.field === 'last_verified' ? 'sem proveniência — data de verificação sem fonte não verifica nada' : 'sem proveniência — re-derivar num lote futuro com fonte';
    await setStatus(c.id, 'rejected', note);
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, rule: 2, action: 'rejected' });
  }
  for (const { c } of buckets.rule3) {
    await setStatus(c.id, 'rejected', 'abaixo do piso de confiança');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, rule: 3, action: 'rejected' });
  }
  for (const { c } of buckets.rule5dup) {
    await setStatus(c.id, 'rejected', 'duplicado, sem alteração');
    auditLog.push({ contribution_id: c.id, subject_type: c.subject_type, subject_id: c.subject_id, field: c.field, before: null, after: null, rule: '5a', action: 'rejected' });
  }
  // rules 4, 5b, 8 stay 'submitted' — no write, nothing to log as touched.
} catch (err) {
  console.error('\nSTOPPED on error — no further rows processed this run:', err.message);
  writeFileSync(new URL(`./bulk-review-${timestamp}.json`, import.meta.url), JSON.stringify(auditLog, null, 2));
  console.log(`Partial audit log (${auditLog.length} rows actually touched before the error) written to bulk-review-${timestamp}.json.`);
  process.exit(1);
}

writeFileSync(new URL(`./bulk-review-${timestamp}.json`, import.meta.url), JSON.stringify(auditLog, null, 2));
console.log(`\nDone. ${auditLog.length} rows touched. Audit log written to bulk-review-${timestamp}.json.`);
console.log(`Manual residual left in the active queue (rule 4 + 5b + 8): ${manualTotal}`);
