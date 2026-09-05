#!/usr/bin/env node --experimental-strip-types
// Prompt 575 — `npm run verify:migrations`.
//
// Reports where production's migration ledger and `main` disagree. It READS.
// It never applies, never renumbers, never writes to the database — not even
// as an "obvious correction", because every divergence this exists to find had
// a different right answer and a person chose it.
//
// Two modes, and it says which one it is in rather than inventing results:
//   git only     — no database URL in the environment. Numbering sweep and
//                  branch collisions, which are the checks that prevent work
//                  rather than describe it.
//   git + ledger — everything, including function-body drift.
//
// --check exits non-zero on the two categories that are never a legitimate
// transition: a number claimed by two branches, and a file in main that
// production never ran and that is not listed in .verify-ignore.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  compareLedgerToRepo, nextFreeNumber, fileNumber,
  functionsDefinedIn,
  type Finding, type LedgerEntry,
} from '../src/lib/migration-ledger.ts';

// Prompt 577 — the reconciliation sweep. Every entry here was checked against
// production (a query, or a matching header in the file itself), not
// guessed: see prompt_577's own report for the evidence behind each line.
// Ledger name (normalized) -> the file's own normalized name. Many ledger
// rows can point at one file — that is the common shape, a session iterating
// against production through several small named pushes before committing
// ONE consolidated file for the repo.
const LEDGER_NAME_ALIASES: Record<string, string> = {
  // Typed as "...user_index" at apply time; the committed file is
  // "audit_log_admin_index.sql". Confirmed: the index it creates
  // (admin_audit_log_admin_user_id_idx) exists in production.
  audit_log_admin_user_index: 'audit_log_admin_index',
  // 0247's revoke-from-public went out first; the security advisor then
  // flagged residual anon/authenticated grants, and this second push added
  // the revoke lines 0247 already carries today (see the file's own comment
  // just above them).
  enqueue_enrichment_revoke_execute: 'enqueue_enrichment_on_delivery',
  // Both are iterative fixes to 0285 that are already reflected in its
  // committed body: the re-link carve-out (with a comment describing the
  // exact production case that forced it) and `set search_path` on all
  // three functions.
  investor_seat_limit_allow_relink: 'investor_seat_limit',
  investor_seat_limit_pin_search_path: 'investor_seat_limit',
  // Prompt 555, one session, four incremental production pushes folded into
  // one committed file: the enum-cast helpers, the empty-array/ticket-pair
  // pruning in matchdeal_investor_firm_view itself, the write-path function
  // that fills an entity from the firm, and the one-time backfill in §D.
  matchdeal_apply_firm_enum_casts: 'matchdeal_investor_firm_view',
  matchdeal_firm_backfill_existing_entities: 'matchdeal_investor_firm_view',
  matchdeal_firm_view_coherent_pairs_and_empty_arrays: 'matchdeal_investor_firm_view',
  matchdeal_write_paths_fill_from_firm: 'matchdeal_investor_firm_view',
  // The first apply of 0304 lost the functions' original comments (a plain
  // `create or replace function` from the MCP tool does not require them);
  // this second push, 102 seconds later, restored them. 0304's committed
  // body already carries the restored comments throughout.
  matchdeal_write_paths_skip_test_investors_restore_comments: 'matchdeal_write_paths_skip_test_investors',
};

const DIR = 'supabase/migrations';
const PROJECT_REF = 'wkjcaoqdvhykrfacsylr';
const CHECK = process.argv.includes('--check');

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function filesIn(ref: string): string[] {
  try {
    return git(['ls-tree', '--name-only', ref, `${DIR}/`])
      .split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.sql'))
      .map((l) => l.replace(`${DIR}/`, ''));
  } catch { return []; }
}

function remoteBranches(): string[] {
  return git(['branch', '-r', '--format=%(refname:short)'])
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.includes('HEAD') && l !== 'origin/main' && l !== 'origin');
}

