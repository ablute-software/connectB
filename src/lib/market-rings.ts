// Prompt 373 §A — the market in LAYERS, not one number. Three rings per
// org: beachhead (where you sell first), serviceable (what your current
// product can serve), category (the whole category the product lives in).
// Pure and mechanical on purpose, same discipline as company-claims.ts's
// own header: a ring's TEXT fields (label/definition/buyer/geography) are
// templated from structured knowledge the founder already confirmed
// (sectors, stage, country, one-liner) — legible starting points the
// founder corrects, never a model inventing a market story. A ring's
// NUMBER (size_value_eur) is attached ONLY when a matching, already-sourced
// sizing fact exists — "better empty than invented" (the prompt's own
// words) is enforced structurally here, not by convention: there is no
// code path in this file that can produce a size without a source_url.
export type RingKey = 'beachhead' | 'serviceable' | 'category';
export const RING_ORDER: RingKey[] = ['beachhead', 'serviceable', 'category'];
export const RING_LABEL: Record<RingKey, string> = {
  beachhead: 'Beachhead', serviceable: 'Serviceable', category: 'Category',
};

export interface SizingFact {
  // Free-text scope as founders already type it today (org_market_data's
  // own market_size_scope field, e.g. "TAM Europe", "SAM Portugal", "SOM
  // hospital urology") — matched to a ring by keyword, never guessed.
  scopeLabel: string;
  valueEur: number;
  year: number | null;
  sourceUrl: string | null;
  method: 'bottom_up' | 'top_down' | 'report';
}

export interface RingProposal {
  ring: RingKey;
  label: string;
  definition: string;
  buyer: string | null;
  geography: string | null;
  sizeValueEur: number | null;
  sizeYear: number | null;
  sizeMethod: 'bottom_up' | 'top_down' | 'report' | null;
  sizeSourceUrl: string | null;
  expansionCondition: string;
}

// Keyword-based ring matching for a free-text sizing scope — SOM-ish
// phrasing maps to the narrowest ring (beachhead), TAM-ish to the widest
// (category). A sizing fact that matches no keyword is simply never
// attached to any ring — it stays visible elsewhere (the "Added by you"
// history), never silently guessed into one.
function matchRing(scopeLabel: string): RingKey | null {
  const s = scopeLabel.toLowerCase();
  if (/\bsom\b|beachhead/.test(s)) return 'beachhead';
  if (/\bsam\b|serviceable/.test(s)) return 'serviceable';
  if (/\btam\b|category|total addressable/.test(s)) return 'category';
  return null;
}

export interface RingProposalInput {
  sectors: string[];
  stage: string | null;
  country: string | null;
  oneLiner: string | null;
  sizingFacts: SizingFact[];
}

export function proposeMarketRings(input: RingProposalInput): RingProposal[] {
  const sector = input.sectors[0] ?? 'your category';
  const sizingByRing = new Map<RingKey, SizingFact>();
  for (const fact of input.sizingFacts) {
    const ring = matchRing(fact.scopeLabel);
    // First match wins per ring — a founder correcting a wrong guess later
    // is the expected path (Accept/Edit/Reject), not this function
    // silently picking "the biggest number" among several candidates.
    if (ring && !sizingByRing.has(ring)) sizingByRing.set(ring, fact);
  }

  const TEMPLATES: Record<RingKey, { label: string; definition: string; buyer: string | null; expansionCondition: string }> = {
    beachhead: {
      label: `${sector} — first beachhead`,
      definition: `Where you sell first: the narrowest slice of ${sector}${input.country ? ` in ${input.country}` : ''} your current traction already reaches.`,
      buyer: null,
      expansionCondition: 'What has to become true to widen beyond this beachhead (e.g. a second reference customer, a certification, a repeatable sales motion).',
    },
    serviceable: {
      label: `${sector} — serviceable market`,
      definition: `What your CURRENT product can serve today: ${sector}${input.stage ? ` at ${input.stage} readiness` : ''}, beyond the initial beachhead.`,
      buyer: null,
      expansionCondition: 'What has to become true to reach the wider category (e.g. a new channel, a price point, a broader regulatory clearance).',
    },
    category: {
      label: `${sector} — category`,
      definition: `The whole category ${sector} lives in — the ceiling your product could eventually reach with real product/market expansion.`,
      buyer: null,
      expansionCondition: 'What has to become true to compete for the full category (e.g. a platform play, multiple product lines, international expansion).',
    },
  };

  return RING_ORDER.map((ring) => {
    const t = TEMPLATES[ring];
    const sizing = sizingByRing.get(ring);
    return {
      ring, label: t.label, definition: input.oneLiner ? `${t.definition} ${input.oneLiner}` : t.definition,
      buyer: t.buyer, geography: input.country,
      sizeValueEur: sizing?.valueEur ?? null, sizeYear: sizing?.year ?? null,
      sizeMethod: sizing?.method ?? null, sizeSourceUrl: sizing?.sourceUrl ?? null,
      expansionCondition: t.expansionCondition,
    };
  });
}
