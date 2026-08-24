// Prompt 219 bloco 2 (Prompt 221) — um teste por regra, no mínimo, e os
// átomos REAIS da ablute_ do bloco 1 (prémio, visita sem nome, equipa
// só-Carla) a disparar exatamente o que o 219 diz que disparam.
import { describe, expect, it } from 'vitest';
import {
  detectGaps, ruleG1, ruleG2, ruleG3, ruleG3b, ruleG3c, ruleG4, ruleG5, ruleG6, ruleG7, ruleG8,
  templateFor, QUESTION_TEMPLATES, routeAnswer, type GapContext,
} from './company-gaps';
import { normalizeAtom } from './company-claims';
import type { CompanyClaim, ClaimCategory, ClaimSourceKind, ClaimStatus } from './types';

const NOW = new Date('2026-08-17T12:00:00Z');

// Constrói o claim persistido a partir do MESMO normalizeAtom do bloco 1 —
// os testes usam a classificação real, nunca valores escritos à mão.
function claim(
  id: string, category: ClaimCategory, statement: string,
  over: {
    sourceKind?: ClaimSourceKind; status?: ClaimStatus; updatedAt?: string;
    documentRefs?: CompanyClaim['documentRefs']; gapDisposition?: CompanyClaim['gapDisposition'];
  } = {},
): CompanyClaim {
  const sourceKind = over.sourceKind ?? 'fact';
  const n = normalizeAtom({ category, statement, sourceKind });
  return {
    id, category, statement, sourceKind,
    evidenceClass: n.evidenceClass, specificity: n.specificity,
    status: over.status ?? 'accepted', updatedAt: over.updatedAt ?? '2026-08-01T00:00:00Z',
    documentRefs: over.documentRefs, gapDisposition: over.gapDisposition,
  };
}

// Os três átomos reais da ablute_ (bloco 1).
const PREMIO = claim('c-premio', 'equipa', 'Carla Dias won the WomenTechEU prize, €75,000 non-dilutive, 2022', { sourceKind: 'roadmap' });
const VISITA_VAGA = claim('c-visita', 'validacao_externa', "the world's manufacturing leader sent a committee to visit us for a week");
const VISITA_RESPONDIDA = claim('c-visita2', 'validacao_externa', 'Acme Corp sent a committee to Portugal for a week in 2026 and we are negotiating a pilot LOI', { sourceKind: 'founder_answer' });

function ctx(over: Partial<GapContext> = {}): GapContext {
  return { founders: [], now: NOW, ...over };
}

describe('G1 — tração sem compromisso pago', () => {
  it('dispara quando não há NENHUM claim de classe 1 em tracao_gtm', () => {
    const gaps = ruleG1([claim('t1', 'tracao_gtm', 'three hospitals expressed interest in the product')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G1', severity: 'critical' });
    expect(gaps[0].relatedClaimIds).toEqual(['t1']);
  });

  it('ausência TOTAL de tração também dispara — não é isenção', () => {
    expect(ruleG1([PREMIO]).map((g) => g.rule)).toEqual(['G1']);
  });

  it('não dispara com um cliente pagante', () => {
    expect(ruleG1([claim('t2', 'tracao_gtm', 'paid pilot with Hospital de Braga, invoiced €12,000')])).toEqual([]);
  });
});

describe('G2 — classe forte desperdiçada (reutiliza isWastedStrongClaim)', () => {
  it('a visita VAGA dispara — o caso canónico do 219', () => {
    const gaps = ruleG2([VISITA_VAGA]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G2', severity: 'high', relatedClaimIds: ['c-visita'] });
  });

  it('a mesma visita respondida já não dispara; o prémio (classe 5) nunca dispara', () => {
    expect(ruleG2([VISITA_RESPONDIDA, PREMIO])).toEqual([]);
  });
});

describe('G3 — narrativa de equipa', () => {
  it('equipa só-Carla dispara: <2 nomeados e sem complementaridade', () => {
    const gaps = ruleG3([PREMIO]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].rule).toBe('G3');
    expect(gaps[0].message).toContain('only 1 named person');
    expect(gaps[0].message).toContain('why THIS team wins');
  });

  it('dois nomes + complementaridade não dispara', () => {
    expect(ruleG3([
      claim('e1', 'equipa', 'Carla Dias led clinical operations at Hospital de Braga for six years'),
      claim('e2', 'equipa', 'Rui Almeida and Carla Dias combine hardware engineering with clinical practice'),
    ])).toEqual([]);
  });
});

describe('G3b — assimetria por NOME (219-B)', () => {
  it('um founder com narrativa e outros dois sem: uma lacuna POR NOME', () => {
    const gaps = ruleG3b([PREMIO], ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }, { name: 'Nuno Marujo' }] }));
    expect(gaps.map((g) => g.meta?.founderName)).toEqual(['Rui Almeida', 'Nuno Marujo']);
    expect(gaps[0].meta?.coveredNames).toBe('Carla Dias');
  });

  it('nenhum founder coberto é G3 (ausência), não assimetria', () => {
    expect(ruleG3b([claim('e1', 'equipa', 'the founding team has deep clinical experience')],
      ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }))).toEqual([]);
  });

  it('todos cobertos não dispara', () => {
    expect(ruleG3b(
      [PREMIO, claim('e2', 'equipa', 'Rui Almeida built the first hardware prototype')],
      ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }),
    )).toEqual([]);
  });
});

