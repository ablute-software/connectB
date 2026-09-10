// Prompt 879 (path 1) — promote the free-text catalog_entities.key_people of
// the delivered dead-ends into structured catalog_people + affiliations.
//
// 239 of the 554 investors delivered before the 3 Sept reachable-contact
// rule already carry contact names in key_people, written as free text and
// never turned into rows. This is the H14/BuenaVista pattern: a parsing pass,
// not an enrichment sweep — no API, no model, allowed under the 645 spend
// freeze. It does NOT add LinkedIn or a hook, so a promoted person is still
// not "reachable" by the platform's own rule; what it buys is that the
// founder's readiness strip stops saying "0 people" and a future enrichment
// (once the freeze lifts) has real person rows to attach a LinkedIn/hook to.
//
// Scope: catalog entities that (a) are not test, (b) have key_people text,
// (c) were delivered to a real org, and (d) have no reachable person today.
// Dedupe by a folded name key per entity, so an entity that already has some
// structured people is never given a duplicate.
//
//   node scripts/promote-key-people.mjs            # dry run (default): parse + report, write nothing
//   node scripts/promote-key-people.mjs --commit   # apply
//
// Dry run by default, same convention as import-investor-base.mjs.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(2); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes('--commit');

const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'van', 'von', 'der', 'den', 'di', 'du', 'la', 'le', 'del', 'e', "d'", 'of', 'and', 'ter', 'ten', 'af']);

