// Why Cap table, Previous funding, Roadmap and others were EMPTY in the Developer Viewer (Nuno, 20/10/2026: "I know ablute_ has data and it was not shown").
//
// The founder workspace reads a lot of tables DIRECTLY from the browser (src/lib/store-supabase.tsx's loadAll, plus a few cards), through the signed-in
// session, so Row Level Security decides what comes back. In a Developer Viewer session the signed-in person is a developer — a platform admin who is NOT a
// member of the org on screen — and a table whose only policy is `is_org_member(org_id)` answers zero rows. No error, just a blank card. Migration 0051 gave
// developers a read-only policy (`<table>_ablute_qa_read … for select using (is_ablute_developer())`) for the tables that existed then, and 0119 closed eight
// more it found by querying production; every table added since (cap_table_entries, funding_rounds, roadmap_*, …) silently missed it, because nothing
// failed when it was forgotten.
//
// This makes forgetting fail. It walks the source for every table a client component reads, walks the migrations for every policy that lets a developer
// read it, and fails on a table with neither a policy nor a written reason. A new table read from the browser must either get its `_ablute_qa_read` policy in
// the migration that creates it, or be listed in EXEMPT below with the reason a developer must not see it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const norm = (t: string) => t.replace(/\r\n/g, '\n');

/** Tables a client component reads that a developer is deliberately NOT given — each with why. */
const EXEMPT: Record<string, string> = {
  matchdeal_matches: 'MatchDeal is the swipe app between two PARTICIPANTS; a developer is not one, and the rows are the participants\' private conversation state',
  matchdeal_messages: 'a MatchDeal conversation between its two participants',
  matchdeal_profiles: 'the person\'s own MatchDeal profile; visible profiles are already readable by everyone',
  matchdeal_weekly_activity: 'the participant\'s own MatchDeal activity counters',
  onboarding_state: 'the signed-in person\'s own onboarding progress, not the organisation\'s data',
  vault_privacy_notice_state: 'the signed-in person\'s own "seen the Vault privacy notice" flag',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** table → the files that read it from the browser (`'use client'` files, and the store). */
function clientReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  for (const file of walk(SRC)) {
    const text = norm(readFileSync(file, 'utf8'));
    const head = text.trimStart().slice(0, 200);
    const isClient = /^['"]use client['"]/.test(head) || file.endsWith(path.join('lib', 'store-supabase.tsx'));
    if (!isClient) continue;
    for (const m of text.matchAll(/\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)/g)) {
      if (!reads.has(m[1])) reads.set(m[1], new Set());
      reads.get(m[1])!.add(norm(path.relative(SRC, file)).split(path.sep).join('/'));
    }
  }
  return reads;
}

/** Tables with at least one policy, in any migration, that lets a developer or platform admin READ (select, or all). */
function developerReadable(): Set<string> {
  const tables = new Set<string>();
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = norm(readFileSync(path.join(MIGRATIONS, name), 'utf8')).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(/;\s*\n/)) {
      const m = /create\s+policy\s+("?[\w$]+"?)\s+on\s+(?:public\.)?"?([a-z_0-9]+)"?([\s\S]*)/i.exec(stmt);
      if (!m) continue;
      const [, , table, rest] = m;
      const forClause = /\bfor\s+(select|all|insert|update|delete)\b/i.exec(rest)?.[1]?.toLowerCase() ?? 'all';
      if (forClause !== 'select' && forClause !== 'all') continue;
      if (/\bis_ablute_developer\s*\(|\bis_platform_admin\s*\(/i.test(rest)) tables.add(table);
    }
  }
  return tables;
}

describe('every table the browser reads directly can be read by a Developer Viewer', () => {
  const reads = clientReads();
  const readable = developerReadable();

  it('finds the readers it is supposed to guard (so this test cannot pass by looking at nothing)', () => {
    for (const expected of ['cap_table_entries', 'funding_rounds', 'roadmap_events', 'company_people', 'orgs', 'documents', 'review_clarifications']) {
      expect(reads.has(expected), `${expected} is read by a client component`).toBe(true);
    }
    expect(readable.has('company_people')).toBe(true);
    expect(readable.has('orgs')).toBe(true);
  });

  it('every table read from the browser has a developer read policy in a migration, or a written reason in EXEMPT', () => {
    const missing = [...reads.keys()].filter((t) => !readable.has(t) && !(t in EXEMPT)).sort();
    expect(
      missing.map((t) => `${t} (read by ${[...reads.get(t)!].slice(0, 2).join(', ')})`),
      'a Developer Viewer sees ZERO rows of these (Row Level Security answers with an empty list, no error). Add '
        + '`create policy <table>_ablute_qa_read on public.<table> for select using (public.is_ablute_developer());` in a migration (see 0051 / 0119), '
        + 'or list the table in EXEMPT with the reason a developer must not read it.',
    ).toEqual([]);
  }, 30_000);

  it('EXEMPT does not outlive its reasons: a table listed there is still read by a client component and still has no developer policy', () => {
    for (const table of Object.keys(EXEMPT)) {
      expect(reads.has(table), `${table} is in EXEMPT but no client component reads it any more — remove it`).toBe(true);
      expect(readable.has(table), `${table} is in EXEMPT but now has a developer policy — remove it`).toBe(false);
    }
  });

  it('what a developer is given is READ-ONLY: no migration lets is_ablute_developer() alone insert, update or delete a founder\'s row', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = norm(readFileSync(path.join(MIGRATIONS, name), 'utf8')).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      for (const stmt of sql.split(/;\s*\n/)) {
        const m = /create\s+policy\s+("?[\w$]+"?)\s+on\s+(?:public\.)?"?([a-z_0-9]+)"?([\s\S]*)/i.exec(stmt);
        if (!m || !/_ablute_qa_/i.test(m[1])) continue;
        if (!/\bfor\s+select\b/i.test(m[3])) offenders.push(`${name}: ${m[1]} on ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
