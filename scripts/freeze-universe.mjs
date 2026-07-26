import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Same registrable() as bulk-review-contributions.mjs. NOTE (flagged to the
// founder): this is NOT wave2/aggregate.py's registrable() — that file
// isn't available in this session. Reusing our own existing implementation
// (same one the domain gate already runs in production) rather than
// authoring a second, different one. Needs a diff against the Python
// version before this freeze is trusted; a single divergent ccTLD case
// silently corrupts the intersection.
const SECOND_LEVEL_CCTLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
  'co.no', 'co.nz', 'com.au', 'org.au', 'co.za', 'co.il', 'com.br', 'co.jp', 'co.kr', 'co.in',
]);
function registrable(hostname) {
  const labels = hostname.toLowerCase().replace(/^www\./, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const last2 = labels.slice(-2).join('.');
  if (SECOND_LEVEL_CCTLDS.has(last2) && labels.length >= 3) return labels.slice(-3).join('.');
  return last2;
}

const PLACEHOLDER_DOMAINS = new Set(['canva.com', 'mail.google.com', 'forms.gle']);

const { data: entities, error } = await admin.from('entities').select('id, name, hq_country, website');
if (error) { console.error(error); process.exit(1); }
console.log(`entities_total: ${entities.length}`);

const withDomain = [];
const noDomain = [];
for (const e of entities) {
  let host = null;
  if (e.website) { try { host = new URL(e.website).hostname.toLowerCase().replace(/^www\./, ''); } catch { host = null; } }
  const reg = host ? registrable(host) : null;
  if (!e.website || !reg) {
    noDomain.push({ entity_id: e.id, name: e.name, country: e.hq_country ?? '', reason: !e.website ? 'no_website' : 'unparseable_website' });
  } else if (PLACEHOLDER_DOMAINS.has(host) || PLACEHOLDER_DOMAINS.has(reg)) {
    noDomain.push({ entity_id: e.id, name: e.name, country: e.hq_country ?? '', reason: `placeholder_domain:${host}` });
  } else {
    withDomain.push({ id: e.id, name: e.name, domain: reg });
  }
}

// Alias domains from website-aliases.txt (the OLD-domain column, section
// letter unused here — every non-comment line contributes one old domain).
const aliasLines = readFileSync(new URL('./data/website-aliases.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const aliasDomains = new Set();
for (const line of aliasLines) {
  const parts = line.split('|');
  if (parts.length < 2) continue;
  aliasDomains.add(parts[1].trim().toLowerCase());
}
console.log(`alias_domains (from website-aliases.txt, non-comment lines): ${aliasDomains.size}`);

const domainSet = new Set([...withDomain.map((e) => e.domain), ...aliasDomains]);
const sortedDomains = [...domainSet].sort();

// Entities sharing a registrable domain (own-domain population only, not
// counting aliases, which are expected to collide with an entity's own
// domain by definition).
const byDomain = new Map();
for (const e of withDomain) { if (!byDomain.has(e.domain)) byDomain.set(e.domain, []); byDomain.get(e.domain).push(e); }
const shared = [...byDomain.entries()].filter(([, list]) => list.length > 1);

const universeDomainsTxt = sortedDomains.join('\n') + '\n';
const noDomainCsvLines = ['entity_id,name,country,reason', ...noDomain.map((r) => `${r.entity_id},"${r.name.replace(/"/g, '""')}",${r.country},${r.reason}`)];
const universeNoDomainCsv = noDomainCsvLines.join('\n') + '\n';

function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

const manifest = {
  frozen_at: new Date().toISOString(),
  entities_total: entities.length,
  entities_with_domain: withDomain.length,
  entities_without_domain: noDomain.length,
  alias_domains: aliasDomains.size,
  domains_unique: sortedDomains.length,
  sha256_universe_domains: sha256(universeDomainsTxt),
  sha256_universe_no_domain: sha256(universeNoDomainCsv),
  registrable_impl: 'scripts/_freeze_universe.mjs::registrable (mirrors bulk-review-contributions.mjs — NOT yet diffed against wave2/aggregate.py::registrable, that file is unavailable in this session)',
};

writeFileSync('data-freeze/universe_domains.txt', universeDomainsTxt);
writeFileSync('data-freeze/universe_no_domain.csv', universeNoDomainCsv);
writeFileSync('data-freeze/universe_manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log('\n--- manifest ---');
console.log(JSON.stringify(manifest, null, 2));
console.log(`\nCheck: entities_with_domain + entities_without_domain = ${withDomain.length + noDomain.length} (should equal entities_total ${entities.length})`);

console.log(`\n--- entities sharing a registrable domain (${shared.length} domains) ---`);
for (const [domain, list] of shared) {
  console.log(`${domain}: ${list.map((e) => `${e.name} (${e.id.slice(0,8)})`).join(' + ')}`);
}

console.log(`\n--- no-domain entities (${noDomain.length}) ---`);
for (const r of noDomain) console.log(`${r.entity_id.slice(0,8)} | ${r.name} | ${r.country} | ${r.reason}`);
