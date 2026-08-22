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
import { isWastedStrongClaim, measureSpecificity } from './company-claims';

export type GapRule = 'G1' | 'G2' | 'G3' | 'G3b' | 'G3c' | 'G4' | 'G5' | 'G6' | 'G7';
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

// G4 — claim aceite sem documento no Vault a suportá-lo: nem o próprio é
// vault_doc, nem existe outro claim vault_doc na mesma categoria (a noção
// mecânica de "relacionado" desta fase — deliberadamente grosseira; ligação
// claim-a-claim fina é trabalho do bloco 4, sobre ids).
export function ruleG4(claims: CompanyClaim[]): Gap[] {
  const vaultByCategory = new Set(claims.filter((c) => c.sourceKind === 'vault_doc').map((c) => c.category));
  return claims
    .filter((c) => c.status === 'accepted' && c.sourceKind !== 'vault_doc' && !vaultByCategory.has(c.category))
    .map((c) => ({
      rule: 'G4' as const, severity: 'medium' as const,
      message: `Accepted but undocumented: "${c.statement}" has no Vault document backing it.`,
      relatedClaimIds: [c.id],
      meta: { statement: c.statement },
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
const NAMED_ENTITY_G7 = /(?!^)\b[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]+)*/;
const STRONG_OR_CORE = new Set<ClaimCategory>(['problema', 'solucao']);

export function ruleG7(claims: CompanyClaim[]): Gap[] {
  const accepted = claims.filter((c) => c.status === 'accepted');
  const candidates = accepted.filter((c) =>
    (c.evidenceClass <= 3 || STRONG_OR_CORE.has(c.category)) && c.specificity === 'high');

  const gaps: Gap[] = [];
  for (const c of candidates) {
    const sameCategoryElsewhere = accepted.some((o) => o.id !== c.id && o.category === c.category);
    if (sameCategoryElsewhere) continue; // nível 1 já encontrou corroboração

    const nameMatch = c.statement.match(NAMED_ENTITY_G7);
    const name = nameMatch?.[0];
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

// ---------------------------------------------------------------------------
// detectGaps — corre as oito e agrega.
//
// REGRA GERAL ACIMA DAS OITO (219-B §1): perguntar é o comportamento por
// omissão sempre que a digestão encontra ausência, ambiguidade ou assimetria
// numa área importante. Estas oito regras são o MÍNIMO GARANTIDO, não o
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
    ...ruleG4(claims),
    ...ruleG5(claims, context),
    ...ruleG6(claims),
    ...ruleG7(claims),
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
export function gapKey(gap: Gap): string {
  const discriminator = gap.meta?.founderName ?? gap.meta?.functionKey ?? gap.relatedClaimIds[0] ?? '';
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
    options: ['Vou desenvolver isto', 'Confirmo que fica só assim', 'Na verdade não é assim tão central'],
    freeTextLabel: 'Add detail, or say why it stands fine alone',
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
