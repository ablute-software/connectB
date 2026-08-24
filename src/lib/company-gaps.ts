// Prompt 219 bloco 2 (Prompt 221) — as regras de deteção de lacunas sobre o
// array de claims. Puro de ponta a ponta: nenhuma regra lança, nenhuma
// chama AI — duas execuções sobre os mesmos claims dão as mesmas lacunas,
// pela mesma razão que a classificação do bloco 1 é mecânica.
//
// Cada regra devolve Gap[] (vazio quando não dispara). detectGaps corre as
// oito e agrega. Os templates de pergunta são DADOS (QUESTION_TEMPLATES,
// array de config com placeholders), não strings soltas — o bloco 3 é que
// os liga ao fluxo interativo; aqui só templateFor(gap) os preenche.
import type { CompanyClaim, ClaimCategory } from './types';
import { isWastedStrongClaim, measureSpecificity, extractNamedEntity } from './company-claims';

export type GapRule = 'G1' | 'G2' | 'G3' | 'G3b' | 'G3c' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8';
export type GapSeverity = 'critical' | 'high' | 'medium';

export interface Gap {
  rule: GapRule;
  severity: GapSeverity;
  message: string;
  relatedClaimIds: string[];
  // Dados que o template da pergunta precisa de preencher (nome do founder
  // no G3b, função no G3c, statement no G2/G4/G5…).
  meta?: Record<string, string>;
  // Prompt 299 §3 — só o G7 usa isto. As outras sete regras são contagens/
  // presença exatas (sem ambiguidade a registar); o G7 é a primeira a fazer
  // um julgamento mais nebuloso ("nada mais desenvolve isto"), e a
  // confiança dessa deteção fica explícita em vez de escondida atrás da
  // mesma severity das outras. 'low' já reduz a severity nesta mesma regra
  // — ver o comentário junto a ruleG7.
  detectionConfidence?: 'high' | 'low';
}

export interface GapContext {
  // Founders/equipa core conhecidos (org.team / company_people) — o que o
  // G3b usa para medir assimetria POR NOME.
  founders: { name: string }[];
  sector?: string | null;
  stage?: string | null;
  now: Date;
  // G5 — meses até um claim ficar stale. Default 6.
  staleMonths?: number;
  // Prompt 311 §A — se a org tem ALGUM documento no Vault, lido DIRECTAMENTE
  // (documents/pastas, mesma leitura de company-knowledge-db.ts), nunca via
  // um claim materializado por ficheiro (documentToAtom, removido). Default
  // false/ausente quando o chamador não sabe (nunca assume "documentado").
  hasVaultDocuments?: boolean;
}

// ---------------------------------------------------------------------------
// G1 — tração sem NENHUM compromisso pago (classe 1): lacuna crítica. Zero
// claims de tracao_gtm também dispara — ausência total é o caso pior, não
// uma isenção.
export function ruleG1(claims: CompanyClaim[]): Gap[] {
  const tracao = claims.filter((c) => c.category === 'tracao_gtm');
  if (tracao.some((c) => c.evidenceClass === 1)) return [];
  return [{
    rule: 'G1', severity: 'critical',
    message: 'No paid traction: nothing in tracao_gtm shows money at risk (paying customer, paid pilot, purchase order).',
    relatedClaimIds: tracao.map((c) => c.id),
  }];
}

// G2 — classe forte desperdiçada por especificidade baixa. Reutiliza
// isWastedStrongClaim do bloco 1 (a MESMA função, assinatura alargada).
export function ruleG2(claims: CompanyClaim[]): Gap[] {
  return claims.filter(isWastedStrongClaim).map((c) => ({
    rule: 'G2' as const, severity: 'high' as const,
    message: `Strong claim wasted by vagueness: "${c.statement}" — no name, date or outcome an investor could verify.`,
    relatedClaimIds: [c.id],
    meta: { statement: c.statement },
  }));
}

// G3 — narrativa de equipa: <2 pessoas NOMEADAS, ou nenhuma frase de
// complementaridade ("porquê ESTA equipa"). O sinal de nome é o MESMO
// medidor do bloco 1 (measureSpecificity.hasNamedEntity), não um regex novo.
const COMPLEMENTARITY = /\b(complement|pairs|combines?|together|between them|complementar)\b/i;

export function ruleG3(claims: CompanyClaim[]): Gap[] {
  const equipa = claims.filter((c) => c.category === 'equipa');
  const named = equipa.filter((c) => measureSpecificity(c.statement).signals.hasNamedEntity);
  const hasComplementarity = equipa.some((c) => COMPLEMENTARITY.test(c.statement));
  const problems: string[] = [];
  if (named.length < 2) problems.push(`only ${named.length} named person(s)`);
  if (!hasComplementarity) problems.push('nothing explains why THIS team wins together');
  if (problems.length === 0) return [];
  return [{
    rule: 'G3', severity: 'high',
    message: `Team narrative gap: ${problems.join('; ')}.`,
    relatedClaimIds: equipa.map((c) => c.id),
  }];
}

// G3b (219-B) — assimetria por NOME: se pelo menos um founder conhecido já
// tem claims de equipa e outros não têm nenhum, cada um dos descobertos é
// uma lacuna própria. (Nenhum founder coberto é território do G3, não
// assimetria.) Cobertura = o nome aparece num claim de equipa — primeiro
// nome como palavra inteira ou nome completo, case-insensitive.
function claimNamesFounder(statement: string, name: string): boolean {
  const lower = statement.toLowerCase();
  if (lower.includes(name.toLowerCase())) return true;
  const first = name.split(/\s+/)[0];
  return new RegExp(`\\b${first}\\b`, 'i').test(statement);
}

