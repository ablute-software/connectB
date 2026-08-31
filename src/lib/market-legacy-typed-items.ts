// Prompt 488 §1 — the growth/sizing cards that Prompt 467 replaced and
// nobody retired.
//
// Prompt 467 (commit 5f577f5, 29/08 21:59) routed document-sourced
// growth/market_size out of market_research_items and into the typed
// market_facts pipeline. Its own commit message said it replaced "the eight
// cards that used to present deck numbers as undifferentiated Market
// Intelligence". The replacement only ever applied going forward: the rows
// written BEFORE it stayed `pending` and kept rendering, because nothing
// resolved, archived or migrated them when the pipeline underneath changed.
//
// Measured in production 31/08, before deciding anything: 16 such rows, in
// ONE org (ablute_) — 8 `growth` + 8 `sizing`, all source_kind='document',
// all status='pending', created 29/08 between 15:36 and 18:55, i.e. all of
// them hours before 467 landed. The web-sourced growth/sizing rows (5 and 17
// pending) are NOT this: the web research path still legitimately produces
// them, and they are untouched here.
//
// WHY A READ FILTER AND NOT A NEW STATUS. The prompt's own risk boundary
// says to check for an existing state before asking for a new one. There
// isn't one: market_research_items_status_check allows exactly
// ('pending','accepted','rejected'), and marking these 'rejected' would
// record a decision the founder never made — this codebase is careful about
// exactly that distinction. A real state would mean widening a CHECK
// constraint and UPDATEing 16 production rows, and an in-migration UPDATE is
// outside the additive boundary this project applies without sign-off. So:
// nothing is deleted, nothing is relabelled, nothing pretends not to have
// existed — the rows stay exactly as they are, readable by SQL and by the
// audit path, and simply stop being offered to the founder as decisions.
//
// The combination is self-describing, which is what makes filtering on it
// honest rather than a heuristic: since 467, a document-sourced growth or
// sizing number is stored as a market_fact. A legacy row carrying one is by
// construction not how that data lives any more.
//
// ONE KNOWN CONSEQUENCE, stated rather than discovered later: 467 v3 §4
// keeps a fallback where, if marketFactsAvailable() is false (migration 0279
// absent, or its ~60s negative-cache window right after a deploy), the
// document path writes growth/sizing to market_research_items after all, so
// that nothing paid for vanishes. Rows produced by that fallback match this
// predicate too and are therefore hidden from the active list — they remain
// in the table and in ai_call_log's paid record, but the founder would not
// see them. That is the deliberate trade: a rare, transient case loses
// visibility so that the permanent, already-present one stops crowding the
// screen.
export interface LegacySectionItem {
  section: string;
  sourceKind: string | null;
}

// The two sections Prompt 467 moved. 'sizing' is the internal name for what
// the extraction tool calls market_size (market-document-extract.ts maps
// one to the other) — the DB CHECK on market_research_items.section allows
// 'sizing', never 'market_size', so this is the value that actually exists.
export const TYPED_PIPELINE_SECTIONS = ['growth', 'sizing'] as const;

export function isSupersededByTypedFacts(item: LegacySectionItem): boolean {
  if (item.sourceKind !== 'document') return false;
  return (TYPED_PIPELINE_SECTIONS as readonly string[]).includes(item.section);
}
