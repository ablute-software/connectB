import { describe, expect, it } from 'vitest';
import {
  canonicalPair, canSendInvite, effectiveInviteStatus, computeSharedInvestorSuggestions, MAX_PENDING_INVITES_PER_ACTOR,
  computeSharedGroupSuggestions, mergeConnectionSuggestions, canCreateGroup, canAddGroupMember,
  canCreateReferral, isDuplicateReferral, canSendReferral, isReferralVisibleToTarget, effectiveReferralState, referralReputation,
  referralsVisibleToTarget, MAX_REFERRALS_PER_MONTH,
  canSignalFollowOn, isFollowOnActive, shapeFollowOnPayload, referralCarriesFollowOnBadge, FOLLOWON_VALIDITY_MONTHS,
  computePathfinderMatches, isPostVisibleToViewer,
  NETWORK_UPDATE_STRUCTURED_KEYS, lastUpdateGapCheck, UPDATE_GAP_REMINDER_DAYS, canShareRoundMilestone, formatRoundMilestoneText,
  isOfferActive, canReferViaScoutRequest, reciprocityReputation,
  emailInviteRateCounts, canSendDirectInvite, NETWORK_DIRECT_INVITE_DAILY_CAP, NETWORK_DIRECT_INVITE_WEEKLY_CAP,
  connectLinkPaused, CONNECT_LINK_WEEKLY_PAUSE_THRESHOLD, searchDiscoverableFounders, type DiscoverableFounderRow,
} from './network';
import { computeRoundProgressPercent } from './round-progress';

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

describe('computePathfinderMatches — mesma verificação do Pedido A do 318, nunca uma segunda', () => {
  it('paridade: canCreateReferral e computePathfinderMatches concordam sobre o mesmo fixture', () => {
    // O mesmo fixture visto pelas duas perspectivas: uma ligação C com
    // relação invested verificada com o alvo, e eu (o founder a ver o
    // ecrã) já somos ligação activa um do outro — exactamente o par que o
    // 318 usa para canCreateReferral(referrer=C).
    const connection = { actorId: 'c1', isDiscoverable: true, hasInvestedRelationshipWithTarget: true, hasLiveReferralForThisAsk: false };
    const eligibleViaReferralRule = canCreateReferral({ referrerHasInvestedRelationship: connection.hasInvestedRelationshipWithTarget, otherPartyIsActiveConnection: true });
    const matches = computePathfinderMatches([connection]);
    expect(matches.length > 0).toBe(eligibleViaReferralRule);
  });

  it('sem relação invested verificada, não aparece como match', () => {
    const connection = { actorId: 'c1', isDiscoverable: true, hasInvestedRelationshipWithTarget: false, hasLiveReferralForThisAsk: false };
    expect(computePathfinderMatches([connection])).toEqual([]);
  });

  it('sem opt-in (network_discoverable), não aparece mesmo com relação invested verificada', () => {
    const connection = { actorId: 'c1', isDiscoverable: false, hasInvestedRelationshipWithTarget: true, hasLiveReferralForThisAsk: false };
    expect(computePathfinderMatches([connection])).toEqual([]);
  });

  it('"já pedido" marcado correctamente quando existe referência activa para o par', () => {
    const connection = { actorId: 'c1', isDiscoverable: true, hasInvestedRelationshipWithTarget: true, hasLiveReferralForThisAsk: true };
    expect(computePathfinderMatches([connection])).toEqual([{ actorId: 'c1', alreadyRequested: true }]);
  });

  it('filtra e mapeia múltiplas ligações independentemente', () => {
    const connections = [
      { actorId: 'c1', isDiscoverable: true, hasInvestedRelationshipWithTarget: true, hasLiveReferralForThisAsk: false },
      { actorId: 'c2', isDiscoverable: false, hasInvestedRelationshipWithTarget: true, hasLiveReferralForThisAsk: false },
      { actorId: 'c3', isDiscoverable: true, hasInvestedRelationshipWithTarget: false, hasLiveReferralForThisAsk: false },
      { actorId: 'c4', isDiscoverable: true, hasInvestedRelationshipWithTarget: true, hasLiveReferralForThisAsk: true },
    ];
    expect(computePathfinderMatches(connections)).toEqual([
      { actorId: 'c1', alreadyRequested: false },
      { actorId: 'c4', alreadyRequested: true },
    ]);
  });
});

