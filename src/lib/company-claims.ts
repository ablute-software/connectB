// Prompt 219 bloco 1 — a unidade de conhecimento da narrativa: o CLAIM.
//
// A tese, em uma frase: a app passa a ser o sistema de registo da narrativa
// de investibilidade, e todas as superfícies que chegam a investidores bebem
// da mesma fonte classificada. Isto é o alicerce — a normalização de um
// átomo (um facto, um marco do roadmap, uma ronda anterior) num claim com
// categoria, classe de evidência e especificidade.
//
// Tudo aqui é PURO e mecânico de propósito. A classificação não pode ser
// "vibes" de um modelo: se a classe de evidência dependesse de uma chamada
// AI, dois runs dariam narrativas diferentes para os mesmos factos, e o
// founder deixaria de poder confiar no que a app lhe diz. O modelo entra
// depois (síntese, 1.5), sobre claims já classificados.
import type { EvidenceClass, ClaimCategory, ClaimSpecificity, ClaimSourceKind } from './types';

// ---------------------------------------------------------------------------
// Classe de evidência — a hierarquia acordada, do mais caro de falsificar ao
// mais barato. É a espinha de toda a síntese: escolher 2-3 claims da classe
// mais alta DISPONÍVEL é o que separa um pitch que abre com um cliente
// pagante de um que abre com um prémio.
//
//   1. compromisso pago de terceiros   (alguém arriscou dinheiro)
//   2. validação externa custosa       (alguém arriscou tempo/reputação)
//   3. equipa com direito de ganhar    (porque estes, e não outros)
//   4. mecanismo problema/solução      (porquê isto, porquê agora)
//   5. decoração                       (prémios, imprensa)
//
// A ordem NUMÉRICA é ascendente em força invertida: 1 é o mais forte. Está
// assim porque foi assim que o Nuno a escreveu, e inverter os números aqui
// para "ficar mais intuitivo" seria a app e a conversa passarem a falar
// línguas diferentes.
const CATEGORY_BASE_CLASS: Record<ClaimCategory, EvidenceClass> = {
  tracao_gtm: 1,
  validacao_externa: 2,
  equipa: 3,
  problema: 4,
  solucao: 4,
  prova_tecnica: 4,
  mercado_timing: 4,
  funding: 4,
  ask: 4,
};

// Sinais de que um claim de tração é mesmo classe 1 (dinheiro trocou de
// mãos ou está contratado) e não uma promessa.
const PAID_COMMITMENT = /\b(paying customer|paid pilot|contract signed|purchase order|revenue|invoiced|cliente pagante|contrato assinado)\b/i;
// Sinais de decoração — sobrepõem-se à categoria: um prémio é classe 5
// mesmo quando a frase fala de equipa.
const DECORATION = /\b(award|awardee|prize|winner|finalist|featured in|press|prémio|premio|vencedor|finalista)\b/i;

export function classifyEvidence(category: ClaimCategory, statement: string): EvidenceClass {
  if (DECORATION.test(statement)) return 5;
  if (category === 'tracao_gtm' && !PAID_COMMITMENT.test(statement)) {
    // Tração sem dinheiro é intenção, não compromisso: cai para validação.
    return 2;
  }
  return CATEGORY_BASE_CLASS[category];
}

// ---------------------------------------------------------------------------
// Especificidade — medida mecanicamente, nunca por opinião.
//
// É o que separa "um líder mundial de manufacturing visitou-nos uma semana"
// (impressionante e inútil: o investidor não pode verificar nada) de
// "{Nome} enviou um comité durante uma semana e estamos a negociar um LOI"
// (verificável, e portanto valioso). O primeiro é classe 2 com
// especificidade BAIXA — e é exactamente esse delta que faz a app parar e
// perguntar, em vez de escrever uma frase vaga com ar de forte.
export interface SpecificitySignals {
  hasNamedEntity: boolean;
  hasDate: boolean;
  hasNumber: boolean;
  hasOutcome: boolean;
}

// Nome próprio = maiúscula a meio da frase, ignorando o início e siglas
// comuns. Grosseiro por escolha: falha para menos (diz "sem nome" quando há
// um nome estranho), e falhar para menos aqui significa perguntar ao
// founder — que é o comportamento desejado.
const NAMED_ENTITY = /(?!^)\b[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]+)*/;
const DATE_OR_YEAR = /\b(19|20)\d{2}\b|\b(Q[1-4])\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i;
const NUMBER = /\d/;
const OUTCOME = /\b(signed|agreed|contracted|loi|mou|pilot|purchase|renewed|deployed|approved|certified|assinad[oa]|contratad[oa])\b/i;

export function measureSpecificity(statement: string): { level: ClaimSpecificity; signals: SpecificitySignals } {
  const signals: SpecificitySignals = {
    hasNamedEntity: NAMED_ENTITY.test(statement),
    hasDate: DATE_OR_YEAR.test(statement),
    hasNumber: NUMBER.test(statement),
    hasOutcome: OUTCOME.test(statement),
  };
  const score = Number(signals.hasNamedEntity) + Number(signals.hasDate)
    + Number(signals.hasNumber) + Number(signals.hasOutcome);

  // 3+ sinais = alta; 2 = média; 0-1 = baixa. O corte é conservador de
  // propósito: preferimos perguntar de mais a publicar uma frase que o
  // investidor não consegue verificar.
  const level: ClaimSpecificity = score >= 3 ? 'high' : score === 2 ? 'medium' : 'low';
  return { level, signals };
}

// ---------------------------------------------------------------------------
// Um átomo bruto (o que a ingestão 1.1 recolhe) vira claim.
export interface RawAtom {
  category: ClaimCategory;
  statement: string;
  sourceKind: ClaimSourceKind;
  sourceRef?: string;
  at?: string;
}

export interface NormalizedClaim extends RawAtom {
  evidenceClass: EvidenceClass;
  specificity: ClaimSpecificity;
  signals: SpecificitySignals;
}

export function normalizeAtom(atom: RawAtom): NormalizedClaim {
  const { level, signals } = measureSpecificity(atom.statement);
  return {
    ...atom,
    evidenceClass: classifyEvidence(atom.category, atom.statement),
    specificity: level,
    signals,
  };
}

// O delta que o 219 §1.3 chama G2 e que é "a lacuna mais valiosa de
// resolver": uma classe forte desperdiçada por falta de detalhe. O facto já
// existe — falta só o founder dizer o nome e o desfecho.
// (Bloco 2 alargou o parâmetro a Pick<> para a MESMA função servir o claim
// persistido de company-gaps.ts — reutilizar, não reimplementar.)
export function isWastedStrongClaim(claim: Pick<NormalizedClaim, 'evidenceClass' | 'specificity'>): boolean {
  return claim.evidenceClass <= 2 && claim.specificity === 'low';
}

// Ordena para a síntese: classe mais forte primeiro e, dentro da mesma
// classe, o mais específico à frente. É esta ordem que faz um pitch abrir
// pela visita nomeada em vez de abrir pelo prémio.
export function rankForNarrative(claims: NormalizedClaim[]): NormalizedClaim[] {
  const specRank: Record<ClaimSpecificity, number> = { high: 0, medium: 1, low: 2 };
  return [...claims].sort((a, b) =>
    a.evidenceClass - b.evidenceClass || specRank[a.specificity] - specRank[b.specificity]);
}