async function readLedger(): Promise<LedgerEntry[] | null> {
  // A dump from the SQL editor or the MCP tool, for the common case where
  // REST cannot reach the migrations schema.
  const fileArg = process.argv.indexOf('--ledger-json');
  if (fileArg > -1 && process.argv[fileArg + 1]) {
    const raw = JSON.parse(readFileSync(process.argv[fileArg + 1], 'utf8'));
    return (Array.isArray(raw) ? raw : raw.rows ?? []) as LedgerEntry[];
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Fail loud rather than compare against the wrong database: a clean report
  // from staging would be worse than no report.
  if (!url.includes(PROJECT_REF)) {
    console.error(`refusing: ${url} is not the production project (${PROJECT_REF})`);
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.schema('supabase_migrations').from('schema_migrations').select('version, name');
  if (error) {
    // Precise, because the imprecise version sent me looking for a missing
    // key: the connection is fine and the service role is right. PostgREST
    // only exposes the schemas the project configures, and
    // supabase_migrations is not one of them — by design, and not something
    // to change for a read-only report. Hence --ledger-json.
    console.error(`ledger not readable over REST (${error.message}).`);
    console.error('  supabase_migrations is not an exposed schema. Dump it once and pass it in:');
    console.error("    select json_agg(json_build_object('version', version, 'name', name)) from supabase_migrations.schema_migrations;");
    console.error('    npm run verify:migrations -- --ledger-json ledger.json');
    return null;
  }
  return (data ?? []) as LedgerEntry[];
}

/**
 * §B — which functions main claims to define, and where the body comparison
 * has to happen.
 *
 * Stated as a limitation rather than skipped quietly: comparing a body needs
 * `pg_get_functiondef`, and PostgREST cannot run arbitrary SQL. Every admin
 * function in this codebase is revoked down to service_role precisely so that
 * no generic SQL RPC exists, which is the right trade and also why this half
 * cannot run from a script. The list below is what to compare, and the SQL to
 * run beside it; the comparison itself belongs in the SQL editor or the MCP
 * tool.
 */
function functionOwners(mainFiles: string[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const f of mainFiles) {
    let sql = '';
    try { sql = git(['show', `origin/main:${DIR}/${f}`]); } catch { continue; }
    // Last definition wins: that is the one production should match.
    for (const fn of functionsDefinedIn(sql)) owner.set(fn, f);
  }
  return owner;
}

const mainFiles = filesIn('origin/main');
const branchFiles = new Map<string, string[]>();
for (const b of remoteBranches()) {
  for (const f of filesIn(b)) branchFiles.set(f, [...(branchFiles.get(f) ?? []), b]);
}

const ignorePath = `${DIR}/.verify-ignore`;
const ignored = new Set<string>();
if (existsSync(ignorePath)) {
  for (const raw of readFileSync(ignorePath, 'utf8').split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    // Prompt 577 — "NNNN-NNNN" covers every main file numbered in that
    // inclusive range, for the one exception too large to spell out file by
    // file: 0001-0045 predates the ledger itself (its first row is
    // 2026-07-29; nothing before that can ever get a ledger entry, no
    // matter how this reconciliation goes).
    const range = /^(\d{4})-(\d{4})$/.exec(line);
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])];
      for (const f of mainFiles) {
        const n = fileNumber(f);
        if (n !== null && n >= lo && n <= hi) ignored.add(f);
      }
    } else {
      ignored.add(line);
    }
  }
}

const ledger = await readLedger();
const findings: Finding[] = ledger
  ? compareLedgerToRepo({ ledger, mainFiles, branchFiles, ignored, ledgerAliases: LEDGER_NAME_ALIASES })
  : compareLedgerToRepo({ ledger: [], mainFiles: [], branchFiles, ignored });

const LABELS: Record<string, string> = {
  applied_no_file: 'Applied, no file anywhere',
  file_not_applied: 'In main, never applied',
  applied_file_on_branch: 'Applied, file only on a branch',
  number_collision: 'Same number on two branches',
  name_mismatch: 'Ledger name differs from the file',
};

console.log(`\nmigrations: ${mainFiles.length} files in origin/main, ${branchFiles.size} across ${remoteBranches().length} remote branches`);
console.log(ledger
  ? `ledger: ${ledger.length} applied entries (${PROJECT_REF})`
  : 'ledger: NOT READ — git-only checks below. Pass --ledger-json to include the rest.');

for (const [cat, label] of Object.entries(LABELS)) {
  const rows = findings.filter((f) => f.category === cat);
  if (!ledger && cat !== 'number_collision') continue;
  console.log(`\n${label} — ${rows.length}`);
  for (const r of rows.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${r.key}\n     ${r.detail}${r.likelyWhy ? `\n     likely: ${r.likelyWhy}` : ''}`);
  }
}

const owners = functionOwners(mainFiles);
console.log(`
Function-body drift (§B) — ${owners.size} functions defined in main`);
console.log('  Comparing bodies needs pg_get_functiondef, which PostgREST cannot call, so this');
console.log('  half runs in the SQL editor or the MCP tool rather than silently not running:');
console.log("    select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p");
console.log("      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f';");
if (process.argv.includes('--functions')) {
  for (const [fn, file] of [...owners].sort()) console.log(`    ${fn} <- ${file}`);
}

console.log(`\nnext free file number: ${nextFreeNumber(mainFiles, branchFiles.keys())}\n`);

if (CHECK) {
  const blocking = findings.filter((f) => f.category === 'number_collision' || f.category === 'file_not_applied');
  if (blocking.length) {
    console.error(`FAIL: ${blocking.length} blocking finding(s). Annotate an intentional one in ${ignorePath}.`);
    process.exit(1);
  }
  console.log('OK');
}