describe('G3c — funções críticas sem dono (219-B)', () => {
  it('sem ninguém nomeado na parte técnica, dispara — mesmo com equipa nomeada noutra coisa', () => {
    const gaps = ruleG3c([PREMIO], ctx());
    expect(gaps.map((g) => g.meta?.functionKey)).toEqual(['technical']);
  });

  it('em seed, a função financeira também é exigida', () => {
    const gaps = ruleG3c([claim('e1', 'equipa', 'Rui Almeida is our CTO and leads hardware engineering')], ctx({ stage: 'seed' }));
    expect(gaps.map((g) => g.meta?.functionKey)).toEqual(['financial']);
  });

  it('técnica com dono nomeado, fora de seed: nada dispara', () => {
    expect(ruleG3c([claim('e1', 'equipa', 'Rui Almeida is our CTO and leads hardware engineering')], ctx({ stage: 'pre-seed' }))).toEqual([]);
  });

  it('pre-seed NÃO é seed — quem ainda não tem ronda para gerir não precisa de dono financeiro', () => {
    const withCto = [claim('e1', 'equipa', 'Rui Almeida is our CTO and leads hardware engineering')];
    expect(ruleG3c(withCto, ctx({ stage: 'pre-seed' }))).toEqual([]);
    expect(ruleG3c(withCto, ctx({ stage: 'Pre Seed' }))).toEqual([]);
    expect(ruleG3c(withCto, ctx({ stage: 'seed' })).map((g) => g.meta?.functionKey)).toEqual(['financial']);
    expect(ruleG3c(withCto, ctx({ stage: 'Series A' })).map((g) => g.meta?.functionKey)).toEqual(['financial']);
  });
});