// Fold to a comparison key: diacritics dropped, lowercased, punctuation → space.
function nameKey(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// A parsed token is a person name, not a title or a sentence fragment.
function looksLikeName(name) {
  if (!name) return false;
  if (name.length < 2 || name.length > 60) return false;
  if (/\d/.test(name)) return false;
  if (/[,:;/]/.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  // Every word is either a known lowercase particle or begins with an
  // uppercase letter (diacritics folded first so "Óscar"/"Émile" count).
  return words.every((w) => PARTICLES.has(w.toLowerCase()) || /^[A-Z]/.test(w.normalize('NFD').replace(/\p{M}/gu, '')));
}

// The two formats seen in the data:
//   "Name – Title | Name – Title | …"   (pipe + en/em-dash or hyphen)
//   "Name (Title); Name (Title); …"     (semicolon + parenthetical)
function parseKeyPeople(blob) {
  return blob
    .split(/\s*[|;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      let m = entry.match(/^(.+?)\s*\((.+)\)\s*$/);
      if (m) return { name: m[1].trim(), title: m[2].trim() };
      m = entry.match(/^(.+?)\s+[–—-]\s+(.+)$/);
      if (m) return { name: m[1].trim(), title: m[2].trim() };
      return { name: entry.trim(), title: null };
    })
    .filter((p) => looksLikeName(p.name));
}

async function main() {
  // The 239 are: delivered to a real org, no reachable person, key_people
  // present. Pulled with three cheap queries and intersected in code (the
  // dead-end predicate is a pair of NOT EXISTS joins that PostgREST cannot
  // express in one select).

  // 1) entities that are not test and have key_people text
  const { data: withKP, error: e1 } = await admin
    .from('catalog_entities')
    .select('id, name, key_people, website, is_test')
    .not('key_people', 'is', null);
  if (e1) { console.error('fetch key_people entities failed:', e1.message); process.exit(1); }
  const candidates = (withKP ?? []).filter((c) => !c.is_test && (c.key_people ?? '').trim() !== '');

  // 2) which of them were delivered to a real org
  const ids = candidates.map((c) => c.id);
  const delivered = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: del } = await admin
      .from('catalog_deliveries')
      .select('catalog_id, orgs!inner(is_test, name)')
      .in('catalog_id', chunk);
    for (const d of del ?? []) {
      const o = d.orgs;
      if (o && !o.is_test && !/^zz-test-/i.test(o.name ?? '')) delivered.add(d.catalog_id);
    }
  }

  // 3) reachability via the platform's own catalog_has_reachable_person —
  // authoritative and immune to PostgREST's 1000-row response cap, which a
  // bulk affiliation fetch hits (300-entity chunks overflow it, drop people,
  // and a fund reachable by a dropped person reads as a dead end). Called
  // only for the delivered candidates, so at most a few hundred cheap calls.
  const deliveredCandidates = candidates.filter((c) => delivered.has(c.id));
  const targets = [];
  for (const c of deliveredCandidates) {
    const { data: reachable, error: re } = await admin.rpc('catalog_has_reachable_person', { p_catalog_id: c.id });
    if (re) { console.error('catalog_has_reachable_person failed for', c.id, re.message); process.exit(1); }
    if (!reachable) targets.push(c);
  }

  // Existing structured people per target, for dedupe and to know whether a
  // primary already exists. Small chunks (25 entities) stay well under the
  // 1000-row cap even for the firms with two dozen listed people.
  const existingByEntity = new Map(); // entity_id -> { names:Set, hasPrimary:bool }
  const rec = (id) => {
    let r = existingByEntity.get(id);
    if (!r) { r = { names: new Set(), hasPrimary: false }; existingByEntity.set(id, r); }
    return r;
  };
  const tids = targets.map((t) => t.id);
  for (let i = 0; i < tids.length; i += 25) {
    const chunk = tids.slice(i, i + 25);
    const { data: affs, error: ae } = await admin
      .from('catalog_person_affiliations')
      .select('entity_id, is_primary, catalog_people!inner(full_name)')
      .in('entity_id', chunk);
    if (ae) { console.error('affiliations fetch failed:', ae.message); process.exit(1); }
    for (const a of affs ?? []) {
      const r = rec(a.entity_id);
      if (a.catalog_people?.full_name) r.names.add(nameKey(a.catalog_people.full_name));
      if (a.is_primary) r.hasPrimary = true;
    }
  }

  const newPeople = [];
  const newAffs = [];
  const perEntity = [];
  for (const c of targets) {
    const rec = existingByEntity.get(c.id) ?? { names: new Set(), hasPrimary: false };
    const parsed = parseKeyPeople(c.key_people);
    const created = [];
    for (const person of parsed) {
      const key = nameKey(person.name);
      if (rec.names.has(key)) continue; // already structured
      rec.names.add(key);
      const personId = randomUUID();
      newPeople.push({
        id: personId, full_name: person.name, entity_id: c.id,
        hook_status: 'to_research', enrichment_status: 'pending',
        source_kind: 'firm_website', source_confidence: 'recorded', source_recorded_at: new Date().toISOString(),
      });
      // is_primary is a PER-PERSON flag (catalog_person_affiliations_one_primary):
      // a person's single affiliation is their primary. Each new person has
      // exactly one, so it is always their primary; the INSERT trigger forces
      // it back to false if the person somehow already had a primary, so true
      // is always safe. (NOT keyed on the entity — an entity may hold many
      // people who each mark it their primary, which is expected.)
      newAffs.push({ person_id: personId, entity_id: c.id, title: person.title, kind: 'other', current: true, is_primary: true });
      created.push({ name: person.name, title: person.title });
    }
    if (created.length) perEntity.push({ name: c.name, created });
  }

  console.log(`candidates with key_people (non-test): ${candidates.length}`);
  console.log(`  of those, delivered to a real org and dead-end (target set): ${targets.length}`);
  console.log(`people to create: ${newPeople.length}  across ${perEntity.length} entities`);
  console.log('\nsample (first 8 entities):');
  for (const e of perEntity.slice(0, 8)) {
    console.log(`\n  ${e.name} (${e.created.length})`);
    for (const p of e.created.slice(0, 6)) console.log(`    - ${p.name}${p.title ? ` — ${p.title}` : ''}`);
    if (e.created.length > 6) console.log(`    … +${e.created.length - 6} more`);
  }

  // False-positive scan: a token with no name/title separator that is really
  // a role label ("Investment Team") would pass looksLikeName. Flag any
  // created name whose words are all role/title words so it can be eyeballed.
  const ROLE_WORDS = /\b(partner|partners|director|manager|associate|principal|analyst|team|committee|advisor|advisors|counsel|officer|head|chief|founder|founders|ceo|cfo|cto|coo|president|chairman|controller|accountant|operations|finance|legal|compliance|investment|investments|ventures|capital|management|relations|general|senior|executive|managing|venture|geschaeftsfuehrer|geschäftsführer|conducting)\b/i;
  const suspicious = [];
  for (const e of perEntity) for (const p of e.created) {
    const words = p.name.split(/\s+/);
    if (words.every((w) => ROLE_WORDS.test(w)) || (!p.title && ROLE_WORDS.test(p.name) && words.length <= 3)) suspicious.push(`${e.name}: "${p.name}"`);
  }
  console.log(`\nsuspicious names (role-like, review): ${suspicious.length}`);
  for (const s of suspicious.slice(0, 30)) console.log(`  ${s}`);

  if (!COMMIT) { console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.'); return; }

  console.log('\n--commit: writing…');
  for (let i = 0; i < newPeople.length; i += 200) {
    const { error: pe } = await admin.from('catalog_people').insert(newPeople.slice(i, i + 200));
    if (pe) { console.error('catalog_people insert failed at', i, pe.message); process.exit(1); }
  }
  for (let i = 0; i < newAffs.length; i += 200) {
    const { error: ae } = await admin.from('catalog_person_affiliations').insert(newAffs.slice(i, i + 200));
    if (ae) { console.error('catalog_person_affiliations insert failed at', i, ae.message); process.exit(1); }
  }
  await admin.from('admin_audit_log').insert({
    admin_user_id: null, action: 'catalog_key_people_promoted', subject_type: 'catalog_entity', subject_id: null,
    detail: { prompt: '879', entities: perEntity.length, people_created: newPeople.length, source_kind: 'firm_website' },
  }).then(() => {}, (e) => console.error('audit insert failed (non-fatal):', e?.message));
  console.log(`done: ${newPeople.length} people + affiliations across ${perEntity.length} entities.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
