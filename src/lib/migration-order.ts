// Prompt 619 §B — the check that turns a naming problem into a verification
// problem, which is the more robust of the two.
//
// WHAT WENT WRONG, and it is worth stating precisely because the fix is small
// and the failure was invisible. Four migrations were applied on 2026-09-08
// under a date-only prefix. Applied order:
//
//   article14 → suppression_trigger → suppression_attempts → inferred_source
//
// Filename order, which is what a rebuild replays:
//
//   article14 → inferred_source → suppression_attempts → suppression_trigger
//
// Two inversions. And the consequence is not cosmetic: both `suppression_*`
// files define the SAME trigger function, so a rebuild would end on
// `suppression_trigger_reads_linkedin_url` — the version that RAISEs and
// therefore rolls back its own attempt log. The bug that was just fixed,
// reintroduced by alphabetical order, in a database nobody would think to
// re-check.
//
// So the property to enforce is not "use this prefix". It is: FILENAME ORDER
// MUST EQUAL APPLIED ORDER. A fourteen-digit timestamp prefix satisfies it by
// construction — which is exactly why `supabase migration new` generates one —
// but this module checks the property rather than the convention, so a legacy
// numbered file and a timestamped one can coexist and still be verified.
//
// Pure on purpose: it takes the repo's filenames and a dump of the ledger, so
// it runs in CI with no database connection of its own.

export interface LedgerRow {
  /** supabase_migrations.schema_migrations.version — a 14-digit timestamp. */
  version: string;
  /** …and its name, which by the Prompt 614 §B rule is the filename, verbatim. */
  name: string;
}

export interface MigrationOrderReport {
  /** Applied, with no file to replay. A rebuild silently omits these. */
  inLedgerNotInRepo: string[];
  /** A file nothing has applied. Either pending, or dead. */
  inRepoNotInLedger: string[];
  /**
   * The one that matters: pairs where a rebuild would apply B before A while
   * production applied A before B. Only reported for objects that actually
   * collide — two files that never touch the same thing can be replayed in
   * either order without consequence, and reporting those would bury the real
   * finding under noise.
   */
  inversions: { earlierApplied: string; laterApplied: string; sharedObjects: string[] }[];
}

/** Strips the `.sql` so a filename compares against a ledger name. */
export function migrationKey(filename: string): string {
  return filename.replace(/\.sql$/i, '');
}

// Objects a later file can silently redefine. `create or replace` is the whole
// hazard: a plain `create table` would fail loudly on a rebuild, which is a
// problem that reports itself.
// Triggers are deliberately NOT in this list: they are matched below by
// table AND name. Leaving them here too gave every trigger two identities —
// `touch_me` and `catalog_people.touch_me` — which is both noise and a real
// false positive, since a trigger of the same name on two different tables
// would then look like a shared object.
const REPLACEABLE = /create\s+(?:or\s+replace\s+)?(?:function|view|procedure)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
// A trigger is created with `create trigger X on Y`; the pair is what
// identifies it, since two tables may carry a trigger of the same name.
const TRIGGER = /create\s+(?:or\s+replace\s+)?trigger\s+"?([a-z0-9_]+)"?\s+[\s\S]{0,120}?\bon\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;

/** Every replaceable object a migration's SQL defines, normalised. */
export function objectsDefinedBy(sql: string): string[] {
  const found = new Set<string>();
  // Comments would otherwise contribute names from prose about other files.
  const code = sql.replace(/^\s*--.*$/gm, '');
  for (const m of code.matchAll(REPLACEABLE)) found.add(m[1].toLowerCase());
  for (const m of code.matchAll(TRIGGER)) found.add(`${m[2].toLowerCase()}.${m[1].toLowerCase()}`);
  return [...found].sort();
}

/**
 * Compares what a rebuild would do (filename order) with what production did
 * (ledger version order).
 */
export function checkMigrationOrder(
  files: { filename: string; sql: string }[],
  ledger: LedgerRow[],
): MigrationOrderReport {
  const byName = new Map(ledger.map((r) => [r.name, r.version]));
  const repoKeys = new Set(files.map((f) => migrationKey(f.filename)));

  const inLedgerNotInRepo = ledger.map((r) => r.name).filter((n) => !repoKeys.has(n)).sort();
  const inRepoNotInLedger = files.map((f) => migrationKey(f.filename)).filter((k) => !byName.has(k)).sort();

  // Only files the ledger knows about can be compared: an unapplied file has
  // no applied position to disagree with.
  const applied = files
    .filter((f) => byName.has(migrationKey(f.filename)))
    .map((f) => ({
      key: migrationKey(f.filename),
      filename: f.filename,
      version: byName.get(migrationKey(f.filename))!,
      objects: objectsDefinedBy(f.sql),
    }))
    .sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));

  const inversions: MigrationOrderReport['inversions'] = [];
  for (let i = 0; i < applied.length; i++) {
    for (let j = i + 1; j < applied.length; j++) {
      const first = applied[i]; // earlier by FILENAME
      const second = applied[j];
      // A rebuild runs `first` then `second`. Production ran them the other
      // way round only if `second` has the earlier version.
      if (second.version >= first.version) continue;
      const shared = first.objects.filter((o) => second.objects.includes(o));
      if (shared.length === 0) continue;
      inversions.push({ earlierApplied: second.key, laterApplied: first.key, sharedObjects: shared });
    }
  }

  return { inLedgerNotInRepo, inRepoNotInLedger, inversions };
}
