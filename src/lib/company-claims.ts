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
import type { EvidenceClass, ClaimCategory, ClaimSpecificity, ClaimSourceKind, CompanyClaim, DocumentRef } from './types';

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
// mesmo quando a frase fala de equipa. Exportado (Prompt 358 §3.4) —
// strengthenGaps abaixo reutiliza o MESMO sinal: um prémio já É o
// resultado, por isso nunca lhe falta "outcome" da mesma forma que falta a
// um claim de tracao_gtm/validacao_externa.
export const DECORATION = /\b(award|awardee|prize|winner|finalist|featured in|press|prémio|premio|vencedor|finalista)\b/i;

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

// Prompt 311 §C — exportado (era só o regex privado por trás de
// hasNamedEntity) para que a deteção de duplicados abaixo reutilize o MESMO
// sinal, já calculado, em vez de uma segunda extração de nome.
//
// Nota de comportamento (herdada do NAMED_ENTITY original, não nova aqui):
// (?!^) bloqueia um match a começar na posição 0, por isso um nome que abre
// a própria frase ("Carla Dias won...") só é capturado a partir da SEGUNDA
// palavra ("Dias"), nunca o nome completo. Inofensivo para hasNamedEntity
// (só importava presença) e ainda útil aqui — "Dias" continua a ser uma
// chave de comparação razoável — mas um futuro leitor não deve assumir que
// isto devolve sempre o nome completo.
export function extractNamedEntity(statement: string): string | null {
  return NAMED_ENTITY.exec(statement)?.[0] ?? null;
}

