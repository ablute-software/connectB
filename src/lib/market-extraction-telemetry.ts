// Prompt 486 — what the model actually returned, counted at every stage a
// thing can disappear.
//
// WHY THIS EXISTS. On 31/08 two complete, paid reads of
// Competitive_Landscape_and_Moat.docx.pdf (in=17966, out=2417 and 2431, no
// max_tokens truncation, ~€0.052 each) changed absolutely nothing: zero
// items proposed, zero enriched, zero competitors backfilled, and not one
// row in market_research_items, org_competitors or market_facts. The route
// could not say why, because between "the model answered" and "nothing was
// written" there was no measurement of any kind. Three explanations fit the
// same observable and the code could not tell them apart:
//
//   (a) the model genuinely reported nothing extractable;
//   (b) it reported items that the parser dropped — most likely on
//       document_index failing to resolve, which drops an item before it is
//       ever stored;
//   (c) it reported competitors WITHOUT the optional facets
//       (candidateKind/candidateStage/relation are not in the schema's
//       `required` list, deliberately), so nothing got a classification, so
//       every one collided with a row left by another document and came back
//       'unchanged' — a real possibility given production holds 10
//       document-sourced `players` rows and 0 of them carry facets.
//
// Counting is cheap and would have made this prompt unnecessary, so it is
// permanent rather than a temporary probe. Everything here is pure: the
// route logs it, this module never logs anything itself.
export const MARKET_EXTRACTION_SECTIONS = ['market_size', 'growth', 'segments', 'competitors', 'trends', 'regulatory'] as const;
export type MarketExtractionSection = typeof MARKET_EXTRACTION_SECTIONS[number];

export type RawSectionCounts = Record<MarketExtractionSection, number>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// How many items the model put in each section of the tool call, before any
// of this codebase's own rules run. This is the number that separates (a)
// from (b) and (c): if it is all zeros, the model reported nothing and there
// is nothing downstream to fix.
export function countRawSections(raw: unknown): RawSectionCounts {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = {} as RawSectionCounts;
  for (const section of MARKET_EXTRACTION_SECTIONS) out[section] = asArray(r[section]).length;
  return out;
}

export interface CompetitorAudit {
  total: number;
  // The two the parser requires before an item can exist at all.
  withName: number;
  withDocumentIndex: number;
  // Which document indexes the model actually cited, so an off-by-one or an
  // invented index is visible rather than inferred. Sorted, deduped.
  citedDocumentIndexes: number[];
  // The three that decide whether classifyCompetitor can run (Prompt 478),
  // and therefore whether Prompt 482's enrichment can ever fire.
  withCandidateKind: number;
  withCandidateStage: number;
  withRelation: number;
  withAllThreeFacetFields: number;
}

// The competitors section gets its own audit because it is the one with a
// second, stricter bar after parsing: an item can be perfectly valid, be
// stored, and STILL change nothing, because without the three facet fields
// it carries no classification and collides with whatever row already owns
// its title.
export function auditRawCompetitors(raw: unknown): CompetitorAudit {
  const items = asArray((raw as Record<string, unknown> | null)?.competitors);
  const audit: CompetitorAudit = {
    total: items.length, withName: 0, withDocumentIndex: 0, citedDocumentIndexes: [],
    withCandidateKind: 0, withCandidateStage: 0, withRelation: 0, withAllThreeFacetFields: 0,
  };
  const indexes = new Set<number>();
  for (const raw of items) {
    const item = (raw ?? {}) as Record<string, unknown>;
    if (typeof item.name === 'string' && item.name.trim()) audit.withName += 1;
    if (typeof item.document_index === 'number' && Number.isFinite(item.document_index)) {
      audit.withDocumentIndex += 1;
      indexes.add(item.document_index);
    }
    const kind = typeof item.candidateKind === 'string' && item.candidateKind ? 1 : 0;
    const stage = typeof item.candidateStage === 'string' && item.candidateStage ? 1 : 0;
    const relation = item.relation && typeof item.relation === 'object' ? 1 : 0;
    audit.withCandidateKind += kind;
    audit.withCandidateStage += stage;
    audit.withRelation += relation;
    if (kind && stage && relation) audit.withAllThreeFacetFields += 1;
  }
  audit.citedDocumentIndexes = [...indexes].sort((a, b) => a - b);
  return audit;
}

