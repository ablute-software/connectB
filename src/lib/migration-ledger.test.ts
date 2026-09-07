import { describe, expect, it } from 'vitest';
import {
  normalizeMigrationName, fileNumber, compareLedgerToRepo, nextFreeNumber,
  normalizeSqlBody, functionsDefinedIn,
} from './migration-ledger';

describe('normalizeMigrationName', () => {
  it('matches a prefixed file to an unprefixed ledger name', () => {
    // The reason the number can never be the join key: production carries both
    // shapes, 66 prefixed and 205 not.
    expect(normalizeMigrationName('0314_internal_investor_accounts_out_of_startup_discovery.sql'))
      .toBe(normalizeMigrationName('internal_investor_accounts_out_of_startup_discovery'));
  });

  it('matches when the ledger keeps the prefix too', () => {
    expect(normalizeMigrationName('0288_investor_billing_access_state.sql'))
      .toBe(normalizeMigrationName('0288_investor_billing_access_state'));
  });

  it('survives a renumbering', () => {
    // 0303 -> 0305 happened twice this week.
    expect(normalizeMigrationName('0303_orgs_closed_at_and_close_org.sql'))
      .toBe(normalizeMigrationName('0305_orgs_closed_at_and_close_org.sql'));
  });

  it('handles a timestamped version and empty input', () => {
    expect(normalizeMigrationName('20260904220258_internal_investor_accounts')).toBe('internal_investor_accounts');
    expect(normalizeMigrationName(null)).toBe('');
    expect(normalizeMigrationName('')).toBe('');
  });
});

describe('fileNumber', () => {
  it('reads NNNN and ignores anything else', () => {
    expect(fileNumber('supabase/migrations/0316_foo.sql')).toBe(316);
    expect(fileNumber('0001_init.sql')).toBe(1);
    expect(fileNumber('seed.sql')).toBeNull();
    expect(fileNumber('20260904_foo.sql')).toBeNull(); // timestamp, not a file number
  });
});

