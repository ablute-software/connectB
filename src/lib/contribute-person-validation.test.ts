import { describe, expect, it } from 'vitest';
import { toPersonValidationVerdict, type PersonValidationInput } from './contribute-person-validation';

// Prompt 512 — two rules carry the whole feature, because there is no human
// review step behind them: a field the AI did not validate must never reach
// the shared catalog, and a point is awarded per FIELD, never per
// submission. Everything here is one of those two.

const PAGE = `
  <html><body>
    <h1>Equipo</h1>
    <div><span>Ana</span> <span>Silva</span><p>Socia Directora</p></div>
    <div>Bruno Costa<p>Analista</p></div>
    <footer>Clave Capital</footer>
  </body></html>
`;

function input(over: Partial<PersonValidationInput> = {}): PersonValidationInput {
  return { submittedName: 'Ana Silva', submittedTitle: 'Socia Directora', pageText: PAGE, ...over };
}

const GOOD = {
  name_validated: true, name_on_page: 'Ana Silva',
  title_validated: true, title_on_page: 'Socia Directora',
  title_english: 'Managing Partner', detected_language: 'es',
  affiliation_kind: 'partner', firm_confirmed: true, reasoning: 'Listed under Equipo.',
};

describe('toPersonValidationVerdict', () => {
  it('awards one point per validated field, not one per submission', () => {
    const v = toPersonValidationVerdict(GOOD, input());
    expect(v.nameValidated).toBe(true);
    expect(v.titleValidated).toBe(true);
    expect(v.pointsAwarded).toBe(2);
  });

  it('awards one point when only the name is validated', () => {
    const v = toPersonValidationVerdict({ ...GOOD, title_validated: false, title_on_page: null }, input());
    expect(v.pointsAwarded).toBe(1);
    expect(v.titleValidated).toBe(false);
  });

  it('awards nothing when nothing is validated', () => {
    const v = toPersonValidationVerdict(
      { ...GOOD, name_validated: false, title_validated: false, name_on_page: null, title_on_page: null },
      input(),
    );
    expect(v.pointsAwarded).toBe(0);
    expect(v.rejections.length).toBeGreaterThan(0);
  });

  it('overrides a name the model claimed but the page does not contain', () => {
    // The Faber linkedin_url lesson: a model asked "is this person here?"
    // will pattern-complete a plausible yes. The page is right here, so the
    // claim is re-checked against it rather than trusted.
    const v = toPersonValidationVerdict(
      { ...GOOD, name_on_page: 'Carla Mendes' },
      input({ submittedName: 'Carla Mendes' }),
    );
    expect(v.nameValidated).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.rejections.some((r) => r.field === 'name')).toBe(true);
  });

  it('still validates a name split across markup', () => {
    // "Ana</span> <span>Silva" must not read as absent — that would reject
    // pages that genuinely do name the person.
    const v = toPersonValidationVerdict(GOOD, input());
    expect(v.nameValidated).toBe(true);
  });

  it('refuses a title the page does not contain, even when the name is fine', () => {
    const v = toPersonValidationVerdict(
      { ...GOOD, title_on_page: 'Chief Executive Officer' },
      input({ submittedTitle: 'Chief Executive Officer' }),
    );
    expect(v.nameValidated).toBe(true);
    expect(v.titleValidated).toBe(false);
    expect(v.pointsAwarded).toBe(1);
  });

  it('never validates a title without a validated name to attach it to', () => {
    const v = toPersonValidationVerdict(
      { ...GOOD, name_validated: false, name_on_page: null },
      input(),
    );
    expect(v.titleValidated).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.rejections.some((r) => r.field === 'title')).toBe(true);
  });

  it('rejects everything when the page is not about this firm', () => {
    // A real person, a real role, on somebody else's website.
    const v = toPersonValidationVerdict({ ...GOOD, firm_confirmed: false }, input());
    expect(v.nameValidated).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.rejections[0].reason).toMatch(/not clearly published by or about this firm/i);
  });

  it('keeps the original wording and the English translation separately', () => {
    const v = toPersonValidationVerdict(GOOD, input());
    expect(v.titleOnPage).toBe('Socia Directora');
    expect(v.titleEnglish).toBe('Managing Partner');
    expect(v.detectedLanguage).toBe('es');
  });

  it('falls back to the original wording when no translation was returned', () => {
    const v = toPersonValidationVerdict({ ...GOOD, title_english: null }, input());
    expect(v.titleEnglish).toBe('Socia Directora');
  });

  it('coerces an unknown affiliation kind to other rather than passing it to the enum', () => {
    const v = toPersonValidationVerdict({ ...GOOD, affiliation_kind: 'grand_vizier' }, input());
    expect(v.affiliationKind).toBe('other');
  });

  it('survives a malformed or empty tool payload without throwing', () => {
    expect(toPersonValidationVerdict(null, input()).pointsAwarded).toBe(0);
    expect(toPersonValidationVerdict({}, input()).pointsAwarded).toBe(0);
    expect(toPersonValidationVerdict('nonsense', input()).pointsAwarded).toBe(0);
  });

  it('does not award a title point when no title was submitted', () => {
    const v = toPersonValidationVerdict(GOOD, input({ submittedTitle: null }));
    expect(v.titleValidated).toBe(false);
    expect(v.pointsAwarded).toBe(1);
  });
});
