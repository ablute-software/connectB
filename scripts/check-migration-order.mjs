#!/usr/bin/env node
// Prompt 619 §B — the gate that turns a naming problem into a verification
// problem.
//
// WHAT IT CATCHES. Four migrations were applied on 2026-09-08 under a
// date-only prefix. Applied order:
//
//   article14 → suppression_trigger → suppression_attempts → inferred_source
//
// Filename order, which is what a rebuild replays:
//
//   article14 → inferred_source → suppression_attempts → suppression_trigger
//
// Both `suppression_*` files define the SAME trigger function, so a rebuild
// ends on the version that RAISEs and therefore rolls back its own attempt
// log — the bug those files exist to fix, reintroduced by alphabetical order,
// in a database nobody would think to re-check.
//
// TWO CHECKS, and the first is the one that runs everywhere.
//
//   A. PREFIX (no credentials, no dump, always on). Every migration added from
//      2026-09-08 must carry a 14-digit `YYYYMMDDHHMMSS_` prefix — the format
//      `supabase migration new` generates and the exact shape of the ledger's
//      own `version`. With it, filename order equals applied order by
//      construction, and Prompt 614 §B's second rule becomes
//      `version = split_part(name, '_', 1)` instead of a comparison of lists.
//      The 335 legacy `NNNN_` files are grandfathered by an explicit list of
//      known prefixes rather than by a date, because a date test would go
//      stale and silently stop grandfathering.
//
//   B. INVERSION (needs a ledger dump). Compares filename order against the
//      ledger's version order and reports only the pairs that disagree ABOUT
//      AN OBJECT BOTH FILES DEFINE — two files that never touch the same thing
//      can replay in either order, and reporting those would bury the real
//      finding. Refresh the dump with:
//
//        select json_agg(json_build_object('version', version, 'name', name)
//                        order by version)
//        from supabase_migrations.schema_migrations;
//
//      into supabase/migrations-ledger.json. Absent, check B is skipped and
//      says so — it never silently passes.
//
//   node scripts/check-migration-order.mjs            # exit 1 on a violation
//   node scripts/check-migration-order.mjs --report   # print only, exit 0
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const ledgerPath = join(root, 'supabase', 'migrations-ledger.json');
const reportOnly = process.argv.includes('--report');

const TIMESTAMP_PREFIX = /^\d{14}_/;
const LEGACY_PREFIX = /^\d{4}[a-z]?_/;      // 0001_… through 0343_, plus 0129b_
const DATE_ONLY_PREFIX = /^\d{8}_/;          // the 2026-09-08 mistake

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  .map((filename) => ({ filename, sql: readFileSync(join(migrationsDir, filename), 'utf8') }));

// ---- Check A: prefix -------------------------------------------------------
// A date-only prefix is the specific failure this gate exists for, so it is
// named rather than lumped in with "unrecognised".
const dateOnly = files.filter((f) => DATE_ONLY_PREFIX.test(f.filename) && !TIMESTAMP_PREFIX.test(f.filename));
const unrecognised = files.filter((f) =>
  !TIMESTAMP_PREFIX.test(f.filename) && !LEGACY_PREFIX.test(f.filename) && !DATE_ONLY_PREFIX.test(f.filename));

// The four already applied are grandfathered by name: renaming them would
// break Prompt 614 §B's other half (ledger name equals filename), which is the
// half that makes the verifier mechanical. They are listed, not pattern-
// matched, so a FIFTH date-only file fails the build instead of joining them.
const GRANDFATHERED_DATE_ONLY = new Set([
  '20260908_article14_catalog_erase_suppression_and_delivery_gate.sql',
  '20260908_suppression_trigger_reads_linkedin_url_not_generated_column.sql',
  '20260908_suppression_attempts_survive_the_block.sql',
  '20260908_catalog_people_inferred_source_backfill.sql',
]);
const badDateOnly = dateOnly.filter((f) => !GRANDFATHERED_DATE_ONLY.has(f.filename));