// What survived parsing, by the section names this codebase uses internally
// (market-document-extract.ts maps market_size -> 'sizing', competitors ->
// 'players'). Compared against countRawSections, the difference IS the drop.
export function countProposalsBySection(proposals: readonly { section: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of proposals) out[p.section] = (out[p.section] ?? 0) + 1;
  return out;
}

// Kept as its own union rather than imported from market-research-item-upsert
// (that module is `server-only`; this one is deliberately not). The two are
// kept in step MECHANICALLY, not by discipline: document-extract/route.ts
// does `outcomeTally[outcome] += 1`, so a name added on one side and not the
// other is a tsc error at that line — which is exactly how Prompt 492's own
// new name announced itself.
export type ProposalOutcomeName =
  | 'inserted' | 'enriched' | 'competitor_backfilled' | 'unchanged'
  | 'title_collision_cross_document';
export type OutcomeTally = Record<ProposalOutcomeName, number>;

export function emptyOutcomeTally(): OutcomeTally {
  return { inserted: 0, enriched: 0, competitor_backfilled: 0, unchanged: 0, title_collision_cross_document: 0 };
}

// Prompt 492 — the sentence for the bucket that has no other way of being
// seen. It says what happened AND what was not checked, because the second
// half is the actionable part: nothing here compared the two readings, so
// "collided" is not the same claim as "was a duplicate".
function crossDocumentClause(n: number): string {
  if (n === 0) return '';
  return `; ${n} proposal(s) were not stored because the title was already owned by an item from another document — the contents were never compared, so there may be new information here that nobody has seen`;
}

// The line that finally distinguishes "the model said nothing" from
// "everything it said collided with a row that already existed". Both leave
// itemsProposed at zero; only one of them has a non-zero `unchanged`.
export function describeExtractionTelemetry(input: {
  rawSections: RawSectionCounts;
  competitors: CompetitorAudit;
  parsedBySection: Record<string, number>;
  outcomes: OutcomeTally;
  // Prompt 486, found by the adversarial pass on this very function: the
  // outcome tally only counts the LEGACY proposals. growth and sizing go
  // straight to typed market_facts and never reach that loop, so a document
  // that yields only those would have been described as "none changed
  // anything — 0 collided with rows that already exist", which is both
  // wrong and the exact species of misleading sentence this prompt exists
  // to stop producing.
  factsWritten: number;
}): string {
  const { rawSections, competitors, parsedBySection, outcomes, factsWritten } = input;
  const rawTotal = MARKET_EXTRACTION_SECTIONS.reduce((n, s) => n + rawSections[s], 0);
  const parsedTotal = Object.values(parsedBySection).reduce((n, v) => n + v, 0);
  // The new bucket counts as having gone through the legacy loop — it is a
  // proposal that reached it and was swallowed, not one that never arrived.
  const legacyTotal = outcomes.inserted + outcomes.enriched + outcomes.competitor_backfilled
    + outcomes.unchanged + outcomes.title_collision_cross_document;

  if (rawTotal === 0) return 'the model reported nothing in any section';
  if (parsedTotal === 0) return `the model reported ${rawTotal} item(s) and every one was dropped before storage`;

  // Deliberately NOT counted in `changed`: a cross-document collision changed
  // nothing. It is reported beside the zero, never folded into it.
  const changed = outcomes.inserted + outcomes.enriched + outcomes.competitor_backfilled + factsWritten;
  if (changed === 0) {
    const collided = outcomes.unchanged + outcomes.title_collision_cross_document;
    if (collided > 0) {
      return `${parsedTotal} item(s) parsed and none changed anything — ${collided} collided with rows that already exist`
        + crossDocumentClause(outcomes.title_collision_cross_document);
    }
    // Parsed, but nothing reached either destination: every proposal was
    // routed to the typed pipeline and none of it produced a fact.
    return `${parsedTotal} item(s) parsed, none reached the legacy loop and none became a typed fact`;
  }

  const unclassified = competitors.total - competitors.withAllThreeFacetFields;
  const facetNote = unclassified > 0
    ? `; ${unclassified} of ${competitors.total} competitor(s) arrived without the facets a classification needs`
    : '';
  const factsNote = factsWritten > 0 ? `, ${factsWritten} typed fact(s) written` : '';
  return `${outcomes.inserted} inserted, ${outcomes.enriched} enriched, ${outcomes.competitor_backfilled} competitor(s) backfilled${factsNote}${facetNote}`
    + crossDocumentClause(outcomes.title_collision_cross_document)
    + (legacyTotal === 0 ? ' (nothing went through the legacy loop)' : '');
}