export function ruleG3b(claims: CompanyClaim[], context: GapContext): Gap[] {
  const equipa = claims.filter((c) => c.category === 'equipa');
  if (context.founders.length < 2 || equipa.length === 0) return [];
  const covered = context.founders.filter((f) => equipa.some((c) => claimNamesFounder(c.statement, f.name)));
  const uncovered = context.founders.filter((f) => !covered.includes(f));
  if (covered.length === 0 || uncovered.length === 0) return [];
  return uncovered.map((f) => ({
    rule: 'G3b' as const, severity: 'medium' as const,
    message: `Team asymmetry: ${f.name} is a known founder but no team claim mentions them — the narrative reads as a one-person team.`,
    relatedClaimIds: equipa.map((c) => c.id),
    meta: { founderName: f.name, coveredNames: covered.map((c) => c.name).join(', ') },
  }));
}

// G3c (219-B) — funções críticas sem dono. Técnica SEMPRE; financeira
// quando o estágio pede (seed em diante — há uma ronda a sério para gerir).
// Cobertura = um claim (equipa ou prova_tecnica) que nomeia alguém E fala
// da função — "quem lidera isto" respondido.
// Exported (Prompt 308) — gap-assist's G3c draft reuses the EXACT same
// patterns to match a company_people.title against a function, rather than
// a second, potentially drifting regex.
export const FUNCTION_PATTERNS: Record<string, RegExp> = {
  technical: /\b(cto|technical|engineer|engineering|hardware|software|tech lead|t[eé]cnic\w*|engenh\w*)\b/i,
  financial: /\b(cfo|financ\w*|finance)\b/i,
};
export const FUNCTION_LABEL: Record<string, string> = { technical: 'technical', financial: 'financial' };

// "seed" ou "series X" pedem dono financeiro; PRE-seed não — e a distinção
// precisa de ser explícita, porque um /seed/ ingénuo casa dentro de
// "pre-seed" e passaria a exigir CFO a quem ainda não tem ronda para gerir
// (apanhado pelo teste 'pre-seed' antes de sair daqui).
const STAGE_NEEDS_FINANCE = /(?<!pre[-\s]?)\bseed\b|\bseries\b/i;

export function ruleG3c(claims: CompanyClaim[], context: GapContext): Gap[] {
  const required = ['technical'];
  if (context.stage && STAGE_NEEDS_FINANCE.test(context.stage)) required.push('financial');

  const candidates = claims.filter((c) => c.category === 'equipa' || c.category === 'prova_tecnica');
  return required.filter((fn) => !candidates.some((c) =>
    FUNCTION_PATTERNS[fn].test(c.statement) && measureSpecificity(c.statement).signals.hasNamedEntity,
  )).map((fn) => ({
    rule: 'G3c' as const, severity: 'high' as const,
    message: `No one answers "who leads the ${FUNCTION_LABEL[fn]} side" — a critical function for this stage has no named owner.`,
    relatedClaimIds: [],
    meta: { functionKey: fn, functionLabel: FUNCTION_LABEL[fn] },
  }));
}

// G4 — claim aceite sem documento no Vault a suportá-lo.
//
// Prompt 311 §A — deixou de existir um claim POR FICHEIRO (documentToAtom,
// removido de knowledgeToAtoms) só para este check poder ler "há vault_doc
// nesta categoria?" — 66 dos 68 itens da fila de revisão da ablute_ eram
// exactamente isto: "Document on file: {nome}.pdf", uma frase que não diz
// nada que o founder não saiba já, a pedir Accept/Edit/Reject como se fosse
// narrativa. G4 agora lê a existência de documentos DIRECTAMENTE
// (context.hasVaultDocuments, calculado pelo chamador sobre
// documents/pastas — a mesma leitura que company-knowledge-db.ts já faz),
// nunca via um claim intermédio.
//
// Precisão preservada, DELIBERADAMENTE não alargada (revisão adversarial do
// Prompt 311 apanhou uma primeira versão que suprimia G4 nas QUATRO
// categorias assim que existisse UM documento QUALQUER no Vault — a pedido
// diz "aqui é a mecânica de COMO ele verifica, não substitui essa restrição
// de âmbito", e alargar a supressão a categorias sem nenhum sinal de
// relação real (um pitch deck não prova nada sobre equipa/tracao_gtm/
// validacao_externa) trocava "68 claims de ruído" por "gaps reais escondidos
// sem aviso" — pior, não melhor). hasVaultDocuments continua a cobrir
// apenas prova_tecnica, exactamente como a implementação antiga cobria na
// prática (documentToAtom categorizava TODO documento como prova_tecnica,
// sempre) — só a MECÂNICA muda (leitura directa, sem claim intermédio),
// nunca o alcance. equipa/tracao_gtm/validacao_externa continuam a perguntar
// sempre que há um claim aceite nessas categorias, tal como sempre
// perguntaram — não há sinal fiável (sem correlacionar pasta/nome de
// ficheiro, fora do âmbito pedido aqui) que ligue um documento genérico a
// UMA dessas três categorias especificamente.
//
// Prompt 310 §A — G4 costumava disparar para QUALQUER categoria, incluindo
// onde "há um documento que o comprove?" não tem resposta útil possível —
// o próprio exemplo do Nuno: "Claude, tens um documento que comprove que
// fazes AI?". Restrito às categorias onde um documento real e arquivável
// costuma mesmo existir:
//   - prova_tecnica: certificações, patentes, selos (ex. ANI em Portugal).
//   - validacao_externa: LOI, relatório de piloto, carta de intenção.
//   - tracao_gtm: contrato, factura.
//   - equipa: CV, portefólio, carta de referência — mantido por leitura:
//     ao contrário de mercado_timing/solucao/problema (posicionamento e
//     narrativa, nunca "provados" por papel) ou funding/ask (os TERMOS da
//     própria ronda, negociáveis — ver G8, que substitui "prova" por
//     "coerência" para estas duas), um claim de equipa tipicamente aponta
//     para algo real e pedível (o mesmo Vault CV que o Prompt 308 já
//     procura para o rascunho de G3/G3c).
// mercado_timing, solucao, problema, funding e ask ficam de fora — nunca
// mais geram G4.
const G4_DOCUMENTABLE_CATEGORIES = new Set<ClaimCategory>(['prova_tecnica', 'validacao_externa', 'tracao_gtm', 'equipa']);