describe('isPostVisibleToViewer — respeita exclusões e associação a grupo em tempo real, nunca snapshot', () => {
  it('o autor vê sempre o seu próprio post, mesmo target=all com todos excluídos', () => {
    const post = { authorActorId: 'author', target: 'all' as const, groupId: null, excludedActorIds: ['author'] };
    expect(isPostVisibleToViewer(post, 'author', false, false)).toBe(true);
  });

  it('target=all: uma ligação activa vê, uma ligação excluída não vê', () => {
    const post = { authorActorId: 'author', target: 'all' as const, groupId: null, excludedActorIds: ['excluded-viewer'] };
    expect(isPostVisibleToViewer(post, 'connection-viewer', true, false)).toBe(true);
    expect(isPostVisibleToViewer(post, 'excluded-viewer', true, false)).toBe(false);
  });

  it('target=all: quem não é ligação activa não vê, mesmo sem estar excluído', () => {
    const post = { authorActorId: 'author', target: 'all' as const, groupId: null, excludedActorIds: [] };
    expect(isPostVisibleToViewer(post, 'stranger', false, false)).toBe(false);
  });

  it('remover a ligação depois faz o post deixar de ser visível — reavaliado em tempo real, nunca snapshot', () => {
    const post = { authorActorId: 'author', target: 'all' as const, groupId: null, excludedActorIds: [] };
    // Era ligação activa quando publicou; a ligação foi removida entretanto
    // — o chamador (network-posts-db.ts) resolve isto sempre ao vivo, nunca
    // a partir de um estado guardado no momento da publicação.
    expect(isPostVisibleToViewer(post, 'ex-connection', false, false)).toBe(false);
  });

  it('target=group: membro activo vê, não-membro não vê, independentemente de excludedActorIds', () => {
    const post = { authorActorId: 'author', target: 'group' as const, groupId: 'g1', excludedActorIds: ['viewer'] };
    expect(isPostVisibleToViewer(post, 'viewer', false, true)).toBe(true);
    expect(isPostVisibleToViewer(post, 'viewer', false, false)).toBe(false);
  });
});

describe('NETWORK_UPDATE_STRUCTURED_KEYS — o template nunca contém campo de ronda', () => {
  it('não tem nenhuma chave relacionada com ronda/valores', () => {
    const keys = NETWORK_UPDATE_STRUCTURED_KEYS.map((k) => k.toLowerCase());
    expect(keys).toEqual(['productprogress', 'customers', 'team', 'learnings']);
    for (const k of keys) {
      expect(k).not.toMatch(/round|secured|valuation|target|eur|amount/);
    }
  });
});

describe('lastUpdateGapCheck — dispara só ao fim do intervalo certo, só é chamado para o próprio', () => {
  const NOW = new Date('2026-08-23T00:00:00Z');

  it('sem update alguma vez publicado, nunca dispara (nada para medir "desde quando")', () => {
    expect(lastUpdateGapCheck(null, NOW)).toEqual({ shouldNudge: false, daysSince: null });
  });

  it('não dispara antes do limite', () => {
    const recent = new Date(NOW); recent.setUTCDate(recent.getUTCDate() - (UPDATE_GAP_REMINDER_DAYS - 1));
    const result = lastUpdateGapCheck(recent.toISOString(), NOW);
    expect(result.shouldNudge).toBe(false);
    expect(result.daysSince).toBe(UPDATE_GAP_REMINDER_DAYS - 1);
  });

  it('dispara exactamente ao fim do limite', () => {
    const atLimit = new Date(NOW); atLimit.setUTCDate(atLimit.getUTCDate() - UPDATE_GAP_REMINDER_DAYS);
    expect(lastUpdateGapCheck(atLimit.toISOString(), NOW).shouldNudge).toBe(true);
  });

  it('continua a disparar bem depois do limite', () => {
    const wayPast = new Date(NOW); wayPast.setUTCDate(wayPast.getUTCDate() - (UPDATE_GAP_REMINDER_DAYS + 90));
    expect(lastUpdateGapCheck(wayPast.toISOString(), NOW).shouldNudge).toBe(true);
  });
});

