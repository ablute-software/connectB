import { describe, expect, it } from 'vitest';
import { resolveBadgeVerification, findMatchingClaimForBadge, projectBadgesForInvestor } from './company-badges';
import type { CompanyClaim } from './types';

function claim(id: string, over: Partial<CompanyClaim> = {}): Pick<CompanyClaim, 'id' | 'statement' | 'status' | 'evidenceClass'> {
  return { id, statement: 'placeholder', status: 'proposed', evidenceClass: 4, ...over };
}

describe('resolveBadgeVerification — nunca promove a verified sem confirmação real', () => {
  it('confirmação credível encontrada -> verified', () => {
    expect(resolveBadgeVerification({ foundCredibleConfirmation: true, foundContradiction: false, note: 'Found on ycombinator.com/companies' }))
      .toEqual({ status: 'verified', note: 'Found on ycombinator.com/companies' });
  });

  it('nada encontrado -> unverified (nunca um default silencioso a verified)', () => {
    expect(resolveBadgeVerification({ foundCredibleConfirmation: false, foundContradiction: false, note: 'No credible source found.' }))
      .toEqual({ status: 'unverified', note: 'No credible source found.' });
  });

  it('contradição activa encontrada -> disputed, mesmo que também haja alguma confirmação parcial', () => {
    expect(resolveBadgeVerification({ foundCredibleConfirmation: true, foundContradiction: true, note: 'Program year does not match public records.' }))
      .toEqual({ status: 'disputed', note: 'Program year does not match public records.' });
  });
});

describe('findMatchingClaimForBadge — reutiliza findDuplicateCandidate (Prompt 311), nunca uma segunda heurística', () => {
  // O caso real Carla Dias/WomenTechEU, recriado como fixture — o mesmo
  // facto já existia como 3 claims desconectados; um badge para o mesmo
  // prémio tem de encontrar essa correspondência.
  const CARLA_PROFILE = claim('c-profile', { statement: 'Carla Dias, CTO. Woman In Tech EU warded', evidenceClass: 5, status: 'accepted' });
  const CARLA_ROADMAP = claim('c-roadmap', { statement: '2022 — WomenTechEU prize', evidenceClass: 5, status: 'accepted' });
  const UNRELATED = claim('c-other', { statement: 'Onboarded a Fortune 500 pilot customer', evidenceClass: 5, status: 'accepted' });

  it('encontra o par quando o badge descreve o mesmo prémio/pessoa', () => {
    const match = findMatchingClaimForBadge({ name: 'WomenTechEU Award', description: 'Awarded to Carla Dias, 2022' }, [CARLA_PROFILE, CARLA_ROADMAP, UNRELATED]);
    expect(match).not.toBeNull();
    expect([CARLA_PROFILE.statement, CARLA_ROADMAP.statement]).toContain(match!.statement);
  });

  it('sem correspondência, devolve null', () => {
    expect(findMatchingClaimForBadge({ name: 'YCombinator W23', description: null }, [UNRELATED])).toBeNull();
  });

  it('pool vazia, devolve null sem lançar', () => {
    expect(findMatchingClaimForBadge({ name: 'Any award', description: null }, [])).toBeNull();
  });
});

describe('projectBadgesForInvestor — Level 0: só verificationStatus + dados públicos, disputed nunca aparece', () => {
  const base = { id: 'b1', name: 'YCombinator W23', description: 'Accelerator program', year: 2023 };

  it('verified mantém-se verified na projecção', () => {
    expect(projectBadgesForInvestor([{ ...base, verificationStatus: 'verified' }]))
      .toEqual([{ id: 'b1', name: 'YCombinator W23', description: 'Accelerator program', year: 2023, verificationStatus: 'verified' }]);
  });

  it('unverified mantém-se unverified — nunca escondido, nunca inventado como verified', () => {
    expect(projectBadgesForInvestor([{ ...base, verificationStatus: 'unverified' }]))
      .toEqual([{ id: 'b1', name: 'YCombinator W23', description: 'Accelerator program', year: 2023, verificationStatus: 'unverified' }]);
  });

  it('disputed NUNCA aparece na projecção investor-facing', () => {
    expect(projectBadgesForInvestor([{ ...base, verificationStatus: 'disputed' }])).toEqual([]);
  });

  it('a projecção nunca inclui verification_note nem evidence_document_id — o tipo de saída não tem esses campos', () => {
    const [result] = projectBadgesForInvestor([{ ...base, verificationStatus: 'verified' }]);
    expect('verification_note' in result).toBe(false);
    expect('evidence_document_id' in result).toBe(false);
    expect('verificationNote' in result).toBe(false);
  });

  it('mistura de estados — filtra disputed, mantém a ordem dos restantes', () => {
    const badges = [
      { id: 'b1', name: 'A', description: null, year: null, verificationStatus: 'verified' as const },
      { id: 'b2', name: 'B', description: null, year: null, verificationStatus: 'disputed' as const },
      { id: 'b3', name: 'C', description: null, year: null, verificationStatus: 'unverified' as const },
    ];
    expect(projectBadgesForInvestor(badges).map((b) => b.id)).toEqual(['b1', 'b3']);
  });
});
