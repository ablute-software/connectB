// Prompt 575 — comparing what production has applied with what `main` can
// replay, so divergence stops being discovered by accident.
//
// Four of them in 48 hours, every one found sideways while doing something
// else: 0300 fixed only in the database, so a clean replay rebuilt the outage
// it fixed; email_send_log's schema live with its code on an unmerged branch;
// 564's migration applied with its code on another; 0313 applied with no file
// in main at all. One of them nearly led to the wrong mechanism in 563.
//
// Pure on purpose. The matching rules are where the edge cases live — the
// ledger records names, not numbers, and often without the file's `NNNN_`
// prefix — and they are the part worth testing without a database or a network.
//
// This module decides nothing about what to DO. It reports, and a person acts.

/** One row of `supabase_migrations.schema_migrations`. */
export interface LedgerEntry { version: string; name: string | null }

/** One `supabase/migrations/*.sql` file, from a git tree. */
export interface MigrationFile { filename: string; branch?: string }

/**
 * The ledger's `name` is sometimes the file's stem WITH its number prefix
 * (`0288_investor_billing_access_state`) and sometimes without
 * (`internal_investor_accounts_out_of_startup_discovery`) — 66 of production's
 * 271 entries carry the prefix and 205 do not. So the number can never be the
 * join key; the normalised stem is.
 */