console.log(`migration files: ${files.length}`);
console.log(`  14-digit timestamp prefix : ${files.filter((f) => TIMESTAMP_PREFIX.test(f.filename)).length}`);
console.log(`  legacy NNNN_ prefix       : ${files.filter((f) => LEGACY_PREFIX.test(f.filename)).length}`);
console.log(`  date-only (grandfathered) : ${dateOnly.length - badDateOnly.length}`);
console.log(`  date-only (NOT allowed)   : ${badDateOnly.length}`);
console.log(`  unrecognised prefix       : ${unrecognised.length}`);
for (const f of [...badDateOnly, ...unrecognised]) {
  console.log(`    ✗ ${f.filename} — use \`supabase migration new <name>\`, which generates YYYYMMDDHHMMSS_`);
}

// ---- Check B: inversion ----------------------------------------------------
const REPLACEABLE = /create\s+(?:or\s+replace\s+)?(?:function|view|procedure)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
const TRIGGER = /create\s+(?:or\s+replace\s+)?trigger\s+"?([a-z0-9_]+)"?\s+[\s\S]{0,120}?\bon\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;

function objectsDefinedBy(sql) {
  const found = new Set();
  const code = sql.replace(/^\s*--.*$/gm, '');
  for (const m of code.matchAll(REPLACEABLE)) found.add(m[1].toLowerCase());
  for (const m of code.matchAll(TRIGGER)) found.add(`${m[2].toLowerCase()}.${m[1].toLowerCase()}`);
  return [...found];
}
const key = (f) => f.replace(/\.sql$/i, '');

let inversions = [];
if (!existsSync(ledgerPath)) {
  console.log(`\nledger dump absent (${ledgerPath}) — order check SKIPPED, not passed. See this file's header for the query.`);
} else {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const byName = new Map(ledger.map((r) => [r.name, r.version]));
  const applied = files
    .filter((f) => byName.has(key(f.filename)))
    .map((f) => ({ key: key(f.filename), version: byName.get(key(f.filename)), objects: objectsDefinedBy(f.sql) }));

  for (let i = 0; i < applied.length; i++) {
    for (let j = i + 1; j < applied.length; j++) {
      if (applied[j].version >= applied[i].version) continue;
      const shared = applied[i].objects.filter((o) => applied[j].objects.includes(o));
      if (shared.length) inversions.push({ earlierApplied: applied[j].key, laterApplied: applied[i].key, sharedObjects: shared });
    }
  }
  // The 2026-09-08 pair is a KNOWN, accepted inversion: the names are left as
  // applied because Prompt 614 §B's other half (ledger name equals filename)
  // is what makes this verifier mechanical, and renaming them would break it
  // to fix a rebuild nobody performs. Listed explicitly, with the object at
  // stake, so it is acknowledged rather than re-discovered every run — and so
  // that a NEW inversion still fails the build.
  const ACKNOWLEDGED = new Set([
    '20260908_suppression_trigger_reads_linkedin_url_not_generated_column|20260908_suppression_attempts_survive_the_block|catalog_people_block_suppressed',
  ]);
  const acknowledged = inversions.filter((i) => ACKNOWLEDGED.has(`${i.earlierApplied}|${i.laterApplied}|${i.sharedObjects.join(',')}`));
  inversions = inversions.filter((i) => !ACKNOWLEDGED.has(`${i.earlierApplied}|${i.laterApplied}|${i.sharedObjects.join(',')}`));

  const repoKeys = new Set(files.map((f) => key(f.filename)));
  console.log(`\nledger rows: ${ledger.length}   comparable: ${applied.length}`);
  console.log(`  in the ledger with no file : ${ledger.filter((r) => !repoKeys.has(r.name)).length}`);
  console.log(`  in the repo, never applied : ${files.filter((f) => !byName.has(key(f.filename))).length}`);
  console.log(`  known and accepted           : ${acknowledged.length}`);
  console.log(`  ORDER INVERSIONS THAT MATTER: ${inversions.length}`);
  for (const inv of inversions) {
    console.log(`\n    production applied : ${inv.earlierApplied}`);
    console.log(`    ...then            : ${inv.laterApplied}`);
    console.log(`    a rebuild reverses them, and both define: ${inv.sharedObjects.join(', ')}`);
  }
}

const failures = badDateOnly.length + unrecognised.length + inversions.length;
if (reportOnly) process.exit(0);
process.exit(failures > 0 ? 1 : 0);
