// Prompt 219 bloco 3 §1 (Prompt 223) — a ingestão: tudo o que a app já sabe
// sobre a empresa, virado em RawAtom[] (o input do normalizeAtom do bloco 1).
//
// Zero schema novo: é leitura das tabelas que já existem. A parte PURA (uma
// linha → RawAtom) vive aqui e é testada; a query que vai buscar as linhas
// é o adaptador em company-knowledge-db.ts, sem teste unitário próprio.
//
// REGRA RAIZ (CLAUDE.md, "Startup-performance privacy") — verificada fonte a
// fonte ao escrever isto: NADA de performance de plataforma entra aqui.
// Não se lê `interactions`, nem passes, nem contagens de outreach, nem
// pipeline, nem `round_secured_eur`. O modelo de claims nem sequer tem
// categoria para isso, mas a garantia real é esta lista de fontes: factos
// declarados pelo founder, perfil que ele escreveu, rondas que ele
// registou, roadmap que ele desenhou, equipa que ele inseriu e
// esclarecimentos que ele próprio redigiu.
// `round_target_eur` entra porque o pedido É o pitch; `round_secured_eur`
// NÃO entra, porque é progresso contra o pedido e vive atrás do toggle do
// 212 §A — e um claim não tem forma de transportar esse toggle.
//
// Prompt 311 §A — NOMES de documentos do Vault deixaram de entrar aqui.
// Existiam só para o G4 poder perguntar "há documento a suportar isto?" via
// um claim `vault_doc` por ficheiro — mas isso pôs um claim na fila de
// revisão POR CADA documento existente (66 dos 68 itens da fila da ablute_
// eram exactamente isto: "Document on file: {nome}.pdf", sem nada que o
// founder não soubesse já). G4 agora lê a existência de documentos
// DIRECTAMENTE (company-knowledge-db.ts's hasAnyVaultDocument), nunca via
// um átomo/claim intermédio — ver ruleG4 em company-gaps.ts.
import type { RawAtom } from './company-claims';
import type { ClaimCategory, CompanyFactCategory, RoadmapItemV2 } from './types';
import { readItems, itemCategoryLabel, GENERAL_LABEL, type CategoryLike } from './roadmap-categories';

// ---------------------------------------------------------------------------
// company_facts → claim.
//
// A categoria do facto é o RÓTULO DO FOUNDER, não uma medição — por isso o
// mapeamento é fiel e deixa o classifyEvidence (mecânico) corrigir a CLASSE
// quando o rótulo exagera. Exemplo real da ablute_: a visita do "world's
// manufacturing leader" está gravada como `traction`; mapeia para
// tracao_gtm, e o classificador do bloco 1 baixa-a a classe 2 sozinho por
// não haver dinheiro na frase. O rótulo fica como o founder o escreveu; a
// força não.
//
// Onde o mapeamento é ambíguo, aponta-se para a categoria MAIS FRACA
// possível — 'regulatory' vai para prova_tecnica (classe 4) e não para
// validacao_externa (classe 2), porque "temos de obter marcação CE" e "um
// regulador aprovou-nos" escrevem-se parecido e só o segundo é validação.
// Sobrestimar é o erro caro (um pitch a abrir com uma classe 2 que não
// existe); subestimar só faz a app perguntar, que é o comportamento certo.
const FACT_CATEGORY_TO_CLAIM: Record<CompanyFactCategory, ClaimCategory> = {
  product: 'solucao',
  traction: 'tracao_gtm',
  team: 'equipa',
  positioning: 'mercado_timing',
  financing: 'funding',
  regulatory: 'prova_tecnica',
  market: 'mercado_timing',
  metrics: 'tracao_gtm',
  // 'other' é o caixote: todas as categorias de classe 4 servem igual, e
  // 'solucao' é a aterragem neutra. Fica sinalizado para o founder
  // re-categorizar na lista de aceitação (§4).
  other: 'solucao',
};

export interface FactRow {
  id: string;
  category: CompanyFactCategory;
  statement: string;
  status: string;
  confirmed_at?: string | null;
  updated_at?: string | null;
}

