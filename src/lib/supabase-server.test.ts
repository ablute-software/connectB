// Prompt 680/682 — decideRole é a metade pura de resolveRole (a mesma
// separação de investor-billing-access.ts): a busca de sinais fica em
// resolveRole (precisa de um cliente Supabase real), a precedência entre
// eles fica aqui, testável sem nenhum I/O.
import { describe, expect, it } from 'vitest';
import { decideRole } from './supabase-server';

const NONE = {
  isPlatformAdmin: false,
  hasOpenFounderOrg: false,
  hasAccessGrant: false,
  hasActiveInvestorMembership: false,
  isAbluteTeamEmailConfirmed: false,
};

describe('decideRole — precedência (inalterada para os casos que já existiam)', () => {
  it('sem nenhum sinal → none', () => {
    expect(decideRole(NONE)).toBe('none');
  });

  it('platform_admins → developer, acima de tudo', () => {
    expect(decideRole({ ...NONE, isPlatformAdmin: true, hasOpenFounderOrg: true, hasAccessGrant: true, hasActiveInvestorMembership: true })).toBe('developer');
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

  it('@ablute.pt confirmado, sem outro sinal → developer (fallback, por baixo dos dois sinais de investidor)', () => {
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