export function measureSpecificity(statement: string): { level: ClaimSpecificity; signals: SpecificitySignals } {
  const signals: SpecificitySignals = {
    hasNamedEntity: extractNamedEntity(statement) !== null,
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
// Prompt 358 §3.4 — "Strengthen your claims": which of who/when/outcome a
// SPECIFIC claim is actually missing, mechanically (never a repeated
// template). Returns null for two distinct reasons the caller must NOT
// conflate: (a) the claim is already specific enough — nothing to say, panel
// stays silent for it; (b) the claim is INELIGIBLE — echo claims (Phase 1
// already kills these at the source), and anything from a structured field
// (ask/funding's own terms, the org/person profile fields) that is specific
// by construction and never needed this panel's help.
export type StrengthenDimension = 'who' | 'when' | 'outcome';

const STRUCTURED_SOURCE_KINDS = new Set<ClaimSourceKind>(['profile', 'funding_round']);
const STRUCTURED_CATEGORIES = new Set<ClaimCategory>(['ask', 'funding']);

// Prompt 374 §B — a real amount (€100k, $2M, "50 mil euros"...) is the third
// leg of "this is a concluded, verifiable fact" alongside a named entity and
// a date. Deliberately separate from measureSpecificity's own `hasNumber`
// (used everywhere for the high/medium/low score): widening that shared
// signal to "looks like money" would silently shift specificity scoring for
// every claim in the app, not just this one card's "outcome" question.
const AMOUNT_OR_MONEY = /(?:[€$£]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:k|m|mil|milhão|milhões|million)\b|\bEUR\b)/i;

// Prompt 374 §B — the real ablute_ case: "We have raised 100k in 2020 as
// pre-seed investment from Portugal Ventures" got told "Missing: the
// outcome" even though it names who (Portugal Ventures), when (2020) and
// how much (100k) — there is no outcome PENDING, it's a fact that already
// happened. Two independent fixes, either one alone would have silenced
// this exact case (the claim's category was ALSO wrong — 'solucao' instead
// of 'funding' — see the claim route's category-edit comment):
//   1. "outcome" is only ever asked of categories where an outcome concept
//      applies at all — an ongoing relationship (a pilot, a test, a
//      partnership) can stall or land; a problem statement or a team bio
//      never has an "outcome" to report.
//   2. even within those categories, a claim that already names who + when
//      + a real amount is self-evidently concluded — asking it for an
//      "outcome" on top is asking a closed fact to justify itself twice.
const OUTCOME_RELEVANT_CATEGORIES = new Set<ClaimCategory>(['tracao_gtm', 'validacao_externa']);

export function strengthenGaps(
  c: { category: ClaimCategory; statement: string; sourceKind: ClaimSourceKind },
): StrengthenDimension[] | null {
  if (STRUCTURED_SOURCE_KINDS.has(c.sourceKind) || STRUCTURED_CATEGORIES.has(c.category)) return null;
  const { signals } = measureSpecificity(c.statement);
  const isDecoration = DECORATION.test(c.statement);
  const isConcludedFact = signals.hasNamedEntity && signals.hasDate && AMOUNT_OR_MONEY.test(c.statement);
  const missing: StrengthenDimension[] = [];
  if (!signals.hasNamedEntity) missing.push('who');
  if (!signals.hasDate) missing.push('when');
  // A prize/award IS the outcome — never ask a decoration claim for one.
  if (!isDecoration && !isConcludedFact && OUTCOME_RELEVANT_CATEGORIES.has(c.category) && !signals.hasOutcome) {
    missing.push('outcome');
  }
  return missing.length > 0 ? missing : null;
}

// Prompt 374 §B — "each card explains itself": investor-facing framing for
// WHY a missing dimension matters, plus a concrete example of what would
// fill it in. Never references the claim's actual text (that stays the
// card's job) — this is the generic, dimension-level explanation.
export const DIMENSION_EXPLANATION: Record<StrengthenDimension, { why: string; example: string }> = {
  who: {
    why: "An investor can't verify this without knowing WHO exactly was involved.",
    example: 'e.g. "Hospital de Braga" instead of "a hospital".',
  },
  when: {
    why: "An investor can't tell if this is recent or years old without a date.",
    example: 'e.g. "started in March 2026" instead of no date at all.',
  },
  outcome: {
    why: "An investor can't tell what actually happened — a conversation isn't a result.",
    example: 'e.g. "signed a paid pilot" instead of describing the conversation that led to it.',
  },
};

// Prompt 374 §A — the count Review/Blueprint's one-line summary needs,
// exported so it uses the EXACT SAME eligibility rule as the real panel
// (StrengthenClaimsPanel, now living only in the Action plan tab) instead
// of a second, possibly drifting copy of "accepted, not dismissed, and
// strengthenGaps says so".
export function claimsNeedingStrengthening(
  claims: { status: string; category: ClaimCategory; statement: string; sourceKind: ClaimSourceKind; strengthenDismissedAt?: string | null }[],
): number {
  return claims.filter((c) => c.status === 'accepted' && !c.strengthenDismissedAt && strengthenGaps(c) !== null).length;
}

// Prompt 374 §B — "de onde veio este claim": today the founder has no way to
// tell why a given sentence is sitting in front of them. Mechanical, never
// guessed — sourceKind is a real, stored column (migration 0176).
export function claimProvenanceLabel(c: { sourceKind: ClaimSourceKind; sourceRef?: string | null }): string {
  switch (c.sourceKind) {
    case 'vault_doc': return 'From a document in your Vault';
    case 'roadmap': return 'From your roadmap';
    case 'profile': return 'From your company profile';
    case 'funding_round': return 'From a funding round you logged';
    case 'founder_answer': return c.sourceRef?.startsWith('gap:') ? 'From a question you answered' : 'From your own answer';
    case 'fact': return 'From a confirmed company fact';
    case 'web_research': return 'From Sherlock web research you accepted';
    default: return 'Origin unknown';
  }
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

// Prompt 367 — a claim gravada por /api/blueprint/answer junta sempre
// `chip — texto livre`, mas um founder a continuar a frase do próprio chip
// naturalmente REPETE-o ("Not yet" + "Not yet. Building what we're
// developing...") — sem guarda, isso gravava "Not yet — Not yet. Building
// ...", literalmente duplicado, para sempre na claim. Deteta a sobreposição
// (comparação normalizada: trim + lowercase, insensível a pontuação a
// seguir ao chip) e usa só o texto livre sozinho quando ele já começa pelo
// próprio chip; mantém `chip — texto` sem alterações em qualquer outro caso.
export function joinChipAndFreeText(option: string | undefined, answerText: string | undefined): string {
  const opt = option?.trim();
  const text = answerText?.trim();
  if (opt && text) {
    const normOpt = opt.toLowerCase();
    // Só as letras/números do início do texto livre, até ao comprimento do
    // chip — ignora pontuação a seguir ("Not yet." vs "Not yet") sem exigir
    // um match byte-a-byte.
    const normTextStart = text.slice(0, opt.length).toLowerCase();
    if (normTextStart === normOpt) return text;
  }
  return [opt, text].filter(Boolean).join(' — ');
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

// ---------------------------------------------------------------------------
// Prompt 307 §B2 — a UI já promete "Its strength is measured from what you
// write" (GapInterrogation.tsx); measureSpecificity acima É essa avaliação,
// mas nada agia sobre um resultado fraco. Isto fecha o ciclo: 'low'
// specificity é o mesmo sinal mecânico que faz rankForNarrative pôr um claim
// no fim da fila (nunca "vibes" — ver o cabeçalho do ficheiro) — aqui vira
// uma sugestão para o founder, no estilo do exemplo do Nuno (aprofundar OU
// arranjar alternativa), nunca investor-facing. O claim em si (categoria,
// texto, classe de evidência) fica intocado — só passa a existir, a par
// dele, esta ilação para quem o escreveu.
export const CATEGORY_LABEL: Record<ClaimCategory, string> = {
  problema: 'problem', solucao: 'solution', prova_tecnica: 'technical proof',
  validacao_externa: 'external validation', tracao_gtm: 'traction', equipa: 'team',
  mercado_timing: 'market timing', funding: 'funding', ask: 'ask',
};

export function weakClaimCoachingNote(claim: Pick<NormalizedClaim, 'category' | 'specificity'>): string | null {
  if (claim.specificity !== 'low') return null;
  const label = CATEGORY_LABEL[claim.category];
  return `This ${label} claim is written broadly — naming who was involved, a date, or the concrete outcome would `
    + `make it verifiable. If this specific one has stalled, finding an alternative to point to instead would `
    + `strengthen your ${label} story just as much.`;
}

// ---------------------------------------------------------------------------
// Prompt 311 §C — the ablute_ real case: the SAME award (Carla Dias /
// WomenTechEU) exists today as 4 separate claims from 4 sources (a
// confirmed fact, the profile bio, a roadmap item, and — before Part A of
// this same prompt removed it — a Vault document row), never linked, each
// independently measured (so the identical underlying fact reads 'low' in
// one place and 'high' in another). General semantic dedup is explicitly
// out of scope here (this file's own root discipline: classification is
// mechanical, never AI/"vibes" — see the header above) — but this ONE
// narrow, already-computed signal catches the ablute_ case and its shape:
// DECORATION already marks "awardee/prize/winner/…" as class 5 regardless
// of category (classifyEvidence above), and hasNamedEntity/extractNamedEntity
// already extracts the name. A new claim that is class-5 AND names someone
// already named in an existing class-5 claim (in ANY category — the whole
// point is these four span different categories) is flagged as a possible
// duplicate instead of being proposed as an independent new claim — the
// founder sees both statements side by side and decides once, rather than
// reconciling four claims on their own.
//
// Deliberately NOT: fuzzy text similarity, a second regex against arbitrary
// phrasing, or anything beyond this one signal — a claim that merely SHARES
// a topic without being class-5 decoration is never flagged.
//
// Known, accepted limitation (adversarial review): a short or common
// extracted fragment (a shared surname, or a name that's also a place —
// "Rio" inside "Rio de Janeiro") can cross-flag two UNRELATED class-5 claims
// as possible duplicates of each other. No word-boundary tightening or
// length floor fixes this in general (the ablute_ case itself only extracts
// as "Dias", not "Carla Dias" — see extractNamedEntity's own note — so
// raising a length threshold would break the exact case this exists for).
// Accepted because the cost of a false positive here is one dismissable UI
// suggestion, never a hidden gap, a data mutation, or a wrong number shown
// to anyone — nothing like G4/G8's stakes, where this file's root
// discipline treats an unnecessary flag as far more costly.
export function findDuplicateCandidate(
  candidate: Pick<CompanyClaim, 'id' | 'statement' | 'evidenceClass'>,
  pool: Pick<CompanyClaim, 'id' | 'statement' | 'status' | 'evidenceClass'>[],
): { id: string; statement: string } | null {
  if (candidate.evidenceClass !== 5) return null;
  const name = extractNamedEntity(candidate.statement);
  if (!name) return null;
  const match = pool.find((c) =>
    c.id !== candidate.id
    && (c.status === 'accepted' || c.status === 'proposed')
    && c.evidenceClass === 5
    && c.statement.toLowerCase().includes(name.toLowerCase()));
  return match ? { id: match.id, statement: match.statement } : null;
}

// ---------------------------------------------------------------------------
// Prompt 313 §B — the real fix behind the ablute_ WomenTechEU case: a signed
// Grant Agreement sat in the Vault the whole time, but nothing ever read a
// document's CONTENT, so a claim like "Carla Dias is a WomenTechEU awardee"
// stayed unlinked forever no matter what the file was named
// (document-extraction.ts is what finally reads the content; this is the
// mechanical step that connects what it found back to an existing claim).
//
// EXACTLY the same mechanic as findDuplicateCandidate above, reused rather
// than reinvented: the claim must be class-5 (DECORATION — an award/prize/
// certification, regardless of category) with an extractable name, and here
// the comparison pool is FACTS FROM A DOCUMENT EXTRACTION instead of other
// claims. Bidirectional check (fact label found in the claim, OR the claim's
// extracted name found in the fact label) because either direction alone
// misses a real case: "Carla Dias is a WomenTechEU awardee" matches a
// named-entity fact labelled "Carla Dias" via the first direction, and a
// program fact labelled "WomenTechEU" via the second.
//
// containsWholeWord, not a bare substring .includes(): unlike
// findDuplicateCandidate above (claim-vs-claim, an already-documented,
// deliberately-accepted fuzziness — see its own header), this function's
// output is WRITTEN to document_refs and can silently suppress a real G4
// gap or show a wrong "Backed by" badge, so a bare substring match is a
// real bug here, not an acceptable one — e.g. a program fact labelled "ANI"
// would substring-match inside an unrelated claim statement containing
// "Daniela" (d-ANI-ela) with no word-boundary check. Caught by adversarial
// review before shipping.
function containsWholeWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

export interface DocumentFactRef {
  documentId: string;
  documentName: string;
  page: number | null;
  label: string;
}

export function findDocumentLinkCandidate(
  claim: Pick<CompanyClaim, 'evidenceClass' | 'statement'>,
  facts: DocumentFactRef[],
): DocumentRef | null {
  if (claim.evidenceClass !== 5) return null;
  const name = extractNamedEntity(claim.statement);
  if (!name) return null;
  const match = facts.find((f) => containsWholeWord(f.label, name) || containsWholeWord(claim.statement, f.label));
  return match ? { documentId: match.documentId, documentName: match.documentName, page: match.page } : null;
}

// Prompt 313 §B — the narrow, explicitly-scoped exception to "never generate
// a claim per document" (Prompt 311 §A's own removal of documentToAtom):
// only when an extraction surfaces a decoration-class fact (an award, prize,
// grant program, or certification — document-extraction.ts's own closed
// `programs` list) that no existing live claim already covers. It is born
// ALREADY documented (documentRefs set at creation), never as a bare 'low'-
// specificity claim asking the founder to fill in evidence that already
// exists.
//
// evidenceClass is hardcoded to 5 here rather than run through
// classifyEvidence(), deliberately: that function's DECORATION regex only
// fires on award-ish WORDS in the statement text, and would misfire (or
// simply fail to fire) on a plain certification name with none of those
// words. Here the class-5 status is known STRUCTURALLY — the fact came from
// the extraction's own "programs" bucket, which by construction only ever
// holds awards/certifications/programs — so asserting it directly is more
// reliable than hoping a regex built for founder-typed prose happens to
// match extracted document text too.
export interface ProposedDocumentClaim {
  category: ClaimCategory;
  statement: string;
  evidenceClass: EvidenceClass;
  specificity: ClaimSpecificity;
  sourceKind: ClaimSourceKind;
  sourceRef: string;
  documentRefs: DocumentRef[];
}

export function proposeClaimFromDocumentFact(
  fact: { label: string; page: number | null; documentId: string; documentName: string },
  pool: Pick<CompanyClaim, 'statement' | 'evidenceClass' | 'status'>[],
): ProposedDocumentClaim | null {
  // Word-boundary match, not a bare substring — same reasoning as
  // findDocumentLinkCandidate's containsWholeWord above: a short program
  // label like "ANI" would otherwise falsely match inside an unrelated
  // claim's "Daniela", silently swallowing a real new claim with no error.
  const alreadyCovered = pool.some((c) =>
    (c.status === 'accepted' || c.status === 'proposed')
    && c.evidenceClass === 5
    && containsWholeWord(c.statement, fact.label));
  if (alreadyCovered) return null;

  const statement = `${fact.label} — documented in ${fact.documentName}${fact.page != null ? ` (p. ${fact.page})` : ''}`;
  const { level } = measureSpecificity(statement);
  return {
    // A program/award/certification recognized by an outside body is, by
    // definition, external validation — a deliberate simplification (not a
    // general categorization engine) rather than trying to correlate the
    // program with a specific team member to justify 'equipa' instead.
    category: 'validacao_externa',
    statement,
    evidenceClass: 5,
    specificity: level,
    sourceKind: 'vault_doc',
    sourceRef: fact.documentId,
    documentRefs: [{ documentId: fact.documentId, documentName: fact.documentName, page: fact.page }],
  };
}