describe('G4 — claim aceite sem documento no Vault (Prompt 311 §A: lido directamente, nunca via claim vault_doc)', () => {
  it('dispara para o aceite quando a org NÃO tem nenhum documento no Vault', () => {
    const gaps = ruleG4([VISITA_VAGA], ctx({ hasVaultDocuments: false }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G4', relatedClaimIds: ['c-visita'] });
  });

  it('hasVaultDocuments ausente (chamador não sabe) nunca é tratado como "está documentado"', () => {
    expect(ruleG4([VISITA_VAGA], ctx())).toHaveLength(1);
  });

  // Prompt 311 §A, corrigido após revisão adversarial: uma primeira versão
  // deixava hasVaultDocuments suprimir G4 nas QUATRO categorias assim que
  // existisse UM documento QUALQUER — mas um pitch deck não prova nada
  // sobre equipa/tracao_gtm/validacao_externa, e isso trocava "68 claims de
  // ruído" por "gaps reais escondidos sem aviso", pior que o bug original.
  // A precisão fica exactamente como a implementação antiga (que só cobria
  // prova_tecnica na prática, porque documentToAtom categorizava TODO
  // documento como prova_tecnica, sempre) — só a MECÂNICA de verificação
  // muda, nunca o alcance.
  it('hasVaultDocuments só suprime G4 para prova_tecnica — nunca para equipa/tracao_gtm/validacao_externa', () => {
    const claims = [
      claim('proof1', 'prova_tecnica', 'CE-marked as a Class IIa medical device since 2025.'),
      claim('team1', 'equipa', 'Jane Doe, CTO (founder). Ex-Google, 8 years in ML.'),
      claim('t1', 'tracao_gtm', 'Paid pilot with Hospital de Braga, invoiced €12,000.'),
      VISITA_VAGA,
    ];
    const gaps = ruleG4(claims, ctx({ hasVaultDocuments: true }));
    expect(gaps.map((g) => g.relatedClaimIds[0]).sort()).toEqual(['c-visita', 't1', 'team1']);
  });

  it('hasVaultDocuments continua a suprimir G4 para prova_tecnica especificamente', () => {
    const proof = claim('proof1', 'prova_tecnica', 'CE-marked as a Class IIa medical device since 2025.');
    expect(ruleG4([proof], ctx({ hasVaultDocuments: true }))).toEqual([]);
    expect(ruleG4([proof], ctx({ hasVaultDocuments: false }))).toHaveLength(1);
  });

  // Prompt 313 §B — o caso real que motivou este prompt: um claim de EQUIPA
  // (categoria que hasVaultDocuments nunca cobre, por desenho) fica coberto
  // quando tem documentRefs próprio — a ligação precisa, por claim, que a
  // extração de conteúdo (document-extraction-linking.ts) escreve.
  it('documentRefs próprio suprime G4 mesmo em equipa — a categoria que hasVaultDocuments nunca cobria', () => {
    const withDoc = claim('team-carla', 'equipa', 'Carla Dias is a WomenTechEU awardee', {
      documentRefs: [{ documentId: 'doc-1', documentName: 'Grant Agreement.pdf', page: 3 }],
    });
    expect(ruleG4([withDoc], ctx({ hasVaultDocuments: false }))).toEqual([]);
  });

  it('documentRefs vazio não conta como coberto', () => {
    const withEmptyRefs = claim('team-x', 'equipa', 'Jane Doe, CTO (founder). Ex-Google, 8 years in ML.', { documentRefs: [] });
    expect(ruleG4([withEmptyRefs], ctx())).toHaveLength(1);
  });

  // Prompt 358 Phase 2.4 — a judgment ("we have complementary skills") is
  // never a documentary gap: there is no paper that proves a subjective
  // team-fit claim. This is the exact real-session bug: G3's own chip
  // option, chosen alone, became this literal equipa claim, which G4 then
  // asked to be "documented" — a question with no sensible answer.
  it.each([
    'We have complementary skills',
    'We have unique domain access',
    'We have built this before',
  ])('nunca pede documento para um julgamento de equipa: "%s"', (statement) => {
    expect(ruleG4([claim('judg1', 'equipa', statement)], ctx())).toEqual([]);
  });

  it('um claim de equipa com facto verificável continua a gerar G4 mesmo perto de linguagem de julgamento', () => {
    // "great team" sozinho é julgamento; um facto verificável ao lado não é
    // — mas a frase inteira contém a marca de julgamento, por isso este
    // teste confirma a exclusão é deliberadamente larga (falso negativo
    // aceite, ver o comentário em isTeamJudgment) em vez de garantir o
    // oposto.
    expect(ruleG4([claim('judg2', 'equipa', 'Jane Doe, CTO, ex-Google — great team fit.')], ctx())).toEqual([]);
  });

  // Aditivo, não substitutivo: hasVaultDocuments continua a suprimir
  // prova_tecnica mesmo quando o claim não tem documentRefs próprio (o caso
  // de um documento não-PDF, que nunca é extraído — "só PDF por agora").
  it('hasVaultDocuments continua a funcionar como antes quando documentRefs está ausente', () => {
    const proof = claim('proof1', 'prova_tecnica', 'CE-marked as a Class IIa medical device since 2025.');
    expect(ruleG4([proof], ctx({ hasVaultDocuments: true }))).toEqual([]);
  });

  it('claims propostos (ainda não aceites) não são lacuna documental', () => {
    // categoria elegível (prova_tecnica) para que este teste continue a
    // exercitar a exclusão por STATUS, não a acabar a passar só por a
    // categoria já estar de fora (Prompt 310 §A moveu 'solucao' para fora
    // do âmbito do G4).
    expect(ruleG4([claim('p1', 'prova_tecnica', 'the device is CE certified', { status: 'proposed' })], ctx())).toEqual([]);
  });

  // Prompt 310 §A — categorias onde "há documento?" não é uma pergunta com
  // sentido deixam de gerar G4, mesmo aceites e sem documento nenhum.
  it.each(['mercado_timing', 'solucao', 'problema', 'funding', 'ask'] as const)(
    'nunca dispara para %s — "documento que o comprove" não tem resposta útil possível',
    (category) => {
      expect(ruleG4([claim('x1', category, 'some accepted statement with plenty of specificity, 2026')], ctx())).toEqual([]);
    },
  );

  it('continua a disparar para equipa — um CV/portefólio real costuma existir e fazer sentido pedir', () => {
    const gaps = ruleG4([claim('team1', 'equipa', 'Jane Doe, CTO (founder). Ex-Google, 8 years in ML.')], ctx());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G4', relatedClaimIds: ['team1'] });
  });

  // Apanhado pela revisão adversarial (Prompt 310): G4 agora abrange QUATRO
  // categorias, não uma — sem meta.category, /api/blueprint/answer
  // ficava sempre a arquivar a resposta sob CATEGORY_BY_RULE.G4
  // ('prova_tecnica'), mesmo quando a lacuna era de equipa/tracao_gtm/
  // validacao_externa. Mesmo tratamento que o G7 já tinha.
  it('carrega a categoria ORIGINAL do claim em meta.category, para as 4 categorias que ainda dispara', () => {
    for (const category of ['prova_tecnica', 'validacao_externa', 'tracao_gtm', 'equipa'] as const) {
      const gaps = ruleG4([claim(`x-${category}`, category, 'some accepted statement with plenty of specificity, 2026')], ctx());
      expect(gaps[0]?.meta?.category).toBe(category);
    }
  });

  // Prompt 310 — os dois exemplos REAIS que o Nuno mostrou no bug report,
  // palavra por palavra (orgProfileToAtoms produz exactamente estas frases).
  it('cenário real ablute_: nem o posicionamento nem o ask geram G4 — "Resultado esperado" do prompt', () => {
    const claims = [
      claim('mkt1', 'mercado_timing', 'Operating in Digital Health, MedTech & Medical Devices from Portugal.', { sourceKind: 'profile' }),
      claim('ask1', 'ask', 'Raising €300k via equity/convertible_note/grant/safe, at a €4.5M valuation.', { sourceKind: 'profile' }),
      // Um par documentável, para confirmar que baixar a contagem não é
      // "G4 parou de funcionar de todo" — só deixou de disparar onde não
      // fazia sentido.
      claim('proof1', 'prova_tecnica', 'CE-marked as a Class IIa medical device since 2025.'),
    ];
    const gaps = ruleG4(claims, ctx({ hasVaultDocuments: false }));
    expect(gaps.map((g) => g.relatedClaimIds[0])).toEqual(['proof1']);
    expect(gaps.every((g) => ['prova_tecnica', 'validacao_externa', 'tracao_gtm', 'equipa'].includes(
      claims.find((c) => c.id === g.relatedClaimIds[0])?.category ?? '',
    ))).toBe(true);
  });

  // Prompt 358 Phase 1 — a founder's honest "no document exists/will
  // exist" answer must close G4 for good, same as a real document link.
  it.each(['no_document', 'document_pending'] as const)(
    'gapDisposition=%s suppresses G4 permanently, same as a real document link',
    (disposition) => {
      const claimWithDisposition = claim('team-x', 'equipa', 'Jane Doe, CTO (founder). Ex-Google, 8 years in ML.', { gapDisposition: disposition });
      expect(ruleG4([claimWithDisposition], ctx())).toEqual([]);
    },
  );

  it('a claim with no disposition and no document still asks — the fix never silently loosens the real gate', () => {
    const claimWithout = claim('team-x', 'equipa', 'Jane Doe, CTO (founder). Ex-Google, 8 years in ML.', { gapDisposition: null });
    expect(ruleG4([claimWithout], ctx())).toHaveLength(1);
  });
});

describe('G5 — staleness', () => {
  it('além dos 6 meses (default) dispara', () => {
    const gaps = ruleG5([claim('s1', 'solucao', 'the device is in clinical testing', { updatedAt: '2025-06-01T00:00:00Z' })], ctx());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('6 months');
  });

  it('o limite é parametrizável', () => {
    const stale = claim('s1', 'solucao', 'the device is in clinical testing', { updatedAt: '2026-06-01T00:00:00Z' });
    expect(ruleG5([stale], ctx())).toEqual([]);
    expect(ruleG5([stale], ctx({ staleMonths: 1 }))).toHaveLength(1);
  });
});

describe('G6 — mecanismo da ronda', () => {
  it('funding/ask sem uso-de-fundos nem porquê-agora dispara com ambos em falta', () => {
    const gaps = ruleG6([claim('f1', 'ask', 'we are raising €1.3M')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].meta?.missing).toBe('use of funds, why now');
  });

  it('o porquê-agora pode viver em mercado_timing', () => {
    const gaps = ruleG6([
      claim('f1', 'ask', 'we are raising €1.3M to hire two engineers and finish certification'),
      claim('m1', 'mercado_timing', 'new EU hygiene regulation takes effect in 2027 — the window is now'),
    ]);
    expect(gaps).toEqual([]);
  });
});

describe('G7 — claim central isolado (Prompt 299 §2)', () => {
  it('dispara quando forte+específico e sem nome extraível — confiança high', () => {
    const gaps = ruleG7([claim('c-iso1', 'solucao', 'In 2026, we signed a contract worth €50,000 for the pilot deployment')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G7', severity: 'high', detectionConfidence: 'high', relatedClaimIds: ['c-iso1'] });
  });

  it('dispara quando forte+específico com nome extraível e sem corroboração — confiança low, severity reduzida', () => {
    const gaps = ruleG7([VISITA_RESPONDIDA]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ rule: 'G7', severity: 'medium', detectionConfidence: 'low' });
  });

  it('não dispara quando há outro claim aceite na MESMA categoria (nível 1)', () => {
    const gaps = ruleG7([
      VISITA_RESPONDIDA,
      claim('c-other', 'validacao_externa', 'Beta Ltd signed a paid pilot with us in 2026, contract worth €20,000'),
    ]);
    expect(gaps).toEqual([]);
  });

  it('não dispara quando o MESMO NOME aparece noutro claim aceite (nível 2)', () => {
    const gaps = ruleG7([
      VISITA_RESPONDIDA,
      claim('c-other', 'equipa', 'Acme Corp introduced us to their CTO, who now advises our team since 2026'),
    ]);
    expect(gaps).toEqual([]);
  });

  it('não dispara sobre claims propostos (só claims aceites contam)', () => {
    expect(ruleG7([{ ...VISITA_RESPONDIDA, status: 'proposed' }])).toEqual([]);
  });

  // Prompt 358 Phase 1 — "Confirmed, it stays as-is" must stop the SAME
  // claim from being re-flagged as isolated forever; without this the
  // founder's own confirmation is powerless against a rule that keeps
  // re-detecting the exact same isolation on every reload.
  it('gapDisposition=confirmed suppresses G7 for that claim, even though nothing else corroborates it', () => {
    const confirmed = { ...VISITA_RESPONDIDA, gapDisposition: 'confirmed' as const };
    expect(ruleG7([confirmed])).toEqual([]);
  });

  it('não dispara sobre classe 4/5 fora de problema/solucao — mecanismo/decoração não pretendem ser "a" alegação central', () => {
    expect(ruleG7([PREMIO])).toEqual([]); // PREMIO é classe 5 (decoração)
    expect(ruleG7([claim('c-mkt', 'mercado_timing', 'the EU regulation window opens in Q1 2027 for certified devices')])).toEqual([]);
  });
});

describe('G8 — incongruência no valor da ronda (Prompt 310 §B)', () => {
  it('dispara quando o montante alvo difere entre dois claims da ronda actual', () => {
    const gaps = ruleG8([
      claim('ask1', 'ask', 'Raising €300k via equity/convertible_note/grant/safe, at a €4.5M valuation.', { sourceKind: 'profile' }),
      claim('fact1', 'funding', 'We are targeting €250k for this pre-seed round.', { sourceKind: 'fact' }),
    ]);
    const targetGap = gaps.find((g) => g.meta?.field === 'target amount');
    expect(targetGap).toMatchObject({ rule: 'G8', severity: 'high' });
    expect(targetGap?.relatedClaimIds).toEqual(['ask1', 'fact1']);
    expect(targetGap?.message).toContain('€300k');
    expect(targetGap?.message).toContain('€250k');
    expect(targetGap?.message).not.toContain('anexa'); // nunca "anexa um documento" — pedido explícito
  });

  it('dispara quando a valuation difere entre dois claims', () => {
    const gaps = ruleG8([
      claim('ask1', 'ask', 'Raising €300k via safe, at a €4.5M valuation.', { sourceKind: 'profile' }),
      claim('fact1', 'funding', 'Seeking investment at a valuation of €3M.', { sourceKind: 'fact' }),
    ]);
    const valGap = gaps.find((g) => g.meta?.field === 'valuation');
    expect(valGap).toBeTruthy();
    expect(valGap?.message).toContain('€4.5M');
    expect(valGap?.message).toContain('€3M');
  });

  it('dispara quando o instrumento é completamente disjunto entre dois claims', () => {
    const gaps = ruleG8([
      claim('a1', 'ask', 'Raising €300k via equity only.', { sourceKind: 'profile' }),
      claim('a2', 'funding', 'We are raising this round exclusively via SAFE.', { sourceKind: 'fact' }),
    ]);
    const instrGap = gaps.find((g) => g.meta?.field === 'instrument');
    expect(instrGap).toMatchObject({ rule: 'G8', severity: 'high' });
  });

  it('NÃO dispara quando um claim lista o menu inteiro e outro só refere um instrumento já incluído nesse menu', () => {
    const gaps = ruleG8([
      claim('ask1', 'ask', 'Raising €300k via equity/convertible_note/grant/safe, at a €4.5M valuation.', { sourceKind: 'profile' }),
      claim('a2', 'funding', 'We would be raising via safe for simplicity.', { sourceKind: 'fact' }),
    ]);
    expect(gaps.filter((g) => g.meta?.field === 'instrument')).toEqual([]);
  });

  it('NÃO dispara quando só há um claim de funding/ask (nada para comparar)', () => {
    expect(ruleG8([claim('ask1', 'ask', 'Raising €300k, at a €4.5M valuation.', { sourceKind: 'profile' })])).toEqual([]);
  });

  it('NÃO dispara quando os dois claims dizem o MESMO valor', () => {
    expect(ruleG8([
      claim('ask1', 'ask', 'Raising €300k.', { sourceKind: 'profile' }),
      claim('fact1', 'funding', 'Target: €300k for this round.', { sourceKind: 'fact' }),
    ])).toEqual([]);
  });

  it('exclui uma ronda ANTERIOR fechada — não é o ask actual, comparar seria uma falsa incongruência', () => {
    const gaps = ruleG8([
      claim('ask1', 'ask', 'Raising €300k, at a €4.5M valuation.', { sourceKind: 'profile' }),
      claim('fr1', 'funding', 'Seed of €500k closed in 2023.', { sourceKind: 'funding_round' }),
    ]);
    expect(gaps).toEqual([]);
  });

  it('nunca dispara sobre categorias fora de funding/ask, mesmo com números diferentes', () => {
    expect(ruleG8([
      claim('t1', 'tracao_gtm', 'Raising awareness with 300 leads generated.'),
      claim('t2', 'tracao_gtm', 'Raising awareness with 250 leads generated.'),
    ])).toEqual([]);
  });

  it('claims propostos (não aceites) não entram na comparação', () => {
    expect(ruleG8([
      claim('ask1', 'ask', 'Raising €300k.', { sourceKind: 'profile', status: 'accepted' }),
      claim('a2', 'funding', 'Targeting €250k.', { sourceKind: 'fact', status: 'proposed' }),
    ])).toEqual([]);
  });

  it('uma frase sem valor extraível fica de fora da comparação — nunca tratada como discordância (mecânico, nunca "vibes")', () => {
    expect(ruleG8([
      claim('ask1', 'ask', 'Raising €300k.', { sourceKind: 'profile' }),
      claim('a2', 'funding', 'We are raising a substantial amount for growth.', { sourceKind: 'fact' }),
    ])).toEqual([]);
  });

  it('é puramente mecânico — mesmo input dá sempre a mesma saída', () => {
    const claims = [
      claim('ask1', 'ask', 'Raising €300k, at a €4.5M valuation.', { sourceKind: 'profile' }),
      claim('fact1', 'funding', 'Targeting €250k.', { sourceKind: 'fact' }),
    ];
    expect(ruleG8(claims)).toEqual(ruleG8(claims));
  });

  // ---------------------------------------------------------------------
  // Casos apanhados pela revisão adversarial (Prompt 310) — cada um é um
  // falso positivo REAL que o mecanismo anterior teria disparado.
  describe('falsos positivos apanhados pela revisão adversarial', () => {
    it('F1 — a frase "Use of funds" (gerada a par do ask pelos MESMOS campos de Settings) nunca entra na comparação de montante', () => {
      const gaps = ruleG8([
        claim('ask1', 'ask', 'Raising €300k.', { sourceKind: 'profile' }),
        claim('funds1', 'funding', 'Use of funds: Hiring two engineers and targeting our first paid pilot worth €15k in Q2.', { sourceKind: 'profile' }),
      ]);
      expect(gaps).toEqual([]);
    });

    it('F2 — uma ronda anterior sem a palavra "closed" no texto (ex. sem closed_year) continua excluída, por sourceKind estrutural', () => {
      const gaps = ruleG8([
        claim('ask1', 'ask', 'Raising €300k.', { sourceKind: 'profile' }),
        claim('fr1', 'funding', 'Bridge of €150k. Verbal commitment from an angel, still targeting a formal close before Q3.', { sourceKind: 'funding_round' }),
      ]);
      expect(gaps).toEqual([]);
    });

    it('F3 — uma menção NEGADA de instrumento ("not raising via debt") nunca conta como nomear esse instrumento', () => {
      const gaps = ruleG8([
        claim('a1', 'ask', 'Raising €300k via equity only.', { sourceKind: 'profile' }),
        claim('a2', 'funding', 'We are not raising via debt for this round.', { sourceKind: 'fact' }),
      ]);
      expect(gaps.filter((g) => g.meta?.field === 'instrument')).toEqual([]);
    });

    it('F4 — uma frase com DUAS palavras-chave de montante (tranche/frase ambígua) fica de fora em vez de a heurística "mais próximo" adivinhar mal', () => {
      const gaps = ruleG8([
        claim('a1', 'ask', 'We considered targeting €1M as a stretch amount, but are actually raising just €300k for this round.', { sourceKind: 'fact' }),
        claim('a2', 'ask', 'Raising €300k.', { sourceKind: 'profile' }),
      ]);
      expect(gaps).toEqual([]);
    });

    it('F5a — "€300.000" (separador de milhares ao estilo europeu, sem sufixo) não é lido 1000x mais pequeno', () => {
      const gaps = ruleG8([
        claim('a1', 'ask', 'Raising €300k.', { sourceKind: 'profile' }),
        claim('a2', 'funding', 'Confirming the round target is €300.000, same as before.', { sourceKind: 'fact' }),
      ]);
      expect(gaps).toEqual([]);
    });

    it('F5b — "€0,3M" (vírgula decimal ao estilo europeu, com sufixo) não é lido 10x maior', () => {
      const gaps = ruleG8([
        claim('a1', 'ask', 'Raising this round at a €0,3M valuation.', { sourceKind: 'profile' }),
        claim('a2', 'funding', 'Seeking investment at a valuation of €300k.', { sourceKind: 'fact' }),
      ]);
      // €0,3M == €300k — não deve disparar por causa da vírgula decimal.
      expect(gaps.filter((g) => g.meta?.field === 'valuation')).toEqual([]);
    });

    it('F6 — moedas diferentes nunca são comparadas entre si (nem concordam, nem discordam)', () => {
      const gaps = ruleG8([
        claim('a1', 'ask', 'Raising $300k.', { sourceKind: 'profile' }),
        claim('a2', 'funding', 'Targeting €300k.', { sourceKind: 'fact' }),
      ]);
      expect(gaps).toEqual([]);
    });

    it('F7 — instrumentos no PLURAL (SAFEs, convertible notes, grants) são reconhecidos, não silenciosamente ignorados', () => {
      const gaps = ruleG8([
        claim('a1', 'ask', 'Raising €300k exclusively via SAFEs.', { sourceKind: 'profile' }),
        claim('a2', 'funding', 'We are raising this round exclusively via convertible notes.', { sourceKind: 'fact' }),
      ]);
      const instrGap = gaps.find((g) => g.meta?.field === 'instrument');
      expect(instrGap).toBeTruthy();
    });
  });
});

describe('detectGaps — agregação', () => {
  it('a ablute_ de hoje (prémio + visita vaga) dispara exatamente o esperado', () => {
    const gaps = detectGaps([PREMIO, VISITA_VAGA], ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }));
    const rules = gaps.map((g) => g.rule);
    expect(rules).toContain('G1');   // nenhuma tração paga
    expect(rules).toContain('G2');   // a visita vaga
    expect(rules).toContain('G3');   // equipa só-Carla
    expect(rules).toContain('G3b');  // Rui sem narrativa
    expect(rules).toContain('G3c');  // ninguém lidera a técnica
    expect(rules).toContain('G4');   // sem documento de suporte
    expect(rules).toContain('G6');   // sem uso de fundos / porquê agora
    expect(rules).not.toContain('G5'); // atualizado há duas semanas
  });

  it('não lança com input vazio', () => {
    expect(() => detectGaps([], ctx())).not.toThrow();
    expect(detectGaps([], ctx()).map((g) => g.rule).sort()).toEqual(['G1', 'G3', 'G3c', 'G6']);
  });
});

describe('templateFor — os templates são dados, preenchidos por meta', () => {
  it('há exatamente uma template por regra', () => {
    expect(QUESTION_TEMPLATES.map((t) => t.rule).sort()).toEqual(['G1', 'G2', 'G3', 'G3b', 'G3c', 'G4', 'G5', 'G6', 'G7', 'G8']);
  });

  it('G2 injeta o statement do claim vago', () => {
    const t = templateFor(ruleG2([VISITA_VAGA])[0]);
    expect(t.question).toContain("the world's manufacturing leader");
    expect(t.question).not.toContain('{statement}');
    expect(t.freeTextLabel).toBe('Name + date + outcome');
  });

  it('G3b injeta o nome descoberto e quem já está coberto', () => {
    const gap = ruleG3b([PREMIO], ctx({ founders: [{ name: 'Carla Dias' }, { name: 'Rui Almeida' }] }))[0];
    const t = templateFor(gap);
    expect(t.question).toContain('Rui Almeida');
    expect(t.question).toContain('Carla Dias');
    expect(t.options).toContain('Full-time');
  });

  it('G3c oferece "No one yet" — a ausência é para reportar, não esconder', () => {
    const t = templateFor(ruleG3c([PREMIO], ctx())[0]);
    expect(t.question).toBe('Who leads the technical side?');
    expect(t.options).toContain('No one yet');
  });

  it('G7 options are English — the Portuguese leak from Prompt 299 is fixed', () => {
    const t = QUESTION_TEMPLATES.find((x) => x.rule === 'G7')!;
    expect(t.options).toEqual(['I\'ll develop this further', 'Confirmed, it stays as-is', 'Actually, it\'s not that central']);
  });
});

// Prompt 358 Phase 1 — routeAnswer is the exact decision that used to be
// missing: it's what /api/blueprint/answer consults BEFORE ever touching
// company_claims. Every case here is a real chip from QUESTION_TEMPLATES,
// checked against the exact "no free text" condition that used to insert
// it verbatim as a new claim.
describe('routeAnswer — Prompt 358 Phase 1: which answers are claims, and which are not', () => {
  it('free text always routes to a real claim, regardless of which chip (if any) was also picked', () => {
    expect(routeAnswer('G1', 'Not yet', true)).toEqual({ kind: 'claim' });
    expect(routeAnswer('G4', 'No document yet', true)).toEqual({ kind: 'claim' });
    expect(routeAnswer('G7', undefined, true)).toEqual({ kind: 'claim' });
  });

  it('the fixture bugs from Nuno\'s real session: "Not yet" / "yes, there is"-style fillers never become claims', () => {
    expect(routeAnswer('G1', 'Not yet', false)).toEqual({ kind: 'dismiss' });
    expect(routeAnswer('G2', 'No follow-up yet', false)).toEqual({ kind: 'dismiss' });
    expect(routeAnswer('G3c', 'No one yet', false)).toEqual({ kind: 'dismiss' });
    expect(routeAnswer('G5', 'No longer applies', false)).toEqual({ kind: 'dismiss' });
    expect(routeAnswer('G7', 'I\'ll develop this further', false)).toEqual({ kind: 'dismiss' });
    expect(routeAnswer('G7', 'Actually, it\'s not that central', false)).toEqual({ kind: 'dismiss' });
  });

  it('G4\'s three options each route somewhere real, never as verbatim claim text', () => {
    expect(routeAnswer('G4', 'Yes — I will attach it', false)).toEqual({ kind: 'attach_document' });
    expect(routeAnswer('G4', 'It exists but is not in the Vault yet', false)).toEqual({ kind: 'set_disposition', disposition: 'document_pending' });
    expect(routeAnswer('G4', 'No document yet', false)).toEqual({ kind: 'set_disposition', disposition: 'no_document' });
  });

  it('G5 "Still true" refreshes the existing claim instead of creating a duplicate', () => {
    expect(routeAnswer('G5', 'Still true', false)).toEqual({ kind: 'refresh_claim' });
  });

  it('G7 "Confirmed, it stays as-is" sets a disposition, never a claim', () => {
    expect(routeAnswer('G7', 'Confirmed, it stays as-is', false)).toEqual({ kind: 'set_disposition', disposition: 'confirmed' });
  });

  it('a chip that IS the substance (no filler) still becomes a real claim — G3\'s narrative options, G1\'s real traction answers', () => {
    expect(routeAnswer('G1', 'Yes — paying customer', false)).toEqual({ kind: 'claim' });
    expect(routeAnswer('G3', 'We have complementary skills', false)).toEqual({ kind: 'claim' });
    expect(routeAnswer('G6', 'Hiring', false)).toEqual({ kind: 'claim' });
  });

  it('an unrecognized rule/option combination defaults to claim, never silently drops an answer', () => {
    expect(routeAnswer('G8', undefined, false)).toEqual({ kind: 'claim' });
  });
});