// Só factos CONFIRMADOS. Um facto por confirmar ainda não é conhecimento —
// é uma proposta, e propor sobre proposta duplicaria o passo de aceitação.
export function factToAtom(fact: FactRow): RawAtom | null {
  if (fact.status !== 'confirmed') return null;
  if (!fact.statement?.trim()) return null;
  return {
    category: FACT_CATEGORY_TO_CLAIM[fact.category] ?? 'solucao',
    statement: fact.statement.trim(),
    sourceKind: 'fact',
    sourceRef: fact.id,
    at: fact.confirmed_at ?? fact.updated_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Perfil da org → claims. Cada campo vira uma FRASE, não um par chave/valor:
// o motor mede especificidade sobre linguagem natural, e "stage: seed" não
// tem sinais nenhuns para medir.
export interface OrgProfileRow {
  one_liner?: string | null;
  description?: string | null;
  sectors?: string[] | null;
  sectors_other?: string | null;
  stage?: string | null;
  country?: string | null;
  founded_year?: number | null;
  revenue_eur?: number | null;
  round_target_eur?: number | null;
  round_use_of_funds?: string | null;
  round_instruments?: string[] | null;
  round_valuation_eur?: number | null;
  updated_at?: string | null;
}

function eur(n: number): string {
  return n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `€${Math.round(n / 1000)}k`;
}

export function orgProfileToAtoms(org: OrgProfileRow): RawAtom[] {
  const atoms: RawAtom[] = [];
  const at = org.updated_at ?? undefined;
  const push = (category: ClaimCategory, statement: string) =>
    atoms.push({ category, statement, sourceKind: 'profile', at });

  if (org.one_liner?.trim()) push('solucao', org.one_liner.trim());
  if (org.description?.trim()) push('solucao', org.description.trim());

  const sectors = [...(org.sectors ?? []), org.sectors_other?.trim()].filter(Boolean) as string[];
  if (sectors.length > 0 && org.country?.trim()) {
    push('mercado_timing', `Operating in ${sectors.join(', ')} from ${org.country.trim()}.`);
  }
  if (org.founded_year != null) {
    push('mercado_timing', `Founded in ${org.founded_year}${org.stage ? `, currently at ${org.stage} stage` : ''}.`);
  }
  if (org.revenue_eur != null && org.revenue_eur > 0) {
    push('tracao_gtm', `Revenue to date: ${eur(org.revenue_eur)}.`);
  }

  // O ASK entra; o PROGRESSO contra o ask não (regra raiz + toggle do 212).
  if (org.round_target_eur != null) {
    const instruments = (org.round_instruments ?? []).filter(Boolean);
    const valuation = org.round_valuation_eur != null ? `, at a ${eur(org.round_valuation_eur)} valuation` : '';
    push('ask', `Raising ${eur(org.round_target_eur)}${instruments.length ? ` via ${instruments.join('/')}` : ''}${valuation}.`);
  }
  if (org.round_use_of_funds?.trim()) {
    push('funding', `Use of funds: ${org.round_use_of_funds.trim()}`);
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// funding_rounds → claims. Uma ronda fechada é dinheiro que já entrou —
// classe alta merecida, e por isso a frase leva montante e ano, que são os
// sinais que o measureSpecificity mede.
export interface FundingRoundRow {
  id: string; label?: string | null; amount_eur?: number | null; closed_year?: number | null; note?: string | null;
  // Prompt 327 Pedido B — who invested; folded into the atom text the same
  // way `note` already is, so the claims/blueprint pipeline picks it up
  // with no separate wiring.
  investor_name?: string | null;
}

export function fundingRoundToAtom(row: FundingRoundRow): RawAtom | null {
  if (row.amount_eur == null && !row.label?.trim()) return null;
  const parts = [
    row.label?.trim() || 'Previous round',
    row.amount_eur != null ? `of ${eur(row.amount_eur)}` : null,
    row.closed_year != null ? `closed in ${row.closed_year}` : null,
    row.investor_name?.trim() ? `from ${row.investor_name.trim()}` : null,
  ].filter(Boolean);
  return {
    category: 'funding',
    statement: `${parts.join(' ')}.${row.note?.trim() ? ` ${row.note.trim()}` : ''}`,
    sourceKind: 'funding_round',
    sourceRef: row.id,
  };
}

// ---------------------------------------------------------------------------
// Roadmap → claims, um por ITEM (não por marco): cada item é uma afirmação
// própria e é assim que a categoria do 213 §D o acompanha. Lê por readItems
// (items_v2 preferido, legado como General) — a mesma função do 213, nunca
// uma segunda leitura.
export interface RoadmapMilestoneRow {
  id: string;
  period_kind: string;
  period_year: number;
  period_quarter?: number | null;
  items: string[];
  items_v2?: RoadmapItemV2[] | null;
}

function periodLabel(m: RoadmapMilestoneRow): string {
  return m.period_kind === 'quarter' && m.period_quarter ? `Q${m.period_quarter} ${m.period_year}` : `${m.period_year}`;
}

export function roadmapToAtoms(milestones: RoadmapMilestoneRow[], categories: (CategoryLike & { label: string })[] = []): RawAtom[] {
  const atoms: RawAtom[] = [];
  for (const m of milestones) {
    for (const item of readItems(m)) {
      if (!item.text?.trim()) continue;
      // A categoria do founder entra na FRASE (não no mapeamento): é
      // contexto que o investidor leria, e serve de sinal ao classificador.
      // "General" fica de fora — itemCategoryLabel devolve-a como aterragem
      // do lookup-miss, e escrevê-la em cada item sem categoria só poria
      // "(General)" em todo o lado sem dizer nada.
      const label = itemCategoryLabel(item, categories);
      const suffix = label && label !== GENERAL_LABEL ? ` (${label})` : '';
      atoms.push({
        category: 'solucao',
        statement: `${periodLabel(m)} — ${item.text.trim()}${suffix}`,
        sourceKind: 'roadmap',
        sourceRef: m.id,
      });
    }
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// Equipa → claims. Um por pessoa, com nome e cargo: são exactamente os
// sinais que o G3/G3b/G3c procuram ("quem", "que função"), e é por isso que
// a bio entra na mesma frase em vez de num claim separado.
export interface CompanyPersonRow {
  id: string; full_name: string; title?: string | null; is_founder?: boolean; bio?: string | null;
}

export function personToAtom(p: CompanyPersonRow): RawAtom | null {
  if (!p.full_name?.trim()) return null;
  const role = p.title?.trim() ? `, ${p.title.trim()}` : '';
  const founder = p.is_founder ? ' (founder)' : '';
  const bio = p.bio?.trim() ? ` ${p.bio.trim()}` : '';
  return {
    category: 'equipa',
    statement: `${p.full_name.trim()}${role}${founder}.${bio}`,
    sourceKind: 'profile',
    sourceRef: p.id,
  };
}

// ---------------------------------------------------------------------------
// review_clarifications → claims. O founder escreveu-as para esclarecer um
// bullet de um review; são afirmações dele sobre a empresa, na mesma moeda.
export interface ClarificationRow {
  id: string; category: string; item_text: string; clarification_text: string; updated_at?: string | null;
}

// A categoria do review (strengths/weaknesses/…) não diz de que ASSUNTO
// fala — só se era ponto forte ou fraco. Sem forma mecânica de inferir o
// assunto, aterra em 'solucao' (classe 4, o neutro), e o founder
// re-categoriza na aceitação se importar.
export function clarificationToAtom(row: ClarificationRow): RawAtom | null {
  if (!row.clarification_text?.trim()) return null;
  return {
    category: 'solucao',
    statement: row.clarification_text.trim(),
    sourceKind: 'founder_answer',
    sourceRef: row.id,
    at: row.updated_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// A agregação. Recebe as linhas já lidas (o adaptador é que fala com a base
// de dados) e devolve os átomos por ordem estável.
export interface KnowledgeSources {
  facts: FactRow[];
  org: OrgProfileRow | null;
  fundingRounds: FundingRoundRow[];
  milestones: RoadmapMilestoneRow[];
  roadmapCategories: (CategoryLike & { label: string })[];
  people: CompanyPersonRow[];
  clarifications: ClarificationRow[];
}

export function knowledgeToAtoms(sources: KnowledgeSources): RawAtom[] {
  return [
    ...sources.facts.map(factToAtom),
    ...(sources.org ? orgProfileToAtoms(sources.org) : []),
    ...sources.fundingRounds.map(fundingRoundToAtom),
    ...roadmapToAtoms(sources.milestones, sources.roadmapCategories),
    ...sources.people.map(personToAtom),
    ...sources.clarifications.map(clarificationToAtom),
  ].filter((a): a is RawAtom => a !== null);
}

// Um átomo já é conhecido se QUALQUER claim existente diz o mesmo — aceite,
// rejeitado, OU proposto. Rejeitado conta: o founder já disse que não
// queria aquilo, e re-propor a cada análise seria pedir-lhe para rejeitar o
// mesmo para sempre. Proposto conta pela MESMA razão, e é o bug real do
// Prompt 366: antes disto, cada "Re-read my company" sobre um perfil sem
// alterações reinseria os MESMOS átomos como claims `proposed` novas —
// duplicados byte-a-byte em "To review", crescendo a cada re-leitura,
// nunca resolvidos. A comparação já é por texto exacto normalizado (trim +
// lowercase + espaços colapsados), por isso incluir `proposed` não arrisca
// esconder uma actualização legítima: só bloqueia reinserir texto IDÊNTICO
// ao que já está pendente — exactamente o que POST /api/blueprint's próprio
// comentário sempre disse que isto fazia. Comparação por texto normalizado
// — os sourceRef mudam quando a linha de origem é reescrita, o texto é o
// que o founder reconhece.
export function isAlreadyKnown(atom: RawAtom, existing: { statement: string; status: string }[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const key = norm(atom.statement);
  return existing.some((c) => norm(c.statement) === key);
}

export function newAtoms(atoms: RawAtom[], existing: { statement: string; status: string }[]): RawAtom[] {
  return atoms.filter((a) => !isAlreadyKnown(a, existing));
}