export function normalizeMigrationName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\.sql$/i, '')
    .replace(/^\d{4,}_/, '')   // file prefix (0288_) or a timestamped one
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The `NNNN` a file leads with, or null for anything not numbered that way. */
export function fileNumber(filename: string): number | null {
  const m = /^(\d{4})_/.exec(filename.replace(/^.*\//, ''));
  return m ? Number(m[1]) : null;
}

export type Category =
  | 'applied_no_file'          // schema ahead of the repository
  | 'file_not_applied'         // repository ahead of the schema, or a dead file
  | 'applied_file_on_branch'   // a branch's migration already ran in production
  | 'number_collision'         // two branches claim the same NNNN
  | 'name_mismatch';           // renamed or renumbered after applying

export interface Finding {
  category: Category;
  key: string;
  detail: string;
  /** Filled only when it can be deduced, never guessed into. */
  likelyWhy?: string;
}

export interface CompareInput {
  ledger: LedgerEntry[];
  mainFiles: string[];
  /** filename -> branches that carry it, excluding main. */
  branchFiles: Map<string, string[]>;
  /** Filenames the repository has declared intentionally unapplied. */
  ignored?: Set<string>;
}

export function compareLedgerToRepo(input: CompareInput): Finding[] {
  const { ledger, mainFiles, branchFiles, ignored = new Set() } = input;
  const findings: Finding[] = [];

  const ledgerByName = new Map<string, LedgerEntry>();
  for (const e of ledger) {
    const k = normalizeMigrationName(e.name ?? e.version);
    if (k) ledgerByName.set(k, e);
  }
  const mainByName = new Map<string, string>();
  for (const f of mainFiles) mainByName.set(normalizeMigrationName(f), f);

  const branchByName = new Map<string, { file: string; branches: string[] }>();
  for (const [file, branches] of branchFiles) {
    const k = normalizeMigrationName(file);
    if (!mainByName.has(k)) branchByName.set(k, { file, branches });
  }

  // Applied, with no file in main. The schema is ahead of what can be replayed.
  for (const [key, entry] of ledgerByName) {
    if (mainByName.has(key)) continue;
    const onBranch = branchByName.get(key);
    if (onBranch) {
      findings.push({
        category: 'applied_file_on_branch',
        key: entry.name ?? entry.version,
        detail: `applied ${entry.version}; file ${onBranch.file} exists only on ${onBranch.branches.join(', ')}`,
        likelyWhy: 'the branch ran its migration against production before being merged',
      });
    } else {
      findings.push({
        category: 'applied_no_file',
        key: entry.name ?? entry.version,
        detail: `applied ${entry.version}; no file in main or any remote branch`,
        likelyWhy: 'applied directly to the database, or its file was never committed',
      });
    }
  }

  // A file main carries that production has never run.
  for (const [key, file] of mainByName) {
    if (ledgerByName.has(key) || ignored.has(file)) continue;
    findings.push({
      category: 'file_not_applied',
      key: file,
      detail: 'in main, absent from the production ledger',
      likelyWhy: 'not applied yet, applied under a different name, or a dead file',
    });
  }

  // Renamed or renumbered after applying: same content, different label.
  for (const [key, entry] of ledgerByName) {
    const file = mainByName.get(key);
    if (!file) continue;
    const stem = file.replace(/\.sql$/i, '').replace(/^.*\//, '');
    if (entry.name && entry.name !== stem && normalizeMigrationName(entry.name) === key
        && /^\d{4}_/.test(entry.name)) {
      findings.push({
        category: 'name_mismatch',
        key: stem,
        detail: `ledger says "${entry.name}"`,
        likelyWhy: 'renumbered or renamed after it was applied',
      });
    }
  }

  // Two branches claiming one number is the collision the manual sweep exists
  // to catch, and the only finding here that is cheaper to prevent than to fix.
  //
  // Only DIFFERENT files count, and only when at least one is not already in
  // main. Thirty branches carrying main's own 0289 is not a clash, and
  // reporting it would bury the one that is under twenty-nine that are not.
  const mainFilenames = new Set(mainFiles.map((f) => f.replace(/^.*\//, '')));
  const byNumber = new Map<number, Map<string, string[]>>();
  for (const [file, branches] of branchFiles) {
    const n = fileNumber(file);
    if (n === null) continue;
    const base = file.replace(/^.*\//, '');
    const perNumber = byNumber.get(n) ?? new Map<string, string[]>();
    perNumber.set(base, [...(perNumber.get(base) ?? []), ...branches]);
    byNumber.set(n, perNumber);
  }
  for (const f of mainFiles) {
    const n = fileNumber(f);
    if (n === null) continue;
    const base = f.replace(/^.*\//, '');
    const perNumber = byNumber.get(n) ?? new Map<string, string[]>();
    perNumber.set(base, [...(perNumber.get(base) ?? []), 'main']);
    byNumber.set(n, perNumber);
  }

  for (const [n, perNumber] of byNumber) {
    if (perNumber.size < 2) continue;
    const contested = [...perNumber.keys()].filter((f) => !mainFilenames.has(f));
    if (contested.length === 0) continue; // all variants are already in main
    findings.push({
      category: 'number_collision',
      key: String(n).padStart(4, '0'),
      // Names while they are still useful, a count once they are not: two
      // branches is the case you have to act on and want to see; thirty is
      // main's own file riding along and only needs to be counted.
      detail: [...perNumber].map(([file, branches]) => {
        const uniq = [...new Set(branches)];
        const where = uniq.includes('main') ? 'main'
          : uniq.length <= 3 ? uniq.join(', ')
          : `${uniq.length} branches`;
        return `${file} (${where})`;
      }).join('  vs  '),
      likelyWhy: 'two prompts picked the same number; the later one must renumber before merging',
    });
  }

  return findings;
}

/**
 * The sweep, computed rather than done by hand: the next number no file
 * anywhere claims. Deliberately max+1 and not the first gap — a gap usually
 * means a renumbering, and reusing it recreates the collision.
 */
export function nextFreeNumber(mainFiles: string[], branchFiles: Iterable<string>): string {
  let max = 0;
  for (const f of [...mainFiles, ...branchFiles]) {
    const n = fileNumber(f);
    if (n !== null && n > max) max = n;
  }
  return String(max + 1).padStart(4, '0');
}

/** Whitespace and comments removed, so formatting differences are not drift. */
export function normalizeSqlBody(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Every `create or replace function public.NAME(` in a file, in order. The last
 * file to define a function is the one production should match.
 */
export function functionsDefinedIn(sql: string): string[] {
  const out: string[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[1].toLowerCase());
  return [...new Set(out)];
}
