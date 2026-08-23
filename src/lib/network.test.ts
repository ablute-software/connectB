import { describe, expect, it } from 'vitest';
import {
  canonicalPair, canSendInvite, effectiveInviteStatus, computeSharedInvestorSuggestions, MAX_PENDING_INVITES_PER_ACTOR,
  computeSharedGroupSuggestions, mergeConnectionSuggestions, canCreateGroup, canAddGroupMember,
} from './network';

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

describe('computeSharedGroupSuggestions — Prompt 317 §C, segunda fonte de contexto', () => {
  it('sugere quando dois actores partilham um grupo activo', () => {
    const memberships = [
      { groupId: 'g1', groupName: 'Batch 2026', actorId: 'a1' },
      { groupId: 'g1', groupName: 'Batch 2026', actorId: 'a2' },
    ];
    expect(computeSharedGroupSuggestions(memberships, 'a1')).toEqual([
      { otherActorId: 'a2', groupName: 'Batch 2026', groupId: 'g1' },
    ]);
  });

  it('nunca sugere o próprio actor', () => {
    const memberships = [{ groupId: 'g1', groupName: 'Batch 2026', actorId: 'a1' }];
    expect(computeSharedGroupSuggestions(memberships, 'a1')).toEqual([]);
  });

  it('sem nenhuma membership própria, devolve lista vazia', () => {
    const memberships = [{ groupId: 'g1', groupName: 'Batch 2026', actorId: 'a2' }];
    expect(computeSharedGroupSuggestions(memberships, 'a1')).toEqual([]);
  });

  it('não sugere actores de um grupo diferente', () => {
    const memberships = [
      { groupId: 'g1', groupName: 'Batch 2026', actorId: 'a1' },
      { groupId: 'g2', groupName: 'Fintech founders', actorId: 'a2' },
    ];
    expect(computeSharedGroupSuggestions(memberships, 'a1')).toEqual([]);
  });
});

describe('mergeConnectionSuggestions — um motor só, nunca duplica um par com duas razões', () => {
  it('um par com AMBAS as razões aparece uma única vez, com as duas listadas', () => {
    const merged = mergeConnectionSuggestions(
      [{ otherActorId: 'a2', investorName: 'Acme Ventures' }],
      [{ otherActorId: 'a2', groupName: 'Batch 2026' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].otherActorId).toBe('a2');
    expect(merged[0].reasons).toEqual([
      { kind: 'shared_investor', label: 'Shares the investor Acme Ventures' },
      { kind: 'shared_group', label: 'Both in Batch 2026' },
    ]);
  });

  it('pares distintos de cada fonte continuam separados', () => {
    const merged = mergeConnectionSuggestions(
      [{ otherActorId: 'a2', investorName: 'Acme Ventures' }],
      [{ otherActorId: 'a3', groupName: 'Batch 2026' }],
    );
    expect(merged.map((m) => m.otherActorId).sort()).toEqual(['a2', 'a3']);
    expect(merged.find((m) => m.otherActorId === 'a2')?.reasons).toHaveLength(1);
    expect(merged.find((m) => m.otherActorId === 'a3')?.reasons).toHaveLength(1);
  });

  it('nenhuma fonte com sugestões devolve lista vazia', () => {
    expect(mergeConnectionSuggestions([], [])).toEqual([]);
  });
});

describe('canCreateGroup — investor_portfolio só pelo lado investidor', () => {
  it('qualquer actor pode criar accelerator_batch ou topic', () => {
    expect(canCreateGroup('accelerator_batch', false)).toBe(true);
    expect(canCreateGroup('topic', false)).toBe(true);
    expect(canCreateGroup('accelerator_batch', true)).toBe(true);
  });

  it('investor_portfolio só é criável por um actor investidor', () => {
    expect(canCreateGroup('investor_portfolio', true)).toBe(true);
    expect(canCreateGroup('investor_portfolio', false)).toBe(false);
  });
});

describe('canAddGroupMember — só ligações, excepto investor_portfolio com invested verificado', () => {
  it('accelerator_batch/topic: só quem já é ligação activa do dono', () => {
    const base = { groupKind: 'accelerator_batch' as const, ownerIsInvestor: false, activeConnectionActorIds: ['a2'], investedActorIdsForOwner: [] };
    expect(canAddGroupMember({ ...base, candidateActorId: 'a2' })).toBe(true);
    expect(canAddGroupMember({ ...base, candidateActorId: 'a3' })).toBe(false);
  });

  it('a mesma regra vale para uma adição DEPOIS da criação, não só no momento inicial', () => {
    // A função não distingue "criação" de "adição posterior" — a regra é a
    // mesma nos dois momentos, exactamente como o prompt pede.
    const params = { groupKind: 'topic' as const, ownerIsInvestor: false, activeConnectionActorIds: ['a2', 'a5'], investedActorIdsForOwner: [], candidateActorId: 'a5' };
    expect(canAddGroupMember(params)).toBe(true);
  });

  it('investor_portfolio: só o lado investidor, e só com invested verificado — ligação activa não basta', () => {
    const params = { groupKind: 'investor_portfolio' as const, ownerIsInvestor: true, activeConnectionActorIds: ['a2'], investedActorIdsForOwner: ['a3'], candidateActorId: 'a2' };
    expect(canAddGroupMember(params)).toBe(false); // a2 é ligação, mas não invested
    expect(canAddGroupMember({ ...params, candidateActorId: 'a3' })).toBe(true); // a3 é invested
  });

  it('investor_portfolio: um founder (não investidor) nunca pode adicionar, mesmo com invested aparente', () => {
    const params = { groupKind: 'investor_portfolio' as const, ownerIsInvestor: false, activeConnectionActorIds: [], investedActorIdsForOwner: ['a3'], candidateActorId: 'a3' };
    expect(canAddGroupMember(params)).toBe(false);
  });
});