describe('compareLedgerToRepo', () => {
  const branch = (m: Record<string, string[]>) => new Map(Object.entries(m));

  it('flags a migration applied with no file anywhere — the 0313 case', () => {
    const f = compareLedgerToRepo({
      ledger: [{ version: '20260904', name: 'entities_submission_channel_type_backfill' }],
      mainFiles: [], branchFiles: branch({}),
    });
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('applied_no_file');
  });

  it('separates "only on a branch" from "nowhere at all"', () => {
    // These want different actions: one is a merge, the other is writing a file.
    const f = compareLedgerToRepo({
      ledger: [{ version: '1', name: 'email_send_log_provider_events' }],
      mainFiles: [],
      branchFiles: branch({ '0310_email_send_log_provider_events.sql': ['origin/claude/bek6d7'] }),
    });
    expect(f[0].category).toBe('applied_file_on_branch');
    expect(f[0].detail).toContain('bek6d7');
  });

  it('flags a file main has that production never ran', () => {
    const f = compareLedgerToRepo({
      ledger: [], mainFiles: ['0300_outreach_readiness.sql'], branchFiles: branch({}),
    });
    expect(f.map((x) => x.category)).toContain('file_not_applied');
  });

  it('respects the ignore list for a deliberately unapplied file', () => {
    const f = compareLedgerToRepo({
      ledger: [], mainFiles: ['0300_outreach_readiness.sql'], branchFiles: branch({}),
      ignored: new Set(['0300_outreach_readiness.sql']),
    });
    expect(f.filter((x) => x.category === 'file_not_applied')).toHaveLength(0);
  });

  it('resolves an applied-no-file entry through a ledger alias — the 0066 case', () => {
    // Ledger says "audit_log_admin_user_index"; the file that actually
    // satisfies it is named "audit_log_admin_index.sql" — a small rename
    // between what got typed at apply time and the file's own stem.
    const f = compareLedgerToRepo({
      ledger: [{ version: '1', name: 'audit_log_admin_user_index' }],
      mainFiles: ['0066_audit_log_admin_index.sql'],
      branchFiles: branch({}),
      ledgerAliases: { audit_log_admin_user_index: 'audit_log_admin_index' },
    });
    expect(f).toEqual([]);
  });

  it('lets several ledger names point at one consolidated file — the 0302 case', () => {
    const f = compareLedgerToRepo({
      ledger: [
        { version: '1', name: 'matchdeal_investor_firm_view' },
        { version: '2', name: 'matchdeal_firm_view_coherent_pairs_and_empty_arrays' },
        { version: '3', name: 'matchdeal_apply_firm_enum_casts' },
      ],
      mainFiles: ['0302_matchdeal_investor_firm_view.sql'],
      branchFiles: branch({}),
      ledgerAliases: {
        matchdeal_firm_view_coherent_pairs_and_empty_arrays: 'matchdeal_investor_firm_view',
        matchdeal_apply_firm_enum_casts: 'matchdeal_investor_firm_view',
      },
    });
    expect(f).toEqual([]);
  });

  it('respects the ignore list for an applied entry with no file anywhere, by ledger name', () => {
    // Distinct from the filename form above: this entry has no file at all,
    // so there is nothing to key the ignore line on except the ledger's own
    // name column.
    const f = compareLedgerToRepo({
      ledger: [{ version: '1', name: 'backfill_catalog_wave_fit_score' }],
      mainFiles: [], branchFiles: branch({}),
      ignored: new Set(['backfill_catalog_wave_fit_score']),
    });
    expect(f).toEqual([]);
  });

  it('says nothing when the ledger and main agree', () => {
    expect(compareLedgerToRepo({
      ledger: [{ version: '1', name: 'moderation_reaches_discovery' }],
      mainFiles: ['0315_moderation_reaches_discovery.sql'],
      branchFiles: branch({}),
    })).toEqual([]);
  });

  it('catches the same number on two branches — the manual sweep, automated', () => {
    const f = compareLedgerToRepo({
      ledger: [], mainFiles: [],
      branchFiles: branch({
        '0309_catalog_readiness.sql': ['origin/a'],
        '0309_email_provider_events.sql': ['origin/b'],
      }),
    });
    const collision = f.find((x) => x.category === 'number_collision');
    expect(collision?.key).toBe('0309');
    expect(collision?.detail).toContain('origin/a');
    expect(collision?.detail).toContain('origin/b');
  });

  it('shows branch names while few, and a count once they are many', () => {
    const many = Object.fromEntries([['0289_a.sql', Array.from({length: 29}, (_, i) => `origin/b${i}`)],
                                     ['0289_b.sql', ['origin/x']]]);
    const f = compareLedgerToRepo({ ledger: [], mainFiles: [], branchFiles: branch(many) });
    const c = f.find((x) => x.category === 'number_collision');
    expect(c?.detail).toContain('29 branches');
    expect(c?.detail).toContain('origin/x');
  });

  it('does not call the same file on two branches a collision', () => {
    // A branch that merged main carries main's files; that is not a clash.
    const f = compareLedgerToRepo({
      ledger: [], mainFiles: ['0309_same.sql'],
      branchFiles: branch({ '0309_same.sql': ['origin/a', 'origin/b'] }),
    });
    expect(f.filter((x) => x.category === 'number_collision')).toHaveLength(0);
  });

  it('reports a rename or renumber after applying', () => {
    const f = compareLedgerToRepo({
      ledger: [{ version: '1', name: '0303_orgs_closed_at_and_close_org' }],
      mainFiles: ['0305_orgs_closed_at_and_close_org.sql'],
      branchFiles: branch({}),
    });
    expect(f.find((x) => x.category === 'name_mismatch')?.detail).toContain('0303');
  });
});

describe('nextFreeNumber', () => {
  it('is max+1 across main and every branch', () => {
    expect(nextFreeNumber(['0315_a.sql'], ['0316_b.sql'])).toBe('0317');
  });

  it('does not reuse a gap, because a gap usually means a renumbering', () => {
    expect(nextFreeNumber(['0001_a.sql', '0003_c.sql'], [])).toBe('0004');
  });

  it('starts at 0001 when there is nothing', () => {
    expect(nextFreeNumber([], [])).toBe('0001');
  });
});

describe('normalizeSqlBody / functionsDefinedIn', () => {
  it('treats comments and whitespace as noise, not drift', () => {
    expect(normalizeSqlBody('select 1; -- why\n\n  select   2;'))
      .toBe(normalizeSqlBody('/* why */ select 1; select 2;'));
  });

  it('finds every function a file defines, deduped', () => {
    const sql = `
      create or replace function public.foo(a uuid) returns boolean as $$ $$;
      create function bar() returns void as $$ $$;
      create or replace function public.foo(a uuid, b text) returns boolean as $$ $$;
    `;
    expect(functionsDefinedIn(sql)).toEqual(['foo', 'bar']);
  });
});
