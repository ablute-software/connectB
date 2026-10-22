// The rehearsal script is only worth running if it rehearses THE migration and THE rollback. It embeds both (they are applied inside the same statement so the
// before/after comparison runs against production data without committing anything), and an embedded copy drifts the moment someone edits one side. This
// pins the two together, pins the property that makes the rehearsal safe to run against production (one statement, no way to commit), and pins the
// migration to what it claims to be: thirteen read-only policies, nothing else, and the rollback removes exactly those.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const norm = (t: string) => t.replace(/\r\n/g, '\n');
const read = (p: string) => norm(readFileSync(path.join(root, p), 'utf8'));
const code = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const MIGRATION_FILE = 'supabase/migrations/20261020110000_developer_viewer_reads_more_tables.sql';
const migration = read(MIGRATION_FILE).trim();
const rollback = read('scripts/rollback-developer-viewer-reads.sql').trim();
const script = read('scripts/verify-developer-viewer-reads.sql');
const M_START = '-- >>> MIGRATION (verbatim) >>>';
const M_END = '-- <<< MIGRATION <<<';
const R_START = '-- >>> ROLLBACK (verbatim) >>>';
const R_END = '-- <<< ROLLBACK <<<';

const TABLES = [
  'cap_table_entries', 'funding_rounds', 'roadmap_events', 'roadmap_categories', 'company_roadmap_milestones', 'org_axis_classifications',
  'rejection_codes', 'interaction_documents', 'interaction_edits', 'entity_reopen_snapshots', 'sherlock_next_snoozes', 'review_clarifications', 'investor_deal_signals',
];

describe('scripts/verify-developer-viewer-reads.sql', () => {
  it('is exactly what the composer produces (head + migration + mid + rollback + tail), so editing one side without the other fails here', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'scripts/compose-developer-viewer-reads-rehearsal.mjs')).href)) as { compose: () => string };
    expect(script).toBe(mod.compose());
  });

  it('embeds the migration and, after it, the rollback — each exactly, between its two markers', () => {
    const ms = script.indexOf(M_START); const me = script.indexOf(M_END);
    const rs = script.indexOf(R_START); const re = script.indexOf(R_END);
    expect(ms).toBeGreaterThan(-1);
    expect(me).toBeGreaterThan(ms);
    expect(rs).toBeGreaterThan(me);
    expect(re).toBeGreaterThan(rs);
    expect(script.slice(ms + M_START.length, me).trim()).toBe(migration);
    expect(script.slice(rs + R_START.length, re).trim()).toBe(rollback);
  });

  it('is a single DO statement that ends by raising, so nothing it does (the migration, the rollback and the probes included) can commit', () => {
    const body = code(script);
    expect(body.match(/\$rehearsal\$/g)).toHaveLength(2);
    expect(body.trimStart().startsWith('do $rehearsal$')).toBe(true);
    expect(body.trimEnd().endsWith('$rehearsal$;')).toBe(true);
    expect(body).toMatch(/raise exception E'REHEARSAL_RESULT[^;]*;\s*end\s*\$rehearsal\$;\s*$/);
    expect(body).not.toMatch(/\b(commit|rollback|savepoint)\b/i);
  });

  it('rehearses exactly the thirteen tables the migration covers, in the same order', () => {
    const listed = /v_tables text\[\] := array\[([^\]]*)\]/.exec(script)?.[1] ?? '';
    expect([...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(TABLES);
  });

  it('every probe that WRITES is limited to rows of orgs the person is not a member of (the first run counted the admin\'s own org as "updated")', () => {
    const writes = /create function pg_temp\.zz_writes[\s\S]*?end \$f\$;/.exec(script)?.[0] ?? '';
    expect(writes).toContain('update public.%I set org_id = org_id where org_id <> all ($1)');
    expect(writes).toContain('delete from public.%I where org_id <> all ($1)');
    // …and no other statement in the whole script updates or deletes a founder's table
    const others = code(script).replace(writes, '').match(/\b(update|delete from)\s+public\./gi) ?? [];
    expect(others).toEqual([]);
  });
});

describe(MIGRATION_FILE, () => {
  const stmts = code(migration).split(';').map((s) => s.trim()).filter(Boolean);

  it('is thirteen read-only policies and nothing else: a drop-if-exists and a `for select` create per table, named like 0051\'s', () => {
    expect(stmts).toHaveLength(TABLES.length * 2);
    for (const [i, table] of TABLES.entries()) {
      expect(stmts[i * 2]).toBe(`drop policy if exists ${table}_ablute_qa_read on public.${table}`);
      expect(stmts[i * 2 + 1]).toBe(`create policy ${table}_ablute_qa_read on public.${table} for select using (public.is_ablute_developer())`);
    }
  });

  it('grants nothing that writes: no insert, update, delete, all, no new function, no grant, no table or column change', () => {
    const body = code(migration);
    expect(body).not.toMatch(/\bfor\s+(insert|update|delete|all)\b/i);
    expect(body).not.toMatch(/\b(grant|alter\s+table|create\s+table|create\s+(or\s+replace\s+)?function|create\s+trigger|insert\s+into|update\s+public|delete\s+from)\b/i);
  });

  it('is in the migrations folder, and no migration that sorts before it is a copy of it (it applies after everything it builds on; later migrations may follow — this used to pin it as "the newest", which broke the day another migration landed)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const names = (require('node:fs') as typeof import('node:fs')).readdirSync(path.join(root, 'supabase/migrations')).filter((n) => n.endsWith('.sql')).sort();
    const here = path.basename(MIGRATION_FILE);
    expect(names).toContain(here);
    expect(names.filter((n) => n.includes('developer_viewer_reads_more_tables'))).toEqual([here]);
  });
});

describe('scripts/rollback-developer-viewer-reads.sql', () => {
  it('drops exactly the thirteen policies the migration creates, and nothing else', () => {
    const drops = code(rollback).split(';').map((s) => s.trim()).filter(Boolean);
    expect(drops.sort()).toEqual(TABLES.map((t) => `drop policy if exists ${t}_ablute_qa_read on public.${t}`).sort());
  });
});