// Prompt 313 §B — a SECOND, precise way to be "covered": c.documentRefs is a
// mechanical link from THIS claim to an actual Vault document + page
// (document-extraction-linking.ts, on top of document-extraction.ts actually
// reading document content — see company-claims.ts's findDocumentLinkCandidate).
// Added as an ADDITIONAL clause, not a replacement for hasVaultDocuments:
// only PDFs get extracted ("só PDF por agora"), so a prova_tecnica claim
// backed by a real but non-PDF Vault file (a .docx spec sheet, a .pptx
// architecture diagram) would regress — losing its only suppression path —
// if the coarse per-org hasVaultDocuments fallback were removed instead of
// kept alongside this. This is what actually fixes the motivating bug: the
// ablute_ "Carla Dias is a WomenTechEU awardee" claim is category `equipa`,
// which hasVaultDocuments never covered (by design, see the comment above) —
// only a per-claim link like this one can.
// Prompt 358 Phase 1 — a founder-recorded disposition ('no_document' or
// 'document_pending') is ALSO "covered", same as a real document link: the
// founder was asked, answered honestly that no document exists (or exists
// outside the Vault), and that answer must close the gap for good — never
// re-ask the same "is there a document?" question forever just because the
// honest answer wasn't itself a document.
function hasDocumentBacking(c: CompanyClaim): boolean {
  return (Array.isArray(c.documentRefs) && c.documentRefs.length > 0)
    || c.gapDisposition === 'no_document' || c.gapDisposition === 'document_pending';
}

// Prompt 358 Phase 2.4 — "presumption of truth": what the founder states is
// presumed true; only a VERIFIABLE FACT (title, award, contract, patent,
// metric) can have a documentary gap. A JUDGMENT (team complementarity,
// vision, mechanism) never can — there is no document that proves "we have
// complementary skills" the way a contract proves a partnership. This closes
// the exact hole Nuno's real session hit: G3's own chip options ("We have
// complementary skills", "We have unique domain access", "We have built
// this before") are judgments by construction — choosing one with no free
// text creates an `equipa` claim whose entire content IS the judgment
// phrase, which G4 then nonsensically asked to be documented. Deliberately
// narrow (exact phrases + a short list of equivalent narrative markers),
// same discipline as COMPLEMENTARITY above it: a false negative here just
// means G4 asks a question that gets a 'no_document'/'document_pending'
// disposition (Phase 1's fix already makes that a one-time cost, not a
// loop) — a false positive would silently hide a real documentary gap.
const TEAM_JUDGMENT = /\b(complementary skills?|unique domain access|built this before|great team|strong team|right team|work well together|trust each other)\b/i;
function isTeamJudgment(c: CompanyClaim): boolean {
  return c.category === 'equipa' && TEAM_JUDGMENT.test(c.statement);
}

export function ruleG4(claims: CompanyClaim[], context: GapContext): Gap[] {
  const documentable = claims.filter((c) => G4_DOCUMENTABLE_CATEGORIES.has(c.category) && !isTeamJudgment(c));
  return documentable
    .filter((c) => c.status === 'accepted'
      && !hasDocumentBacking(c)
      && !(c.category === 'prova_tecnica' && context.hasVaultDocuments))
    .map((c) => ({
      rule: 'G4' as const, severity: 'medium' as const,
      message: `Accepted but undocumented: "${c.statement}" has no Vault document backing it.`,
      relatedClaimIds: [c.id],
      // category carried through (same reason as G7 — see its own comment):
      // G4 now spans FOUR categories, not one, so /api/blueprint/answer's
      // static CATEGORY_BY_RULE fallback (which only knows one category per
      // rule) would mis-file every answer under whichever category happens
      // to be in that map, regardless of which of the four this claim was
      // actually in. Caught by Prompt 310's own adversarial review.
      meta: { statement: c.statement, category: c.category },
    }));
}

