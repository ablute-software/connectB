import { describe, expect, it } from 'vitest';
import { canonicalPair, canSendInvite, effectiveInviteStatus, computeSharedInvestorSuggestions, MAX_PENDING_INVITES_PER_ACTOR } from './network';

describe('canonicalPair — ordem canónica para a chave única de network_connections', () => {
  it('devolve sempre [menor, maior], independentemente da ordem de entrada', () => {
    expect(canonicalPair('a', 'b')).toEqual(['a', 'b']);
    expect(canonicalPair('b', 'a')).toEqual(['a', 'b']);
  });

  it('é determinístico para o mesmo par, em qualquer ordem de chamada', () => {
    const ids = ['zzz-actor', 'aaa-actor'];
    expect(canonicalPair(ids[0], ids[1])).toEqual(canonicalPair(ids[1], ids[0]));
  });
});

describe('canSendInvite — cap de 5 pendentes', () => {
  it('permite enquanto estiver abaixo do máximo', () => {
    expect(canSendInvite(0)).toBe(true);
    expect(canSendInvite(4)).toBe(true);
  });

  it('bloqueia a partir do máximo, inclusive', () => {
    expect(canSendInvite(MAX_PENDING_INVITES_PER_ACTOR)).toBe(false);
    expect(canSendInvite(MAX_PENDING_INVITES_PER_ACTOR + 1)).toBe(false);
  });
});

describe('effectiveInviteStatus — expira aos 14 dias, silêncio nunca vira rejeição', () => {
  const NOW = new Date('2026-08-23T12:00:00Z');

  it('um convite pending ainda dentro do prazo continua pending', () => {
    const invite = { status: 'pending' as const, expiresAt: '2026-08-25T12:00:00Z' };
    expect(effectiveInviteStatus(invite, NOW)).toBe('pending');
  });

  it('um convite pending cujo prazo já passou lê-se como expired', () => {
    const invite = { status: 'pending' as const, expiresAt: '2026-08-20T12:00:00Z' };
    expect(effectiveInviteStatus(invite, NOW)).toBe('expired');
  });

  it('nunca inventa "declined" a partir de silêncio — expired é o único destino de um pending vencido', () => {
    const invite = { status: 'pending' as const, expiresAt: '2026-08-01T00:00:00Z' };
    expect(effectiveInviteStatus(invite, NOW)).not.toBe('declined');
    expect(effectiveInviteStatus(invite, NOW)).toBe('expired');
  });

  it('accepted/declined já resolvidos nunca são reinterpretados pelo prazo', () => {
    expect(effectiveInviteStatus({ status: 'accepted', expiresAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('accepted');
    expect(effectiveInviteStatus({ status: 'declined', expiresAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('declined');
  });
});

describe('computeSharedInvestorSuggestions — a fonte de sugestão do Prompt 316 §B', () => {
  const base = { entityStatus: 'invested', orgDiscoverable: true };

  it('sugere quando dois orgs discoverable partilham o mesmo catalogId, ambos investidos', () => {
    const rows = [
      { ...base, orgId: 'org-a', catalogId: 'cat-1', investorName: 'Acme Ventures' },
      { ...base, orgId: 'org-b', catalogId: 'cat-1', investorName: 'Acme Ventures' },
    ];
    expect(computeSharedInvestorSuggestions(rows, 'org-a')).toEqual([
      { otherOrgId: 'org-b', investorName: 'Acme Ventures', catalogId: 'cat-1' },
    ]);
  });

  it('sem opt-in bilateral (um dos dois orgs não é discoverable) nunca sugere', () => {
    const rows = [
      { ...base, orgId: 'org-a', catalogId: 'cat-1', investorName: 'Acme Ventures' },
      { orgId: 'org-b', catalogId: 'cat-1', investorName: 'Acme Ventures', entityStatus: 'invested', orgDiscoverable: false },
    ];
    expect(computeSharedInvestorSuggestions(rows, 'org-a')).toEqual([]);
  });

  it('investidor sem estágio invested (ex. not_contacted) nunca sugere', () => {
    const rows = [
      { ...base, orgId: 'org-a', catalogId: 'cat-1', investorName: 'Acme Ventures' },
      { orgId: 'org-b', catalogId: 'cat-1', investorName: 'Acme Ventures', entityStatus: 'not_contacted', orgDiscoverable: true },
    ];
    expect(computeSharedInvestorSuggestions(rows, 'org-a')).toEqual([]);
  });

  it('nunca sugere a própria org', () => {
    const rows = [{ ...base, orgId: 'org-a', catalogId: 'cat-1', investorName: 'Acme Ventures' }];
    expect(computeSharedInvestorSuggestions(rows, 'org-a')).toEqual([]);
  });

  it('não duplica sugestões quando há mais que um catalogId partilhado com a mesma org', () => {
    const rows = [
      { ...base, orgId: 'org-a', catalogId: 'cat-1', investorName: 'Acme Ventures' },
      { ...base, orgId: 'org-a', catalogId: 'cat-2', investorName: 'Beta Capital' },
      { ...base, orgId: 'org-b', catalogId: 'cat-1', investorName: 'Acme Ventures' },
      { ...base, orgId: 'org-b', catalogId: 'cat-2', investorName: 'Beta Capital' },
    ];
    const result = computeSharedInvestorSuggestions(rows, 'org-a');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.investorName).sort()).toEqual(['Acme Ventures', 'Beta Capital']);
  });

  it('sem nenhuma linha própria, devolve lista vazia', () => {
    const rows = [{ ...base, orgId: 'org-b', catalogId: 'cat-1', investorName: 'Acme Ventures' }];
    expect(computeSharedInvestorSuggestions(rows, 'org-a')).toEqual([]);
  });
});
