// Developer Viewer — composes scripts/verify-developer-viewer-reads.sql: the rolled-back rehearsal of migration
// 20261020110000_developer_viewer_reads_more_tables.sql (and of its rollback) against production data.
//
//   head.sql  +  the migration, verbatim  +  mid.sql  +  the rollback, verbatim  +  tail.sql
//
// Both are embedded (the rehearsal must run THE migration and THE rollback inside its own never-committing transaction, so the checks run on real rows
// without writing anything); src/lib/developer-viewer-reads-rehearsal.test.ts fails when the committed script is not what this produces.
//
//   node scripts/compose-developer-viewer-reads-rehearsal.mjs            writes scripts/verify-developer-viewer-reads.sql
//   node scripts/compose-developer-viewer-reads-rehearsal.mjs --stdout   prints it (what the drift test compares against)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

export function compose() {
  const migration = read('supabase/migrations/20261020110000_developer_viewer_reads_more_tables.sql').replace(/\s+$/, '');
  const rollback = read('scripts/rollback-developer-viewer-reads.sql').replace(/\s+$/, '');
  return read('scripts/developer-viewer-reads-rehearsal/head.sql') + migration + '\n'
    + read('scripts/developer-viewer-reads-rehearsal/mid.sql') + rollback + '\n'
    + read('scripts/developer-viewer-reads-rehearsal/tail.sql');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = compose();
  if (process.argv.includes('--stdout')) process.stdout.write(out);
  else { fs.writeFileSync(path.join(root, 'scripts/verify-developer-viewer-reads.sql'), out); console.log(`scripts/verify-developer-viewer-reads.sql — ${out.split('\n').length} lines`); }
}
