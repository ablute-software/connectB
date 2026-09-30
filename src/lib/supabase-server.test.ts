// Prompt 680/682 — decideRole é a metade pura de resolveRole (a mesma
// separação de investor-billing-access.ts): a busca de sinais fica em
// resolveRole (precisa de um cliente Supabase real), a precedência entre
// eles fica aqui, testável sem nenhum I/O.
import { describe, expect, it } from 'vitest';
import { decideRole, hatsFromSignals } from './supabase-server';

const NONE = {
  isPlatformAdmin: false,
  hasOpenFounderOrg: false,
  hasActiveIncubatorMembership: false,
  hasApprovedClaim: false,
  hasActiveInvestorMembership: false,
  hasAccessGrant: false,
  isAbluteTeamEmailConfirmed: false,
  hasPendingClaim: false,
};

describe('decideRole — precedência (inalterada para os casos que já existiam)', () => {
  it('sem nenhum sinal → none', () => {
    expect(decideRole(NONE)).toBe('none');
  });

  it('platform_admins → developer, acima de tudo', () => {
    expect(decideRole({ ...NONE, isPlatformAdmin: true, hasOpenFounderOrg: true, hasAccessGrant: true, hasActiveInvestorMembership: true, hasApprovedClaim: true })).toBe('developer');
  });

  it('org_members não-fechado → founder', () => {
    expect(decideRole({ ...NONE, hasOpenFounderOrg: true })).toBe('founder');
  });

  it('access_grants.grantee_email → investor (caminho antigo, convite pelo founder)', () => {
    expect(decideRole({ ...NONE, hasAccessGrant: true })).toBe('investor');
  });

  it('matchdeal_investor_members activo → investor (caminho novo, claim do catálogo — Prompt 680)', () => {
    expect(decideRole({ ...NONE, hasActiveInvestorMembership: true })).toBe('investor');
  });

  it('@ablute.pt confirmado, sem outro sinal → developer (fallback, por baixo dos sinais de investidor)', () => {
    expect(decideRole({ ...NONE, isAbluteTeamEmailConfirmed: true })).toBe('developer');
  });

  it('founder E investidor ao mesmo tempo (caso real, medido: contas internas de QA) → founder vence, sem mudança de comportamento', () => {
    expect(decideRole({ ...NONE, hasOpenFounderOrg: true, hasAccessGrant: true })).toBe('founder');
    expect(decideRole({ ...NONE, hasOpenFounderOrg: true, hasActiveInvestorMembership: true })).toBe('founder');
  });

  it('investidor E @ablute.pt ao mesmo tempo → investor vence (o sinal explícito de acesso outranks o fallback de domínio)', () => {
    expect(decideRole({ ...NONE, hasActiveInvestorMembership: true, isAbluteTeamEmailConfirmed: true })).toBe('investor');
  });
});

describe('decideRole — Prompt 587 (investor_entity_claims aprovado/pendente)', () => {
  it('claim aprovado, sem membership ainda → investor (o claim por si só já resolve, não depende do upsert de membership ter corrido)', () => {
    expect(decideRole({ ...NONE, hasApprovedClaim: true })).toBe('investor');
  });

  it('claim pendente, sem mais nenhum sinal → investor_pending, nunca none', () => {
    expect(decideRole({ ...NONE, hasPendingClaim: true })).toBe('investor_pending');
  });

  it('claim pendente é o sinal de precedência mais baixa: qualquer sinal de investidor "real" vence', () => {
    expect(decideRole({ ...NONE, hasPendingClaim: true, hasApprovedClaim: true })).toBe('investor');
    expect(decideRole({ ...NONE, hasPendingClaim: true, hasActiveInvestorMembership: true })).toBe('investor');
    expect(decideRole({ ...NONE, hasPendingClaim: true, hasAccessGrant: true })).toBe('investor');
  });

  it('claim pendente perde para founder, platform_admin e @ablute.pt — nunca desloca um papel já resolvido', () => {
    expect(decideRole({ ...NONE, hasPendingClaim: true, hasOpenFounderOrg: true })).toBe('founder');
    expect(decideRole({ ...NONE, hasPendingClaim: true, isPlatformAdmin: true })).toBe('developer');
    expect(decideRole({ ...NONE, hasPendingClaim: true, isAbluteTeamEmailConfirmed: true })).toBe('developer');
  });
});

// Prompt I-01 — o papel 'incubator': developer > founder > incubator > investor.
describe('decideRole — incubadora (Prompt I-01)', () => {
  it('membership activa de incubadora, sem outro sinal → incubator', () => {
    expect(decideRole({ ...NONE, hasActiveIncubatorMembership: true })).toBe('incubator');
  });

  it('founder + incubadora → founder (aterra no /pipeline; o selector leva ao /incubator)', () => {
    expect(decideRole({ ...NONE, hasOpenFounderOrg: true, hasActiveIncubatorMembership: true })).toBe('founder');
  });

  it('incubadora + investidor (D3: a aceleradora que investe) → incubator, acima de todos os sinais de investidor', () => {
    expect(decideRole({ ...NONE, hasActiveIncubatorMembership: true, hasActiveInvestorMembership: true })).toBe('incubator');
    expect(decideRole({ ...NONE, hasActiveIncubatorMembership: true, hasApprovedClaim: true })).toBe('incubator');
    expect(decideRole({ ...NONE, hasActiveIncubatorMembership: true, hasAccessGrant: true })).toBe('incubator');
  });

  it('platform admin continua acima da incubadora', () => {
    expect(decideRole({ ...NONE, isPlatformAdmin: true, hasActiveIncubatorMembership: true })).toBe('developer');
  });

  it('incubadora acima do fallback @ablute.pt e do claim pendente', () => {
    expect(decideRole({ ...NONE, hasActiveIncubatorMembership: true, isAbluteTeamEmailConfirmed: true })).toBe('incubator');
    expect(decideRole({ ...NONE, hasActiveIncubatorMembership: true, hasPendingClaim: true })).toBe('incubator');
  });

  it('hatsFromSignals lista todos os chapéus, não só o que ganha a precedência', () => {
    expect(hatsFromSignals({ ...NONE, hasOpenFounderOrg: true, hasActiveIncubatorMembership: true, hasActiveInvestorMembership: true }))
      .toEqual({ founder: true, incubator: true, investor: true });
    expect(hatsFromSignals(NONE)).toEqual({ founder: false, incubator: false, investor: false });
    expect(hatsFromSignals({ ...NONE, hasAccessGrant: true }).investor).toBe(true);
  });
});
