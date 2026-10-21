// Nuno, 20/10/2026 suggested the Pipeline say "X is marked Not raising, so it does not appear to investors and no proposals are shown", with a button to change the
// status. The note is worth having; that sentence is not true of this code, so the advisory says what the code does and nothing more. These tests pin when it
// shows (only for an explicit "no"), what it says (and what it must not), and that the way back is a confirmed change.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { notRaisingAdvisory } from './not-raising-advisory';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('notRaisingAdvisory — when the Pipeline says it', () => {
  it('only when the founder answered "not raising": raising, or no answer yet, is no note', () => {
    expect(notRaisingAdvisory({ roundRaising: true, companyName: 'Mob2is' })).toBeNull();
    expect(notRaisingAdvisory({ roundRaising: null, companyName: 'Mob2is' })).toBeNull();
    expect(notRaisingAdvisory({ roundRaising: undefined, companyName: 'Mob2is' })).toBeNull();
    expect(notRaisingAdvisory({ roundRaising: false, companyName: 'Mob2is' })).not.toBeNull();
  });

  it('names the company, or "Your company" when there is no name', () => {
    expect(notRaisingAdvisory({ roundRaising: false, companyName: 'Mob2is' })?.title).toBe('Mob2is is marked “Not currently raising”.');
    expect(notRaisingAdvisory({ roundRaising: false, companyName: '  ' })?.title).toBe('Your company is marked “Not currently raising”.');
    expect(notRaisingAdvisory({ roundRaising: false })?.title).toBe('Your company is marked “Not currently raising”.');
  });
});

describe('notRaisingAdvisory — what it says is what the code does', () => {
  const a = notRaisingAdvisory({ roundRaising: false, companyName: 'Mob2is' })!;

  it('says the one thing investors see, and that the founder\'s own pipeline is not affected', () => {
    expect(a.body).toContain('“This round has closed”');
    expect(a.body).toContain('does not change the investors on this page');
  });

  it('does NOT claim the company is hidden from investors or that proposals stop — nothing in the code does that', () => {
    const everything = `${a.title} ${a.body} ${a.confirmBody}`.toLowerCase();
    expect(everything).not.toContain('does not appear');
    expect(everything).not.toContain('hidden');
    expect(everything).not.toContain('no proposals');
    expect(everything).not.toContain('invisible');
  });

  it('the way back is named and explained before it happens: investors see the change, so it is not a silent toggle', () => {
    expect(a.actionLabel).toBe('Mark as raising');
    expect(a.confirmBody).toContain('tells investors your round is open again');
    expect(a.confirmBody).toContain('Company › Round');
  });
});

describe('the claims are true of the code (a guard: if one of these fails, the sentence above has to change)', () => {
  it('an investor card gets "This round has closed." when round_raising is false (investor-pipeline.ts)', () => {
    const src = read('./investor-pipeline.ts');
    expect(src).toMatch(/org\.round_raising === false\) \{\s*\/\/ Case \(d\)[^\n]*\n\s*c\.markedNote = 'This round has closed\.';/);
  });

  it('nothing in the catalog match, the unlock gate or the delivery reads round_raising', () => {
    for (const f of ['./pipeline-unlock.ts', './pipeline-unlock-server.ts', './pipeline-admissions.ts', './catalog-delivery-core.ts']) {
      expect(read(f), f).not.toContain('round_raising');
    }
  });

  it('the match score does not read it either (the SQL function selects sectors, stage, ticket, target and country only)', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/20260909053000_normalize_country_code_both_sides.sql'), 'utf8');
    const fn = sql.slice(sql.indexOf('create or replace function public.catalog_match_score'));
    expect(fn).toContain('select sectors, stage, round_min_ticket_eur, round_target_eur, country into v_org');
    expect(fn).not.toContain('round_raising');
  });
});