// G5 — staleness: updatedAt além de N meses (default 6) reabre a pergunta.
export function ruleG5(claims: CompanyClaim[], context: GapContext): Gap[] {
  const months = context.staleMonths ?? 6;
  const cutoff = new Date(context.now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return claims
    .filter((c) => c.updatedAt && new Date(c.updatedAt) < cutoff)
    .map((c) => ({
      rule: 'G5' as const, severity: 'medium' as const,
      message: `Possibly stale (older than ${months} months): "${c.statement}" — still true?`,
      relatedClaimIds: [c.id],
      meta: { statement: c.statement, updatedAt: c.updatedAt as string },
    }));
}

// G6 — mecanismo da ronda: funding/ask sem uso-de-fundos OU sem
// porquê-agora. O porquê-agora também pode viver em mercado_timing — a
// categoria certa para "a janela é agora".
const USE_OF_FUNDS = /\b(use of funds|uso de fundos|allocat\w*|hire|hiring|runway|deploy\w* (the )?capital|spend)\b/i;
const WHY_NOW = /\b(why now|porqu[eê] agora|window|timing|regulat\w*|momentum|inflection)\b/i;

export function ruleG6(claims: CompanyClaim[]): Gap[] {
  const fundingAsk = claims.filter((c): boolean => c.category === 'funding' || c.category === 'ask');
  const timingPool = claims.filter((c) => c.category === 'funding' || c.category === 'ask' || c.category === 'mercado_timing');
  const missing: string[] = [];
  if (!fundingAsk.some((c) => USE_OF_FUNDS.test(c.statement))) missing.push('use of funds');
  if (!timingPool.some((c) => WHY_NOW.test(c.statement))) missing.push('why now');
  if (missing.length === 0) return [];
  return [{
    rule: 'G6', severity: 'high',
    message: `Round mechanism gap: nothing covers ${missing.join(' nor ')} — the ask reads as a number without a story.`,
    relatedClaimIds: fundingAsk.map((c) => c.id),
    meta: { missing: missing.join(', ') },
  }];
}

// G7 (Prompt 299 §2) — claim central mencionado uma única vez: forte e de
// alta especificidade, mas sem nada mais no corpus a corroborar ou
// desenvolver. As outras seis regras (G1-G6, G3b à parte) olham para
// ausência, fraqueza ou idade; nenhuma olha para ISOLAMENTO — um claim pode
// passar em todas elas e ainda ser a única frase que sustenta uma alegação
// central ao pitch.
//
// (a) evidenceClass 1-3 (as três classes fortes) OU categoria
//     problema/solucao (o núcleo do pitch) — nunca claims de classe 4/5,
//     que já são mecanismo/decoração e não pretendem ser "a" alegação central.
// (b) specificity 'high' — um claim vago não tem nada de "central e
//     verificável" para se preocupar em não estar corroborado.
// (c) "nada mais o desenvolve" — critério mecânico em DOIS níveis, coerente
//     com a mesma grosseria que o G4 já aceita para "documentado":
//       nível 1 (grosseiro, sempre fiável): existe outro claim ACEITE na
//         MESMA categoria? Presença por categoria, não claim-a-claim — a
//         mesma unidade de análise do G4's vaultByCategory.
//       nível 2 (mais fino, e por isso mais falível): se o próprio claim
//         nomeia uma entidade (NAMED_ENTITY), existe outro claim aceite
//         (de qualquer categoria) que menciona o MESMO nome? Um match de
//         substring não prova nem desmente desenvolvimento real — um claim
//         relacionado pode usar outra palavra para a mesma pessoa/empresa.
// Isolado = nem o nível 1 nem o nível 2 encontram nada. Quando o nível 2 é
// que decidiu (havia nome para verificar, e não apareceu em mais lado
// nenhum), a deteção fica marcada 'low' confidence e a severity desce de
// 'high' para 'medium' — ver o comentário do Gap.detectionConfidence.
//
// Prompt 311 §C — a extração de nome (antes um regex privado duplicado
// aqui) passou a viver em company-claims.ts (extractNamedEntity), reutilizada
// também pela deteção de duplicados — mesmo sinal, uma só definição.
const STRONG_OR_CORE = new Set<ClaimCategory>(['problema', 'solucao']);

export function ruleG7(claims: CompanyClaim[]): Gap[] {
  const accepted = claims.filter((c) => c.status === 'accepted');
  const candidates = accepted.filter((c) =>
    (c.evidenceClass <= 3 || STRONG_OR_CORE.has(c.category)) && c.specificity === 'high');

  const gaps: Gap[] = [];
  for (const c of candidates) {
    // Prompt 358 Phase 1 — "Confirmed, it stays as-is" (G7's own third
    // option) is the founder explicitly saying "yes, I know it's isolated,
    // and I'm not developing it further" — re-flagging the SAME claim as
    // isolated forever after that answer is exactly the infinite-reask bug
    // this phase exists to kill.
    if (c.gapDisposition === 'confirmed') continue;
    const sameCategoryElsewhere = accepted.some((o) => o.id !== c.id && o.category === c.category);
    if (sameCategoryElsewhere) continue; // nível 1 já encontrou corroboração

    const name = extractNamedEntity(c.statement);
    const nameElsewhere = name
      ? accepted.some((o) => o.id !== c.id && o.statement.toLowerCase().includes(name.toLowerCase()))
      : false;
    if (nameElsewhere) continue; // nível 2 encontrou o mesmo nome noutro claim

    // Isolado. Confiança 'low' especificamente quando foi o nível 2 (o
    // matching de nome, o passo mais falível) que decidiu — havia um nome
    // para verificar e ele não reapareceu; sem nome nenhum para checar, o
    // nível 1 (categoria, sempre fiável) já chega sozinho.
    const confidence: 'high' | 'low' = name ? 'low' : 'high';
    gaps.push({
      rule: 'G7', severity: confidence === 'low' ? 'medium' : 'high',
      message: `Isolated central claim: "${c.statement}" is strong and specific but nothing else corroborates or develops it.`,
      relatedClaimIds: [c.id],
      // category carried through so an answer to THIS gap lands back in the
      // same category as the claim it's about — G7 spans several categories
      // (unlike every other rule, which maps to exactly one), so the static
      // CATEGORY_BY_RULE fallback in /api/blueprint/answer isn't right here.
      meta: { statement: c.statement, category: c.category },
      detectionConfidence: confidence,
    });
  }
  return gaps;
}

// G8 (Prompt 310 §B) — incongruência no VALOR da ronda, não "falta de prova".
// funding/ask são os TERMOS da própria ronda — negociáveis, não factos
// externos que um documento arquivado comprove (é por isto que G4 deixou de
// olhar para estas duas categorias). O que importa aqui é que o número seja
// o MESMO em todo o lado: o pitch deck, o resumo em Settings, um term sheet
// no Vault. Puramente mecânico sobre o texto já classificado — números +
// unidade já "extraídos" na frase — NUNCA uma chamada AI nova (a disciplina
// do cabeçalho deste ficheiro: regras puras, sem "vibes" de modelo). Uma
// frase cujo valor não se consegue extrair com confiança fica simplesmente
// de fora da comparação — nunca tratada como se discordasse de algo.
//
// Verificado antes de escrever isto (pedido explícito do prompt): o
// cross_document_review (src/app/api/ai-review/route.ts) é inteiramente
// uma chamada AI sobre dois documentos colados — a "comparação" É a própria
// chamada ao modelo, não há nenhuma função pura reaproveitável dali para
// este caso mecânico.
//
// Uma "ronda anterior" (funding_rounds → "Seed de €500k fechada em 2023")
// descreve OUTRA coisa (dinheiro já angariado antes) e não o ask actual —
// comparar os dois seria uma incongruência falsa, por isso fica
// deliberadamente fora desta comparação.
// Prompt 310 §B adversarial review — hardened after real false-positive
// paths were found (kept here, not just in a commit message, since the next
// reader needs to know WHY each guard exists before "simplifying" it away):
//   - a funding_rounds row is ALWAYS a past/closed round by construction
//     (fundingRoundToAtom's own header: "Uma ronda fechada é dinheiro que já
//     entrou"), whether or not it happens to say the word "closed" — so
//     sourceKind is the reliable signal, the text marker is only a second,
//     weaker net for a founder-typed fact describing a past round in prose.
//   - orgProfileToAtoms emits a SEPARATE "Use of funds: ..." claim
//     (category funding) from the SAME standard Settings fields as the ask
//     itself — comparing its allocation narrative against the round's own
//     size/valuation/instrument is a false incongruence by construction,
//     not a founder-input edge case.
//   - a sentence with more than one target/valuation marker (e.g. "we
//     considered targeting €1M... but are actually raising €300k") is
//     genuinely ambiguous about which amount the marker closest-match
//     heuristic should trust — skipped entirely rather than guessed,
//     same "ask rather than invent" bias as everywhere else in this file.
//   - a negated instrument mention ("not raising via debt") must never
//     count as naming that instrument.
//   - amounts in different currencies are never compared against each
//     other — neither as agreeing nor disagreeing.
const PAST_ROUND_MARKER = /\bclosed\b|\bprevious round\b/i;
const USE_OF_FUNDS_PREFIX = /^use of funds\b/i; // the exact orgProfileToAtoms prefix (company-knowledge.ts) — allocation narrative, never the round's own terms.
const TARGET_MARKER = /\b(raising|rais(?:e|ed)|target(?:ing)?|seek(?:ing)?|ask(?:ing)?)\b/i;
const VALUATION_MARKER = /\bvaluation\b|\bvalued at\b/i;
const AMOUNT = /(€|\$|£)\s?([\d][\d.,]*)\s?(k|m|thousand|million)?\b/i;
const NEGATION_BEFORE = /\b(not|no|never|without|isn't|aren't|won't|wouldn't|excluding)\b[^.;]{0,20}$/i;
const INSTRUMENT_PATTERNS: Record<string, RegExp> = {
  equity: /\bequity\b/i,
  safe: /\bsafes?\b/i,
  convertible_note: /\bconvertible[\s_-]?notes?\b/i,
  grant: /\bgrants?\b/i,
  debt: /\bdebt\b|\bloans?\b/i,
};
const SOURCE_LABEL: Partial<Record<CompanyClaim['sourceKind'], string>> = {
  profile: 'your company profile (Settings)', fact: 'a confirmed company fact',
  founder_answer: 'your own earlier answer', funding_round: 'a funding round record',
  vault_doc: 'a Vault document', roadmap: 'your roadmap',
};

// Montante + moeda a partir de UM match do AMOUNT (nunca da frase inteira —
// ver allAmounts). Trata "," como separador decimal só junto de um
// sufixo k/m ao estilo europeu ("0,3M"); trata "." como separador de
// milhares só sem sufixo e com exactamente 3 dígitos a seguir ("300.000")
// — o próprio eur() da app nunca gera essa forma (sempre sufixo k/M), por
// isso só texto escrito à mão cai aqui. Fora destes dois casos concretos,
// assume o formato mais comum (vírgula = separador de milhares).
function parseAmount(matchText: string): { value: number; currency: string } | null {
  const m = AMOUNT.exec(matchText);
  if (!m) return null;
  const currency = m[1];
  const digits = m[2];
  const unit = (m[3] ?? '').toLowerCase();
  let n: number;
  if (!unit && /^\d{1,3}(\.\d{3})+$/.test(digits)) {
    n = parseFloat(digits.replace(/\./g, ''));
  } else if (unit && /^\d+,\d{1,2}$/.test(digits)) {
    n = parseFloat(digits.replace(',', '.'));
  } else {
    n = parseFloat(digits.replace(/,/g, ''));
  }
  if (Number.isNaN(n)) return null;
  const value = unit === 'k' || unit === 'thousand' ? Math.round(n * 1_000)
    : unit === 'm' || unit === 'million' ? Math.round(n * 1_000_000)
    : Math.round(n);
  return { value, currency };
}

interface RoundMention { claim: CompanyClaim; matchedText: string; value: number; currency: string }

// currentRoundClaims — o filtro de "descreve o ASK actual" partilhado pelos
// três eixos (montante, valuation, instrumento): nunca uma ronda fechada
// (por sourceKind estrutural OU por texto), nunca uma frase de uso-de-fundos.
function currentRoundClaims(claims: CompanyClaim[]): CompanyClaim[] {
  return claims.filter((c) =>
    c.status === 'accepted' && (c.category === 'funding' || c.category === 'ask')
    && c.sourceKind !== 'funding_round' && !PAST_ROUND_MARKER.test(c.statement)
    && !USE_OF_FUNDS_PREFIX.test(c.statement.trim()));
}

// Uma única frase pode conter DOIS montantes distintos (a própria frase que
// orgProfileToAtoms gera: "Raising €300k ..., at a €4.5M valuation.") — por
// isso a extração tem de escolher o montante mais PRÓXIMO da palavra-chave
// (raising/target/... ou valuation), nunca só "o primeiro € da frase", ou
// "target amount" e "valuation" ficavam ambos a apontar para o mesmo número.
function allAmounts(text: string): { index: number; matchedText: string; value: number; currency: string }[] {
  const re = new RegExp(AMOUNT.source, 'gi');
  const out: { index: number; matchedText: string; value: number; currency: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const parsed = parseAmount(m[0]);
    if (parsed) out.push({ index: m.index, matchedText: m[0], ...parsed });
  }
  return out;
}

// Conta quantas vezes a palavra-chave aparece na frase — mais que uma vez é
// ambíguo (qual das duas o "montante mais próximo" devia mesmo seguir?) e
// fica de fora, em vez de a heurística de proximidade adivinhar mal.
function countMarkerMatches(text: string, marker: RegExp): number {
  return (text.match(new RegExp(marker.source, 'gi')) ?? []).length;
}

function collectAmountMentions(claims: CompanyClaim[], marker: RegExp): RoundMention[] {
  return claims.flatMap((c) => {
    if (countMarkerMatches(c.statement, marker) !== 1) return [];
    const markerMatch = marker.exec(c.statement);
    if (!markerMatch) return [];
    const amounts = allAmounts(c.statement);
    if (amounts.length === 0) return [];
    const closest = amounts.reduce((best, a) =>
      Math.abs(a.index - markerMatch.index) < Math.abs(best.index - markerMatch.index) ? a : best);
    return [{ claim: c, matchedText: closest.matchedText, value: closest.value, currency: closest.currency }];
  });
}

// Primeira menção de cada valor distinto, por ordem de aparição, DENTRO DA
// MESMA MOEDA — nunca compara €300k a $300k como se concordassem OU
// discordassem; moedas diferentes simplesmente não entram na mesma
// comparação (este produto só trabalha em EUR na prática, mas a frase pode
// ser escrita à mão). Se 2+ valores distintos sobrevivem, há incongruência
// a reportar (as duas primeiras, mesmo que existam mais que duas —
// mensagem legível em vez de enumerar combinatoriamente).
function firstTwoDistinct(mentions: RoundMention[]): [RoundMention, RoundMention] | null {
  const byCurrency = new Map<string, RoundMention[]>();
  for (const m of mentions) {
    const list = byCurrency.get(m.currency) ?? [];
    list.push(m);
    byCurrency.set(m.currency, list);
  }
  for (const list of byCurrency.values()) {
    const seen: RoundMention[] = [];
    for (const m of list) {
      if (!seen.some((s) => s.value === m.value)) seen.push(m);
      if (seen.length === 2) return [seen[0], seen[1]];
    }
  }
  return null;
}

function roundValueGap(field: string, pair: [RoundMention, RoundMention]): Gap {
  const [a, b] = pair;
  const labelA = SOURCE_LABEL[a.claim.sourceKind] ?? 'a claim on file';
  const labelB = SOURCE_LABEL[b.claim.sourceKind] ?? 'a claim on file';
  return {
    rule: 'G8', severity: 'high',
    message: `Round ${field} mismatch — ${labelA} says ${a.matchedText}, ${labelB} says ${b.matchedText}. Which is correct?`,
    relatedClaimIds: [a.claim.id, b.claim.id],
    meta: { field, sourceLabelA: labelA, valueA: a.matchedText, sourceLabelB: labelB, valueB: b.matchedText },
  };
}

export function ruleG8(claims: CompanyClaim[]): Gap[] {
  const current = currentRoundClaims(claims);
  const gaps: Gap[] = [];

  const targets = firstTwoDistinct(collectAmountMentions(current, TARGET_MARKER));
  if (targets) gaps.push(roundValueGap('target amount', targets));

  const valuations = firstTwoDistinct(collectAmountMentions(current, VALUATION_MARKER));
  if (valuations) gaps.push(roundValueGap('valuation', valuations));

  // Instrumento — conjunto de instrumentos mencionados por claim (uma frase
  // pode listar vários, ex. "via equity/convertible_note/grant/safe" — o
  // MENU possível, não uma escolha). Uma menção negada ("not raising via
  // debt") nunca conta como nomear esse instrumento. Só é incongruência
  // real um par cujos conjuntos são completamente disjuntos: um claim que
  // só fala em SAFE e outro que só fala em equity discordam de facto; um
  // que lista o menu inteiro e outro que só refere SAFE não discordam
  // (SAFE está no menu).
  const instrumentMentions = current
    .filter((c) => TARGET_MARKER.test(c.statement))
    .map((c) => {
      const instruments = Object.entries(INSTRUMENT_PATTERNS)
        .filter(([, re]) => {
          const m = new RegExp(re.source, 'i').exec(c.statement);
          return m && !NEGATION_BEFORE.test(c.statement.slice(0, m.index));
        })
        .map(([key]) => key);
      return { claim: c, instruments };
    })
    .filter((m) => m.instruments.length > 0);
  outer: for (let i = 0; i < instrumentMentions.length; i++) {
    for (let j = i + 1; j < instrumentMentions.length; j++) {
      const a = instrumentMentions[i]; const b = instrumentMentions[j];
      const disjoint = a.instruments.every((x) => !b.instruments.includes(x));
      if (disjoint) {
        const labelA = SOURCE_LABEL[a.claim.sourceKind] ?? 'a claim on file';
        const labelB = SOURCE_LABEL[b.claim.sourceKind] ?? 'a claim on file';
        gaps.push({
          rule: 'G8', severity: 'high',
          message: `Round instrument mismatch — ${labelA} says ${a.instruments.join('/')}, ${labelB} says ${b.instruments.join('/')}. Which is correct?`,
          relatedClaimIds: [a.claim.id, b.claim.id],
          meta: { field: 'instrument', sourceLabelA: labelA, valueA: a.instruments.join('/'), sourceLabelB: labelB, valueB: b.instruments.join('/') },
        });
        break outer;
      }
    }
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// detectGaps — corre as nove e agrega.
//
// REGRA GERAL ACIMA DAS NOVE (219-B §1): perguntar é o comportamento por
// omissão sempre que a digestão encontra ausência, ambiguidade ou assimetria
// numa área importante. Estas nove regras são o MÍNIMO GARANTIDO, não o
// teto — quem acrescentar fontes novas de claims deve perguntar-se "que
// ausência nova é que isto torna detetável?" e acrescentar a regra, em vez
// de assumir que a lista está completa.
export function detectGaps(claims: CompanyClaim[], context: GapContext): Gap[] {
  return [
    ...ruleG1(claims),
    ...ruleG2(claims),
    ...ruleG3(claims),
    ...ruleG3b(claims, context),
    ...ruleG3c(claims, context),
    ...ruleG4(claims, context),
    ...ruleG5(claims, context),
    ...ruleG6(claims),
    ...ruleG7(claims),
    ...ruleG8(claims),
  ];
}

// ---------------------------------------------------------------------------
// Prompt 223 §3 — a identidade de uma lacuna, estável entre execuções. É o
// que liga a resposta do founder à pergunta que a provocou, e o que faz
// "não voltes a perguntar isto" funcionar sem tabela de perguntas.
//
// A regra sozinha não chega: G3b dá uma lacuna POR FOUNDER e G3c uma POR
// FUNÇÃO, portanto a chave leva o discriminante quando existe. Para as
// regras ligadas a um claim concreto (G2, G4, G5) o discriminante é o id
// do claim — se o claim mudar, é outra lacuna e volta a perguntar-se, que
// é o comportamento certo.
//
// Prompt 310 §B, apanhado por revisão adversarial: G8 pode devolver ATÉ TRÊS
// lacunas (montante/valuation/instrumento) para o MESMO par de claims — sem
// meta?.field aqui, todas colapsavam na mesma chave (relatedClaimIds[0] é
// igual nas três), o que fazia responder/saltar UMA apagar as outras duas
// da fila como se também tivessem sido tratadas. field entra no discriminante
// pela mesma razão que founderName/functionKey já lá estavam.
export function gapKey(gap: Gap): string {
  const discriminator = gap.meta?.founderName ?? gap.meta?.functionKey ?? gap.meta?.field ?? gap.relatedClaimIds[0] ?? '';
  return `${gap.rule}:${discriminator}`;
}

// ---------------------------------------------------------------------------
// Templates de pergunta (219 §1.4 + 219-B §1) — DADOS, não strings soltas:
// um array de config com placeholders {chave} preenchidos a partir de
// gap.meta. O bloco 3 liga isto ao fluxo interativo real; aqui só a
// substituição pura.
export interface QuestionTemplate {
  rule: GapRule;
  question: string;
  options: string[];
  freeTextLabel: string;
}

export const QUESTION_TEMPLATES: QuestionTemplate[] = [
  {
    rule: 'G1',
    question: 'Has anyone actually PAID (or signed to pay) — a customer, a paid pilot, a purchase order?',
    options: ['Yes — paying customer', 'Yes — paid pilot / PO', 'Not yet'],
    freeTextLabel: 'Who, how much, and when?',
  },
  {
    // O exemplo do 219: a visita vaga. Nome + data + desfecho é o que
    // transforma classe 2 baixa em classe 2 alta.
    rule: 'G2',
    question: 'You said: “{statement}”. Who exactly was it, when, and what came of it?',
    options: ['Negotiation ongoing', 'LOI / pilot signed', 'No follow-up yet'],
    freeTextLabel: 'Name + date + outcome',
  },
  {
    rule: 'G3',
    question: 'Who is the core team, and why does THIS team win together?',
    options: ['We have complementary skills', 'We have unique domain access', 'We have built this before'],
    freeTextLabel: 'Names, roles, and what makes the combination hard to copy',
  },
  {
    // 219-B, por nome: o resto da equipa além de quem já tem narrativa.
    rule: 'G3b',
    question: 'Is there more to the core team beyond {coveredNames}? What is {founderName}’s role — and what makes them irreplaceable?',
    options: ['Full-time', 'Part-time', 'Advisor'],
    freeTextLabel: 'Role · why irreplaceable · dedication',
  },
  {
    // 219-B: "ainda ninguém" é resposta VÁLIDA — vira lacuna a reportar no
    // bloco 3, nunca a esconder.
    rule: 'G3c',
    question: 'Who leads the {functionLabel} side?',
    options: ['A founder (name below)', 'A hire (name below)', 'No one yet'],
    freeTextLabel: 'Name and role',
  },
  {
    rule: 'G4',
    question: 'Is there a document in your Vault backing “{statement}”?',
    options: ['Yes — I will attach it', 'It exists but is not in the Vault yet', 'No document yet'],
    freeTextLabel: 'Which document?',
  },
  {
    rule: 'G5',
    question: 'Is this still true? “{statement}” (last updated {updatedAt})',
    options: ['Still true', 'Changed — needs updating', 'No longer applies'],
    freeTextLabel: 'What changed?',
  },
  {
    rule: 'G6',
    question: 'What will this round’s money be used for — and why is NOW the moment?',
    options: ['Hiring', 'Product / certification', 'Go-to-market'],
    freeTextLabel: 'Use of funds + why now',
  },
  {
    rule: 'G7',
    question: 'You said: "{statement}". This is central to your pitch but doesn\'t appear anywhere else — want to clarify/develop it, or confirm it stays as-is?',
    // Prompt 358 Phase 1 — these three were left in Portuguese since the
    // rule shipped (Prompt 299 §2); every other template in this file is
    // English, and this is a global-platform, English-language product.
    options: ['I\'ll develop this further', 'Confirmed, it stays as-is', 'Actually, it\'s not that central'],
    freeTextLabel: 'Add detail, or say why it stands fine alone',
  },
  {
    // Prompt 310 §B — só o founder sabe qual dos dois números está certo;
    // AI nunca deveria adivinhar isto, por isso G8 é sempre 'polish' em
    // gap-assist/route.ts (nunca 'draft').
    rule: 'G8',
    question: 'Your round {field} doesn\'t match everywhere: {sourceLabelA} says {valueA}, {sourceLabelB} says {valueB}. Which is correct?',
    options: [],
    freeTextLabel: 'The correct value, and where the wrong one lives so you can fix it there too',
  },
];

export function templateFor(gap: Gap): { question: string; options: string[]; freeTextLabel: string } {
  const t = QUESTION_TEMPLATES.find((x) => x.rule === gap.rule);
  if (!t) {
    // Nunca deve acontecer (uma template por regra, acima) — mas a regra
    // "nunca lança" aplica-se também aqui: pergunta genérica, não crash.
    return { question: gap.message, options: [], freeTextLabel: 'Tell us more' };
  }
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, key: string) => gap.meta?.[key] ?? `{${key}}`);
  return { question: fill(t.question), options: t.options, freeTextLabel: t.freeTextLabel };
}

// ---------------------------------------------------------------------------
// Prompt 358 Phase 1 — "responses are not claims by default." Confirmed
// live: choosing a plain non-informative chip like "Not yet" or "No
// document yet" (no free text added) used to be inserted VERBATIM as a
// brand-new company_claims row — for a documentable category, immediately
// re-tripping G4 ("accepted but undocumented") on the very claim the
// answer just created, which is why the "N left" counter climbed WHILE the
// founder was answering it.
//
// routeAnswer is the single place that decides what a (rule, chip) answer
// with no free text actually means — inserting a new claim is the
// EXCEPTION now (kept for chips that are themselves the substance, e.g.
// G1's "Yes — paying customer" or G3's narrative options), not the default.
// Free text always means real information was added, so it always routes
// to 'claim' regardless of which chip was also picked — matches the
// existing statement-building behavior (chip + free text joined with
// " — "), just no longer bypassed for a chip-alone non-answer.
export type AnswerRouting =
  | { kind: 'claim' }
  // No new fact, no claim — recorded as answered (like an explicit dismiss)
  // so the interrogation queue can move on, but nothing is invented.
  | { kind: 'dismiss' }
  // G5 "Still true" — the founder re-affirmed the EXISTING claim; refresh
  // its updatedAt so G5's own staleness clock restarts, never a new row.
  | { kind: 'refresh_claim' }
  // G4 "Yes — I will attach it" — an intent, not a fact yet. The real
  // answer is the document itself: the UI opens a Vault picker and links
  // it via document_refs (link_claim_document_ref, migration 0208),
  // never a text claim reading "Yes — I will attach it".
  | { kind: 'attach_document' }
  // Records the founder's decision directly on the EXISTING claim
  // (migration 0234) instead of ever creating a second row to hold it.
  | { kind: 'set_disposition'; disposition: NonNullable<CompanyClaim['gapDisposition']> };

const OPTION_ROUTING: Partial<Record<GapRule, Record<string, AnswerRouting>>> = {
  G1: { 'Not yet': { kind: 'dismiss' } },
  G2: { 'No follow-up yet': { kind: 'dismiss' } },
  G3c: { 'No one yet': { kind: 'dismiss' } },
  G4: {
    'Yes — I will attach it': { kind: 'attach_document' },
    'It exists but is not in the Vault yet': { kind: 'set_disposition', disposition: 'document_pending' },
    'No document yet': { kind: 'set_disposition', disposition: 'no_document' },
  },
  G5: {
    'Still true': { kind: 'refresh_claim' },
    'No longer applies': { kind: 'dismiss' },
  },
  G7: {
    'I\'ll develop this further': { kind: 'dismiss' },
    'Confirmed, it stays as-is': { kind: 'set_disposition', disposition: 'confirmed' },
    'Actually, it\'s not that central': { kind: 'dismiss' },
  },
};

export function routeAnswer(rule: GapRule, option: string | undefined, hasFreeText: boolean): AnswerRouting {
  if (hasFreeText || !option) return { kind: 'claim' };
  return OPTION_ROUTING[rule]?.[option] ?? { kind: 'claim' };
}

// ---------------------------------------------------------------------------
// Prompt 358 Phase 3.2 — "a question BUDGET: perguntar é caro." Before this,
// the founder-facing queue was every open gap, in whatever order detectGaps
// happened to produce them, with no notion of "worth asking first." Ranking
// is pure and deterministic — by severity, then a fixed rule order for ties
// — so the same claims always produce the same top-N, and the founder never
// sees an item reshuffle to a different position between two loads of the
// same data.
const SEVERITY_RANK: Record<GapSeverity, number> = { critical: 0, high: 1, medium: 2 };
const RULE_ORDER: GapRule[] = ['G1', 'G6', 'G3', 'G3b', 'G3c', 'G7', 'G2', 'G8', 'G4', 'G5'];

export function rankGaps(gaps: Gap[]): Gap[] {
  return [...gaps].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule);
  });
}

