// Prompt 919 — composes scripts/verify-website-health-919.sql: the rolled-back rehearsal of migration
// 20261016140000_website_health.sql against production data.
//
//   head.sql  +  the migration, verbatim  +  tail.sql
//
// The migration is embedded (the rehearsal must run THE migration inside its own never-committing statement, so the checks run on real
// data without writing anything); src/lib/website-health-919-rehearsal.test.ts fails when the committed script is not what this produces.
//
//   node scripts/compose-website-health-919-rehearsal.mjs            writes scripts/verify-website-health-919.sql
//   node scripts/compose-website-health-919-rehearsal.mjs --stdout   prints it (what the drift test compares against)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

export function compose() {
  const migration = read('supabase/migrations/20261016140000_website_health.sql').replace(/\s+$/, '');
  return read('scripts/website-health-919-rehearsal/head.sql') + migration + '\n' + read('scripts/website-health-919-rehearsal/tail.sql');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = compose();
  if (process.argv.includes('--stdout')) process.stdout.write(out);
  else { fs.writeFileSync(path.join(root, 'scripts/verify-website-health-919.sql'), out); console.log(`scripts/verify-website-health-919.sql — ${out.split('\n').length} lines`); }
}
