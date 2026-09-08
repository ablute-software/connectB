import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALOG_RETENTION_MONTHS, CONTROLLER_ADDRESS, CONTROLLER_LEGAL_NAME, CONTROLLER_NIPC,
} from './controller';
import { CONTROLLER_NAME } from '../content/commitments/v1';

describe('the controller has one definition (Prompt 624 §B)', () => {
  it('is Exotictarget, Lda', () => {
    expect(CONTROLLER_LEGAL_NAME).toBe('Exotictarget, Lda');
    expect(CONTROLLER_NIPC).toBe('515206415');
    expect(CONTROLLER_ADDRESS).toContain('Viana do Castelo');
  });

  it('the commitments page reads the constant rather than its own copy', () => {
    expect(CONTROLLER_NAME).toBe(CONTROLLER_LEGAL_NAME);
  });

  it('the catalogue retention period is a number, not "forever"', () => {
    // Article 14(2)(a) requires a period or the criteria for one.
    expect(CATALOG_RETENTION_MONTHS).toBe(24);
  });

  // The guard that makes this a single source of truth rather than a fourth
  // copy. The name blocked a day of Article 14 work because it existed in the
  // Terms prose, in the billing settings and in a tenant's legal_name — and in
  // no place a reader could find. A new literal anywhere in src/ puts it back.
  it('no file in src/ writes the controller name as a literal', () => {
    // A path is exempt only for a reason that is written down here.
    //
    // The Terms are the one real exception, and the guard is what made me
    // state it properly: my first allowlist named v1.ts, and the test
    // immediately reported v3.ts and terms.test.ts as well. A Terms version is
    // a legal DOCUMENT whose text is frozen the moment someone accepts it —
    // interpolating a constant into it would mean the words a user agreed to
    // could change under them later. So the whole directory is exempt, by
    // pattern rather than by version, because v4 will come.
    const isExempt = (rel: string) =>
      rel === join('src', 'lib', 'controller.ts')
      || rel === join('src', 'lib', 'controller.test.ts')
      || rel.startsWith(join('src', 'content', 'terms'))
      || rel === join('src', 'lib', 'terms.test.ts');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const rel = full.slice(full.indexOf('src'));
        if (isExempt(rel)) continue;
        if (readFileSync(full, 'utf8').includes('Exotictarget')) offenders.push(rel);
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