describe('canShareRoundMilestone — marco só disponível com o toggle ligado', () => {
  it('disponível com o toggle ligado', () => { expect(canShareRoundMilestone(true)).toBe(true); });
  it('indisponível com o toggle desligado', () => { expect(canShareRoundMilestone(false)).toBe(false); });
});

describe('formatRoundMilestoneText — nunca mostra € exacto, só percentagem', () => {
  it('inclui a percentagem e o nome, nunca um número em euros', () => {
    const text = formatRoundMilestoneText({ orgName: 'ablute_', percent: 42, stageLabel: 'seed' });
    expect(text).toBe('ablute_ has secured 42% of their seed round.');
    expect(text).not.toMatch(/€|\bEUR\b|\d{4,}/);
  });

  it('sem stageLabel, cai para "their round" genérico', () => {
    expect(formatRoundMilestoneText({ orgName: 'ablute_', percent: 10 })).toBe('ablute_ has secured 10% of their round.');
  });
});

describe('computeRoundProgressPercent — mesmo cálculo que RoundCard/portal já mostram (duas superfícies, um número)', () => {
  it('bate com o exemplo já usado em src/app/portal/page.tsx (securedShown/target)', () => {
    // Mesma fórmula, extraída literalmente dessa página: Math.min(100,
    // Math.round((securedShown / target) * 100)) — testada aqui a partir
    // da função partilhada, não de uma cópia local.
    expect(computeRoundProgressPercent(546000, 1300000)).toBe(42);
  });

  it('nunca excede 100%, mesmo com secured acima do target (over-subscribed)', () => {
    expect(computeRoundProgressPercent(1500000, 1300000)).toBe(100);
  });

  it('sem target ou sem secured, devolve null em vez de dividir por zero/NaN', () => {
    expect(computeRoundProgressPercent(100, null)).toBeNull();
    expect(computeRoundProgressPercent(null, 100)).toBeNull();
    expect(computeRoundProgressPercent(100, 0)).toBeNull();
  });
});

describe('isOfferActive — some do feed ao expirar OU ao esgotar slots, mesma condição', () => {
  const NOW = new Date('2026-08-23T00:00:00Z');
  const future = new Date(NOW); future.setUTCDate(future.getUTCDate() + 7);
  const past = new Date(NOW); past.setUTCDate(past.getUTCDate() - 1);

  it('activa com slots livres e prazo no futuro', () => {
    expect(isOfferActive({ slotsTotal: 3, slotsClaimed: 1, expiresAt: future.toISOString() }, NOW)).toBe(true);
  });

  it('inactiva ao esgotar todos os slots, mesmo com prazo no futuro', () => {
    expect(isOfferActive({ slotsTotal: 3, slotsClaimed: 3, expiresAt: future.toISOString() }, NOW)).toBe(false);
  });

  it('inactiva ao expirar, mesmo com slots livres', () => {
    expect(isOfferActive({ slotsTotal: 3, slotsClaimed: 0, expiresAt: past.toISOString() }, NOW)).toBe(false);
  });
});

describe('canReferViaScoutRequest — excepção documentada à elegibilidade do 318: não exige invested, exige ligação activa', () => {
  it('permite quando a startup referida é ligação activa do founder que refere', () => {
    expect(canReferViaScoutRequest(true)).toBe(true);
  });
  it('nega quando não é ligação activa — nunca inventada, nunca de fora da rede', () => {
    expect(canReferViaScoutRequest(false)).toBe(false);
  });
});

describe('reciprocityReputation — contagens simples do próprio, nunca comparáveis entre actores', () => {
  it('conta só as ofertas e referências via scout do próprio actor', () => {
    const offers = [{ actorId: 'a1' }, { actorId: 'a1' }, { actorId: 'a2' }];
    const scoutReferrals = [{ referrerActorId: 'a1' }, { referrerActorId: 'a2' }, { referrerActorId: 'a2' }];
    expect(reciprocityReputation(offers, scoutReferrals, 'a1')).toEqual({ officeHoursOffered: 2, startupsReferredViaScout: 1 });
    expect(reciprocityReputation(offers, scoutReferrals, 'a2')).toEqual({ officeHoursOffered: 1, startupsReferredViaScout: 2 });
  });

  it('actor sem nenhuma actividade devolve zeros', () => {
    expect(reciprocityReputation([], [], 'a1')).toEqual({ officeHoursOffered: 0, startupsReferredViaScout: 0 });
  });
});

