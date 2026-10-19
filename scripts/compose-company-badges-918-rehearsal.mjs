// Prompt 918 — composes scripts/verify-company-badges-918.sql: the rolled-back rehearsal of migration
// 20261015130000_company_badges_public_source.sql against production data.
//
//   head.sql  +  the migration, verbatim  +  tail.sql
//
// The migration is embedded (the rehearsal must run THE migration inside its own never-committing transaction, so the old/new
// comparison runs on real rows without writing anything); src/lib/company-badges-918-rehearsal.test.ts fails when the committed
// script is not what this produces.
//
//   node scripts/compose-company-badges-918-rehearsal.mjs            writes scripts/verify-company-badges-918.sql
//   node scripts/compose-company-badges-918-rehearsal.mjs --stdout   prints it (what the drift test compares against)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

export function compose() {
  const migration = read('supabase/migrations/20261015130000_company_badges_public_source.sql').replace(/\s+$/, '');
  return read('scripts/company-badges-918-rehearsal/head.sql') + migration + '\n' + read('scripts/company-badges-918-rehearsal/tail.sql');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = compose();
  if (process.argv.includes('--stdout')) process.stdout.write(out);
  else { fs.writeFileSync(path.join(root, 'scripts/verify-company-badges-918.sql'), out); console.log(`scripts/verify-company-badges-918.sql — ${out.split('\n').length} lines`); }
}
