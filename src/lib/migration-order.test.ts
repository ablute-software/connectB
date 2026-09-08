import { describe, expect, it } from 'vitest';
import { checkMigrationOrder, migrationKey, objectsDefinedBy, type LedgerRow } from './migration-order';

// The real case, from 2026-09-08. Applied in this order:
//   11:46:36 article14…      11:47:46 …trigger_reads…
//   11:48:22 …attempts…      11:50:07 …inferred_source…
// Filename order puts …attempts… before …trigger_reads…, and both define the
// same trigger function, so a rebuild ends on the RAISE version — the bug
// those two files exist to fix.
const LEDGER: LedgerRow[] = [
  { version: '20260908114636', name: '20260908_article14_catalog_erase_suppression_and_delivery_gate' },
  { version: '20260908114746', name: '20260908_suppression_trigger_reads_linkedin_url_not_generated_column' },
  { version: '20260908114822', name: '20260908_suppression_attempts_survive_the_block' },
  { version: '20260908115007', name: '20260908_catalog_people_inferred_source_backfill' },
];

const TRIGGER_FN = 'create or replace function public.catalog_people_block_suppressed() returns trigger as $$ begin end; $$;';

const FILES = [
  { filename: '20260908_article14_catalog_erase_suppression_and_delivery_gate.sql', sql: TRIGGER_FN },
  { filename: '20260908_catalog_people_inferred_source_backfill.sql', sql: 'update public.catalog_people set source_kind = null;' },
  { filename: '20260908_suppression_attempts_survive_the_block.sql', sql: TRIGGER_FN },
  { filename: '20260908_suppression_trigger_reads_linkedin_url_not_generated_column.sql', sql: TRIGGER_FN },
];

describe('objectsDefinedBy', () => {
  it('finds functions, views and procedures', () => {
    expect(objectsDefinedBy('create or replace function public.erase_gdpr_person(p text) returns jsonb as $$ $$;')).toEqual(['erase_gdpr_person']);
    expect(objectsDefinedBy('create or replace view public.catalog_supply with (security_invoker = true) as select 1;')).toEqual(['catalog_supply']);
  });

  it('identifies a trigger by its table as well as its name', () => {
    expect(objectsDefinedBy('create trigger touch_me before insert on public.catalog_people for each row execute function f();'))
      .toEqual(['catalog_people.touch_me']);
  });

  it('ignores names that only appear in comments', () => {
    // A migration's header routinely discusses other migrations by name; those
    // are prose, and counting them would invent collisions that do not exist.
    const sql = '-- supersedes create or replace function public.old_thing()\nselect 1;';
    expect(objectsDefinedBy(sql)).toEqual([]);
  });
});

describe('checkMigrationOrder (Prompt 619 §B)', () => {
  it('finds the real inversion of 2026-09-08, and names the object at stake', () => {
    const report = checkMigrationOrder(FILES, LEDGER);
    expect(report.inversions).toHaveLength(1);
    expect(report.inversions[0]).toEqual({
      earlierApplied: '20260908_suppression_trigger_reads_linkedin_url_not_generated_column',
      laterApplied: '20260908_suppression_attempts_survive_the_block',
      sharedObjects: ['catalog_people_block_suppressed'],
    });
  });

  it('does not report an inversion between files that never touch the same object', () => {
    // The backfill sorts before both suppression files and was applied last —
    // out of order, and completely harmless, because nothing it writes is
    // redefined by them. Reporting it would bury the one that matters.
    const report = checkMigrationOrder(FILES, LEDGER);
    expect(report.inversions.some((i) => i.laterApplied.includes('inferred_source') || i.earlierApplied.includes('inferred_source'))).toBe(false);
  });

  it('is silent when filename order already equals applied order', () => {
    const ordered: LedgerRow[] = [
      { version: '20260908114636', name: 'a_first' },
      { version: '20260908114746', name: 'b_second' },
    ];
    const files = [
      { filename: 'a_first.sql', sql: TRIGGER_FN },
      { filename: 'b_second.sql', sql: TRIGGER_FN },
    ];
    expect(checkMigrationOrder(files, ordered).inversions).toEqual([]);
  });

  it('reports a file nothing has applied, and a ledger row with no file', () => {
    const report = checkMigrationOrder(
      [{ filename: 'never_applied.sql', sql: 'select 1;' }],
      [{ version: '20260101000000', name: 'applied_but_absent' }],
    );
    expect(report.inRepoNotInLedger).toEqual(['never_applied']);
    expect(report.inLedgerNotInRepo).toEqual(['applied_but_absent']);
    expect(report.inversions).toEqual([]);
  });

  it('never compares a file the ledger does not know', () => {
    // An unapplied file has no applied position, so it cannot contradict one.
    const report = checkMigrationOrder(
      [...FILES, { filename: '00_pending.sql', sql: TRIGGER_FN }],
      LEDGER,
    );
    expect(report.inversions.every((i) => !i.laterApplied.includes('pending') && !i.earlierApplied.includes('pending'))).toBe(true);
  });

  it('migrationKey strips only the extension', () => {
    expect(migrationKey('0321_gdpr_erase_and_resolution.sql')).toBe('0321_gdpr_erase_and_resolution');
    expect(migrationKey('20260908_a.b.sql')).toBe('20260908_a.b');
  });
});