describe('emailInviteRateCounts / canSendDirectInvite — Prompt 335 §D1 caps (5/day, 20/week)', () => {
  const now = new Date('2026-08-26T15:00:00Z'); // a Wednesday

  it('counts only today\'s and this week\'s invites, ignoring older ones', () => {
    const createdAts = [
      '2026-08-26T09:00:00Z', // today
      '2026-08-25T09:00:00Z', // this week (Tuesday)
      '2026-08-24T09:00:00Z', // this week (Monday)
      '2026-08-23T09:00:00Z', // last week (Sunday)
      '2026-07-01T09:00:00Z', // long ago
    ];
    expect(emailInviteRateCounts(createdAts, now)).toEqual({ today: 1, week: 3 });
  });

  it('allows sending under both caps', () => {
    expect(canSendDirectInvite({ today: NETWORK_DIRECT_INVITE_DAILY_CAP - 1, week: NETWORK_DIRECT_INVITE_WEEKLY_CAP - 1 })).toBe(true);
  });

  it('blocks at the daily cap even with weekly budget left', () => {
    expect(canSendDirectInvite({ today: NETWORK_DIRECT_INVITE_DAILY_CAP, week: 1 })).toBe(false);
  });

  it('blocks at the weekly cap even with daily budget left', () => {
    expect(canSendDirectInvite({ today: 0, week: NETWORK_DIRECT_INVITE_WEEKLY_CAP })).toBe(false);
  });
});

describe('connectLinkPaused — Prompt 335 §D3a auto-pause at 20 generated invites/week', () => {
  it('not paused under the threshold', () => {
    expect(connectLinkPaused(CONNECT_LINK_WEEKLY_PAUSE_THRESHOLD - 1)).toBe(false);
  });

  it('paused at or above the threshold', () => {
    expect(connectLinkPaused(CONNECT_LINK_WEEKLY_PAUSE_THRESHOLD)).toBe(true);
    expect(connectLinkPaused(CONNECT_LINK_WEEKLY_PAUSE_THRESHOLD + 5)).toBe(true);
  });
});

describe('searchDiscoverableFounders — Prompt 335 §D2, only ever over pre-filtered discoverable=true rows', () => {
  const rows: DiscoverableFounderRow[] = [
    { orgId: 'o1', name: 'ablute_', sectors: ['Healthtech'], geography: 'Porto, PT' },
    { orgId: 'o2', name: 'Northbridge Robotics', sectors: ['Deep tech', 'Robotics'], geography: 'Lisbon, PT' },
    { orgId: 'o3', name: 'Vega Analytics', sectors: ['Fintech'], geography: 'Berlin, DE' },
  ];

  it('matches by name, case-insensitively', () => {
    expect(searchDiscoverableFounders(rows, 'ABLUTE').map((r) => r.orgId)).toEqual(['o1']);
  });

  it('matches by sector substring', () => {
    // "Deep tech" also contains "tech" — o2 matches too, not just o1/o3.
    expect(searchDiscoverableFounders(rows, 'tech').map((r) => r.orgId).sort()).toEqual(['o1', 'o2', 'o3']);
  });

  it('matches by geography', () => {
    expect(searchDiscoverableFounders(rows, 'porto').map((r) => r.orgId)).toEqual(['o1']);
  });

  it('an empty query returns nothing — never the full directory as a fallback', () => {
    expect(searchDiscoverableFounders(rows, '   ')).toEqual([]);
  });

  it('never ranks or scores — result order is the input order, not a relevance sort', () => {
    const result = searchDiscoverableFounders(rows, 'PT');
    expect(result.map((r) => r.orgId)).toEqual(['o1', 'o2']);
  });
});