// The 5-item cap Phase 3.2 asks for, as one shared constant — the
// interrogation queue and the Knowledge Health panel's "would strengthen"
// block both read this, never two independently-chosen numbers.
export const GAP_QUESTION_BUDGET = 5;

// Prompt 358 Phase 3.1 — a short, investor-neutral reason WHY answering this
// specific rule's gap would strengthen the dossier, for the Knowledge Health
// panel (never shown to investors themselves — founder-only, like every
// other gap-engine surface). Deliberately distinct from Gap.message (which
// describes what's missing); this describes what closing it buys.
// Prompt 367 — each entry must say something the RULE'S OWN message (above,
// in Gap.message/QUESTION_TEMPLATES) hasn't already said, in different
// words — not restate it. The point of `why` is the investor-side stake
// (what changes for them, what they'll actually do with this), never a
// synonym pass over "what's missing." Two of these (G6, G2) were caught in
// production paraphrasing their own message almost verbatim; all eight were
// re-read against their message here, not just the two named.
const IMPACT_WHY: Record<GapRule, string> = {
  G1: 'This is usually the very first thing a serious investor checks before reading anything else you claim.',
  G2: 'Investors run real diligence on exactly this kind of claim — one they can\'t check gets quietly discounted, not asked about.',
  G3: 'Investors back teams as much as ideas — a clear "why this team wins" answers the question they\'re silently asking anyway.',
  G3b: 'A team member with zero visible role invites the question "are they even involved?" — worth pre-empting before it\'s asked.',
  G3c: 'A named owner is what lets an investor picture the function actually getting done, not just planned for.',
  G4: 'Backing this with a document raises it to a class investors treat as externally verified, not just asserted.',
  G5: 'A stale claim risks being wrong by the time an investor checks it — confirming it keeps your dossier trustworthy.',
  G6: 'A credible plan for the money is what makes investors trust the ASK itself, not just the number attached to it.',
  G7: 'A claim central to your pitch that nothing else touches is exactly where a sharp investor will push hardest.',
  G8: 'Numbers that disagree across your own materials undermine trust in everything else you say.',
};

export function impactWhy(rule: GapRule): string {
  return IMPACT_WHY[rule] ?? 'Closing this makes your dossier more complete.';
}
