import { describe, expect, it } from 'vitest';
import {
  canonicalPair, canSendInvite, effectiveInviteStatus, computeSharedInvestorSuggestions, MAX_PENDING_INVITES_PER_ACTOR,
  computeSharedGroupSuggestions, mergeConnectionSuggestions, canCreateGroup, canAddGroupMember,
  canCreateReferral, isDuplicateReferral, canSendReferral, isReferralVisibleToTarget, effectiveReferralState, referralReputation,
  referralsVisibleToTarget, MAX_REFERRALS_PER_MONTH,
  canSignalFollowOn, isFollowOnActive, shapeFollowOnPayload, referralCarriesFollowOnBadge, FOLLOWON_VALIDITY_MONTHS,
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

describe('canCreateReferral — Prompt 318 §A, a mesma regra nas duas direcções', () => {
  it('founder A → investidor X: precisa de invested COM X e ligação com B', () => {
    expect(canCreateReferral({ referrerHasInvestedRelationship: true, otherPartyIsActiveConnection: true })).toBe(true);
  });

  it('sem invested verificado, nunca — mesmo com ligação', () => {
    expect(canCreateReferral({ referrerHasInvestedRelationship: false, otherPartyIsActiveConnection: true })).toBe(false);
  });

  it('sem ligação com o outro lado, nunca — mesmo com invested verificado', () => {
    expect(canCreateReferral({ referrerHasInvestedRelationship: true, otherPartyIsActiveConnection: false })).toBe(false);
  });

  it('investidor X → investidor Z: a mesma função, só troca quem é "invested" e quem é "ligação"', () => {
    // X invested B (referrerHasInvestedRelationship), Z é ligação de X (otherPartyIsActiveConnection).
    expect(canCreateReferral({ referrerHasInvestedRelationship: true, otherPartyIsActiveConnection: true })).toBe(true);
  });
});

describe('isDuplicateReferral — um segundo pedido só depois do primeiro terminar', () => {
  it('bloqueia enquanto existir um pending_referred_consent, pending_target_decision ou accepted para o par', () => {
    expect(isDuplicateReferral(['pending_referred_consent'])).toBe(true);
    expect(isDuplicateReferral(['pending_target_decision'])).toBe(true);
    expect(isDuplicateReferral(['accepted'])).toBe(true);
  });

  it('permite depois de recusado por qualquer lado', () => {
    expect(isDuplicateReferral(['declined_by_referred'])).toBe(false);
    expect(isDuplicateReferral(['declined_by_target'])).toBe(false);
  });

  it('sem histórico nenhum para o par, nunca é duplicado', () => {
    expect(isDuplicateReferral([])).toBe(false);
  });
});

describe('canSendReferral — tecto mensal', () => {
  it('permite abaixo do máximo', () => {
    expect(canSendReferral(0)).toBe(true);
    expect(canSendReferral(MAX_REFERRALS_PER_MONTH - 1)).toBe(true);
  });

  it('bloqueia a partir do máximo, inclusive', () => {
    expect(canSendReferral(MAX_REFERRALS_PER_MONTH)).toBe(false);
  });
});

describe('isReferralVisibleToTarget — a garantia central: B nunca visível ao alvo antes do consentimento', () => {
  it('pending_referred_consent NUNCA é visível ao alvo — nem que a referência existe', () => {
    expect(isReferralVisibleToTarget('pending_referred_consent')).toBe(false);
  });

  it('declined_by_referred também nunca é visível — B disse não, o alvo nunca sabe que existiu', () => {
    expect(isReferralVisibleToTarget('declined_by_referred')).toBe(false);
  });

  it('pending_target_decision, accepted e declined_by_target são visíveis — o alvo já tem de decidir ou já decidiu', () => {
    expect(isReferralVisibleToTarget('pending_target_decision')).toBe(true);
    expect(isReferralVisibleToTarget('accepted')).toBe(true);
    expect(isReferralVisibleToTarget('declined_by_target')).toBe(true);
  });
});

describe('effectiveReferralState — expira por etapa, nunca reabre visibilidade ao alvo', () => {
  const NOW = new Date('2026-08-23T12:00:00Z');

  it('pending_referred_consent expira aos 14 dias sem resposta de B', () => {
    const referral = { state: 'pending_referred_consent' as const, createdAt: '2026-08-01T00:00:00Z', referredDecidedAt: null };
    expect(effectiveReferralState(referral, NOW)).toBe('expired');
  });

  it('pending_referred_consent dentro do prazo continua pending', () => {
    const referral = { state: 'pending_referred_consent' as const, createdAt: '2026-08-20T00:00:00Z', referredDecidedAt: null };
    expect(effectiveReferralState(referral, NOW)).toBe('pending_referred_consent');
  });

  it('pending_target_decision expira aos 14 dias sem resposta do alvo, a partir de referredDecidedAt', () => {
    const referral = { state: 'pending_target_decision' as const, createdAt: '2026-07-01T00:00:00Z', referredDecidedAt: '2026-08-01T00:00:00Z' };
    expect(effectiveReferralState(referral, NOW)).toBe('expired');
  });

  it('pending_target_decision dentro do prazo (desde referredDecidedAt, não desde createdAt) continua pending', () => {
    const referral = { state: 'pending_target_decision' as const, createdAt: '2026-07-01T00:00:00Z', referredDecidedAt: '2026-08-20T00:00:00Z' };
    expect(effectiveReferralState(referral, NOW)).toBe('pending_target_decision');
  });

  it('accepted/declined nunca são reinterpretados pelo prazo', () => {
    expect(effectiveReferralState({ state: 'accepted', createdAt: '2026-01-01T00:00:00Z', referredDecidedAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('accepted');
    expect(effectiveReferralState({ state: 'declined_by_target', createdAt: '2026-01-01T00:00:00Z', referredDecidedAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('declined_by_target');
  });
});

describe('referralReputation — reputação simples, nunca comparável entre actores', () => {
  it('conta só os próprios envios e aceites', () => {
    const referrals = [
      { referrerActorId: 'a1', state: 'accepted' as const },
      { referrerActorId: 'a1', state: 'declined_by_target' as const },
      { referrerActorId: 'a2', state: 'accepted' as const },
    ];
    expect(referralReputation(referrals, 'a1')).toEqual({ sent: 2, accepted: 1 });
  });

  it('actor sem referrals nenhuns devolve zeros, nunca undefined', () => {
    expect(referralReputation([], 'a1')).toEqual({ sent: 0, accepted: 0 });
  });
});

describe('referralsVisibleToTarget — prova exigida pelo prompt: o alvo NUNCA recebe uma linha pending_referred_consent', () => {
  // Cenário real de ablute_: ablute_ (A, founder) já foi investida por um VC
  // (X, o alvo desta referência) e refere a Caramel Biscuit (B) a X. Antes
  // de B consentir, X não pode ver a linha — nem para provar que existe.
  const ablute = 'actor-ablute';
  const vc = 'actor-vc-x';
  const caramelBiscuit = 'actor-caramel-biscuit';

  it('uma referral ainda pending_referred_consent nunca aparece na vista do alvo', () => {
    const rows = [{ id: 'r1', referrerActorId: ablute, targetActorId: vc, state: 'pending_referred_consent' as const }];
    expect(referralsVisibleToTarget(rows, vc)).toEqual([]);
  });

  it('depois de B consentir (pending_target_decision), accepted, e declined_by_target, o alvo vê', () => {
    const consented = { id: 'r1', referrerActorId: ablute, targetActorId: vc, state: 'pending_target_decision' as const };
    const accepted = { id: 'r1', referrerActorId: ablute, targetActorId: vc, state: 'accepted' as const };
    const declinedByTarget = { id: 'r1', referrerActorId: ablute, targetActorId: vc, state: 'declined_by_target' as const };
    expect(referralsVisibleToTarget([consented], vc)).toEqual([consented]);
    expect(referralsVisibleToTarget([accepted], vc)).toEqual([accepted]);
    expect(referralsVisibleToTarget([declinedByTarget], vc)).toEqual([declinedByTarget]);
  });

  it('B recusar (declined_by_referred) fica tão invisível ao alvo como se nunca tivesse existido', () => {
    const rows = [{ id: 'r1', referrerActorId: ablute, targetActorId: vc, state: 'declined_by_referred' as const }];
    expect(referralsVisibleToTarget(rows, vc)).toEqual([]);
  });

  it('nunca devolve a linha de outro actor, mesmo que visível em estado', () => {
    const rows = [{ id: 'r1', referrerActorId: ablute, targetActorId: caramelBiscuit, state: 'accepted' as const }];
    expect(referralsVisibleToTarget(rows, vc)).toEqual([]);
  });

  it('filtra um conjunto misto, mantendo só as linhas visíveis deste alvo', () => {
    const rows = [
      { id: 'r1', referrerActorId: ablute, targetActorId: vc, state: 'pending_referred_consent' as const },
      { id: 'r2', referrerActorId: ablute, targetActorId: vc, state: 'pending_target_decision' as const },
      { id: 'r3', referrerActorId: caramelBiscuit, targetActorId: vc, state: 'accepted' as const },
      { id: 'r4', referrerActorId: ablute, targetActorId: caramelBiscuit, state: 'accepted' as const },
    ];
    expect(referralsVisibleToTarget(rows, vc).map((r) => r.id)).toEqual(['r2', 'r3']);
  });
});

describe('canSignalFollowOn — só investidor com invested verificado pode marcar', () => {
  it('permite quando há relação invested verificada', () => {
    expect(canSignalFollowOn(true)).toBe(true);
  });
  it('nega sem relação invested verificada', () => {
    expect(canSignalFollowOn(false)).toBe(false);
  });
});

describe('isFollowOnActive — expira aos 6 meses, renovação reseta o prazo, revogação silenciosa vence sempre', () => {
  const NOW = new Date('2026-08-23T00:00:00Z');

  it('null (nunca marcado) não está activo', () => {
    expect(isFollowOnActive(null, NOW)).toBe(false);
  });

  it('activo enquanto expiresAt no futuro', () => {
    const signaledAt = new Date(NOW);
    const expiresAt = new Date(signaledAt); expiresAt.setUTCMonth(expiresAt.getUTCMonth() + FOLLOWON_VALIDITY_MONTHS);
    expect(isFollowOnActive({ expiresAt: expiresAt.toISOString(), revokedAt: null }, NOW)).toBe(true);
  });

  it('inactivo assim que passam os 6 meses sem renovação', () => {
    const sixMonthsAgo = new Date(NOW); sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - FOLLOWON_VALIDITY_MONTHS);
    expect(isFollowOnActive({ expiresAt: sixMonthsAgo.toISOString(), revokedAt: null }, NOW)).toBe(false);
  });

  it('renovar (novo expiresAt +6 meses a partir de agora) volta a ficar activo', () => {
    const renewedExpiresAt = new Date(NOW); renewedExpiresAt.setUTCMonth(renewedExpiresAt.getUTCMonth() + FOLLOWON_VALIDITY_MONTHS);
    expect(isFollowOnActive({ expiresAt: renewedExpiresAt.toISOString(), revokedAt: null }, NOW)).toBe(true);
  });

  it('revogação vence mesmo com expiresAt ainda no futuro', () => {
    const futureExpiresAt = new Date(NOW); futureExpiresAt.setUTCMonth(futureExpiresAt.getUTCMonth() + 3);
    expect(isFollowOnActive({ expiresAt: futureExpiresAt.toISOString(), revokedAt: NOW.toISOString() }, NOW)).toBe(false);
  });
});

describe('shapeFollowOnPayload — o payload nunca inclui identidade quando anonymous, nem o campo quando inactivo', () => {
  it('inactivo -> só { active: false }, sem mais nenhum campo', () => {
    expect(shapeFollowOnPayload(false, 'named', 'Acme Ventures')).toEqual({ active: false });
    expect(shapeFollowOnPayload(false, null, null)).toEqual({ active: false });
  });

  it('activo + anonymous -> nunca inclui investorName, mesmo que fornecido', () => {
    const payload = shapeFollowOnPayload(true, 'anonymous', 'Acme Ventures');
    expect(payload).toEqual({ active: true, visibility: 'anonymous' });
    expect('investorName' in payload).toBe(false);
  });

  it('activo + named -> inclui o nome do investidor', () => {
    expect(shapeFollowOnPayload(true, 'named', 'Acme Ventures')).toEqual({ active: true, visibility: 'named', investorName: 'Acme Ventures' });
  });
});

describe('referralCarriesFollowOnBadge — propaga só para a mesma startup e o mesmo investidor', () => {
  const acmeVc = 'catalog-acme-vc';
  const otherVc = 'catalog-other-vc';
  const abluteOrg = 'org-ablute';
  const otherOrg = 'org-other-startup';

  it('propaga quando o referrer é o investidor com sinal activo, sobre a mesma startup', () => {
    const activeSignals = [{ investorCatalogEntityId: acmeVc, orgId: abluteOrg }];
    expect(referralCarriesFollowOnBadge({ referrerInvestorCatalogEntityId: acmeVc, referredOrgId: abluteOrg, activeSignals })).toBe(true);
  });

  it('NÃO propaga para uma referência de outro investidor sobre a mesma startup', () => {
    const activeSignals = [{ investorCatalogEntityId: acmeVc, orgId: abluteOrg }];
    expect(referralCarriesFollowOnBadge({ referrerInvestorCatalogEntityId: otherVc, referredOrgId: abluteOrg, activeSignals })).toBe(false);
  });

  it('NÃO propaga para uma referência do mesmo investidor sobre outra startup', () => {
    const activeSignals = [{ investorCatalogEntityId: acmeVc, orgId: abluteOrg }];
    expect(referralCarriesFollowOnBadge({ referrerInvestorCatalogEntityId: acmeVc, referredOrgId: otherOrg, activeSignals })).toBe(false);
  });

  it('referrer sem identidade de investidor (fundador) nunca propaga', () => {
    const activeSignals = [{ investorCatalogEntityId: acmeVc, orgId: abluteOrg }];
    expect(referralCarriesFollowOnBadge({ referrerInvestorCatalogEntityId: null, referredOrgId: abluteOrg, activeSignals })).toBe(false);
  });
});
