// Prompt 370 §C — the "Read my documents" pass turns a closed-schema model
// response into market_research_items proposals. Pure parsing/validation,
// no AI call here: the route builds the prompt and calls the model, this
// module only ever normalizes what came back.
//
// The model is NEVER trusted to name its own source document by id or
// name (that's exactly the kind of detail a model can misremember/invent).
// Instead every document sent to the model is announced by a 1-based
// `document_index` in the prompt text, and the model must echo that index
// back per item — this function maps it back to the real document via a
// server-trusted lookup, and DROPS any item whose index doesn't resolve.
// That is the mechanical enforcement of "never a fact without a real
// document+page of origin" — no item survives without one.
export type MarketSection = 'sizing' | 'growth' | 'segments' | 'players' | 'trends' | 'regulatory';

export interface MarketDocRef { id: string; name: string }

export interface MarketProposal {
  section: MarketSection;
  title: string;
  detail: string;
  documentId: string;
  documentName: string;
  page: number | null;
  // Typed fields for sections that can auto-fill org_market_data on Accept
  // (sizing/growth/segments/players) — undefined for trends/regulatory,
  // which have no dedicated org_market_data field and fall back to
  // becoming a claim instead (same as a Sherlock web research item).
  structured?: Record<string, unknown>;
}

interface RawItemBase { document_index?: unknown; page?: unknown }
// Prompt 466 §B — market_definition/geography/metric/bound/period_start/
// period_end/as_of_year/methodology: candidate context for the NEW
// normalization pipeline (market-fact-normalization.ts, not wired to this
// parser yet — that's Prompt 467). Captured into `structured` below so
// nothing the model now returns is silently dropped in the meantime, same
// "never discard in silence" discipline as everything else here.
interface RawSizing extends RawItemBase {
  value?: unknown; currency?: unknown; scope?: unknown; year?: unknown; source_quote?: unknown;
  market_definition?: unknown; geography?: unknown; metric?: unknown; bound?: unknown; as_of_year?: unknown; methodology?: unknown;
}
interface RawGrowth extends RawItemBase {
  pct?: unknown; period?: unknown;
  market_definition?: unknown; geography?: unknown; metric?: unknown; bound?: unknown; period_start?: unknown; period_end?: unknown; source_quote?: unknown;
}
interface RawSegment extends RawItemBase { name?: unknown }
interface RawCompetitor extends RawItemBase { name?: unknown; country?: unknown; stage?: unknown; note?: unknown }
interface RawTextItem extends RawItemBase { title?: unknown; detail?: unknown }

interface RawMarketExtraction {
  market_size?: RawSizing[];
  growth?: RawGrowth[];
  segments?: RawSegment[];
  competitors?: RawCompetitor[];
  trends?: RawTextItem[];
  regulatory?: RawTextItem[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
// Prompt 466 §B — the model is instructed (tool schema enum) to only ever
// emit one of these strings, but raw model output is `unknown` until
// checked — never trust an enum constraint enforced only on the far side.
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
function resolveDoc(raw: RawItemBase, docsByIndex: Map<number, MarketDocRef>): { doc: MarketDocRef; page: number | null } | null {
  const idx = num(raw.document_index);
  if (idx === null) return null;
  const doc = docsByIndex.get(idx);
  if (!doc) return null;
  return { doc, page: num(raw.page) };
}

export function parseMarketExtractionRaw(raw: unknown, docsByIndex: Map<number, MarketDocRef>): MarketProposal[] {
  const r = (raw ?? {}) as RawMarketExtraction;
  const out: MarketProposal[] = [];

  for (const item of r.market_size ?? []) {
    const resolved = resolveDoc(item, docsByIndex);
    const value = num(item.value);
    const scope = str(item.scope);
    if (!resolved || value === null || !scope) continue;
    const year = num(item.year);
    const currency = str(item.currency) ?? 'EUR';
    out.push({
      section: 'sizing', title: `Market size: ${currency} ${value.toLocaleString()} (${scope}${year ? `, ${year}` : ''})`,
      detail: str(item.source_quote) ?? '', documentId: resolved.doc.id, documentName: resolved.doc.name, page: resolved.page,
      structured: {
        valueEur: currency === 'EUR' ? value : null, currency, scope, year,
        // Prompt 466 §B — candidate context for the (not-yet-wired, 467)
        // normalization pipeline. Captured now so nothing the widened
        // schema returns is silently dropped in the meantime.
        marketDefinition: str(item.market_definition), geography: str(item.geography),
        metric: oneOf(item.metric, ['TAM', 'SAM', 'SOM', 'category', 'other'] as const),
        bound: oneOf(item.bound, ['point', 'lower', 'upper'] as const),
        asOfYear: num(item.as_of_year), methodology: oneOf(item.methodology, ['bottom_up', 'external_estimate', 'other'] as const),
      },
    });
  }

  for (const item of r.growth ?? []) {
    const resolved = resolveDoc(item, docsByIndex);
    const pct = num(item.pct);
    if (!resolved || pct === null) continue;
    const period = str(item.period);
    out.push({
      section: 'growth', title: `Growth: ${pct}%${period ? ` ${period}` : ''}`, detail: '',
      documentId: resolved.doc.id, documentName: resolved.doc.name, page: resolved.page,
      structured: {
        pct, period,
        // Prompt 466 §B — same candidate context as market_size above.
        marketDefinition: str(item.market_definition), geography: str(item.geography),
        metric: oneOf(item.metric, ['CAGR', 'annual', 'other'] as const),
        bound: oneOf(item.bound, ['point', 'lower', 'upper'] as const),
        periodStart: num(item.period_start), periodEnd: num(item.period_end),
        sourceQuote: str(item.source_quote),
      },
    });
  }

  for (const item of r.segments ?? []) {
    const resolved = resolveDoc(item, docsByIndex);
    const name = str(item.name);
    if (!resolved || !name) continue;
    out.push({
      section: 'segments', title: `Segment: ${name}`, detail: '',
      documentId: resolved.doc.id, documentName: resolved.doc.name, page: resolved.page,
      structured: { name },
    });
  }

  for (const item of r.competitors ?? []) {
    const resolved = resolveDoc(item, docsByIndex);
    const name = str(item.name);
    if (!resolved || !name) continue;
    const country = str(item.country);
    const stage = str(item.stage);
    const note = str(item.note);
    out.push({
      section: 'players', title: `Competitor: ${name}`,
      detail: [country, stage, note].filter(Boolean).join(' · '),
      documentId: resolved.doc.id, documentName: resolved.doc.name, page: resolved.page,
      structured: { name, country: country ?? undefined, stage: stage ?? undefined, note: note ?? undefined },
    });
  }

  for (const [section, items] of [['trends', r.trends], ['regulatory', r.regulatory]] as const) {
    for (const item of items ?? []) {
      const resolved = resolveDoc(item, docsByIndex);
      const title = str(item.title);
      const detail = str(item.detail);
      if (!resolved || !title || !detail) continue;
      out.push({ section, title, detail, documentId: resolved.doc.id, documentName: resolved.doc.name, page: resolved.page });
    }
  }

  return out;
}
