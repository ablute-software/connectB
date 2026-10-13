#!/usr/bin/env node
// Prompt 914 — composes scripts/verify-effective-plan-914.sql: the rolled-back rehearsal of migration 20261013170000_effective_plan.sql.
//
//   head.sql  +  the migration, verbatim  +  mid.sql  +  the parity cases GENERATED from src/lib/effective-plan-cases.json  +  tail.sql
//
// The point of generating the cases: the TypeScript test (effective-plan.test.ts) and the SQL rehearsal must run THE SAME LIST of
// situations, or "TypeScript and SQL return the same plan" is a claim about two different lists. Edit the JSON, run this, commit both;
// src/lib/effective-plan-rehearsal.test.ts fails when the committed script is not what this produces.
//
//   node scripts/compose-effective-plan-rehearsal.mjs            writes scripts/verify-effective-plan-914.sql
//   node scripts/compose-effective-plan-rehearsal.mjs --stdout   prints it (what the drift test compares against)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (t) => t.replace(/\r\n/g, '\n');
const read = (p) => norm(fs.readFileSync(path.join(root, p), 'utf8'));
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const days = (n) => (n == null ? 'null::int' : String(n));

/** One fixture / matrix case → the statements that build it inside the rehearsal and check effective_plan() against `expected`. */
function builtCase(c) {
  const out = [`  -- ${c.id} — ${c.label}`, `  v_org := pg_temp.zz_mk_org(${lit(c.id)}, ${lit(c.stored)});`];
  c.redemptions.forEach((r, i) => out.push(
    `  perform pg_temp.zz_mk_redemption(v_org, ${lit(`${c.id}-${i + 1}`)}, ${r.pct}, array[${r.plans.map(lit).join(', ')}]::text[], ${r.deleted}, ${!!r.deactivated}, ${days(r.endsInDays)});`,
  ));
  c.badges.forEach((b) => out.push(
    `  perform pg_temp.zz_mk_badge(v_org, ${lit(b.badge)}, ${b.freeTier == null ? 'null::text' : lit(b.freeTier)}, ${days(b.freeUntilInDays)}, ${b.revoked});`,
  ));
  out.push(`  perform pg_temp.zz_check(${lit(`${c.id} ${c.label}`)}, ${lit(c.expected)}, public.effective_plan(v_org));`);
  return out.join('\n');
}

/** One real organisation → a check against the LIVE row. */
function liveCase(c) {
  return [`  -- ${c.id} (live) — ${c.label}`,
    `  perform pg_temp.zz_check(${lit(`${c.id} LIVE ${c.label}`)}, ${lit(c.expected)}, public.effective_plan(${lit(c.orgId)}::uuid));`].join('\n');
}

export function generateParity(cases) {
  const parts = [`  -- ${cases.fixtures.length} fixtures · ${cases.matrix.length} matrix cases · ${cases.real.length} real organisations · ${cases.typescriptOnly.length} TypeScript-only (skipped here)`];
  parts.push('  -- fixtures (the three the prompt names)');
  for (const c of cases.fixtures) parts.push(builtCase(c));
  parts.push('  -- matrix');
  for (const c of cases.matrix) parts.push(builtCase(c));
  parts.push('  -- real organisations, read live (they only mean something while the situation they describe lasts)');
  for (const c of cases.real) parts.push(liveCase(c));
  parts.push('  -- values the database cannot hold (orgs.plan is a foreign key to plans(key)): TypeScript only');
  for (const c of cases.typescriptOnly) parts.push(`  -- ${c.id} — ${c.label}: not run here — ${c.why}`);
  return parts.join('\n') + '\n';
}

export function compose() {
  const cases = JSON.parse(read('src/lib/effective-plan-cases.json'));
  const migration = read('supabase/migrations/20261013170000_effective_plan.sql').replace(/\s+$/, '');
  return read('scripts/effective-plan-rehearsal/head.sql')
    + migration + '\n'
    + '  -- <<< MIGRATION <<<\n'
    + read('scripts/effective-plan-rehearsal/mid.sql')
    + generateParity(cases)
    + read('scripts/effective-plan-rehearsal/tail.sql');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = compose();
  if (process.argv.includes('--stdout')) process.stdout.write(out);
  else { fs.writeFileSync(path.join(root, 'scripts/verify-effective-plan-914.sql'), out); console.log(`scripts/verify-effective-plan-914.sql — ${out.split('\n').length} lines`); }
}
