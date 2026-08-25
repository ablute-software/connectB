// Prompt 373 §A — the market in LAYERS, not one number. Three rings per
// org: beachhead (where you sell first), serviceable (what your current
// product can serve), category (the whole category the product lives in).
//
// Prompt 378 §B — what the founder actually saw on the real site was
// "Digital Health — first beachhead. Where you sell first: the narrowest
// slice… health and wellness autonomous monitoring with daily insight" —
// a template sentence with the one-liner glued onto its end and a raw
// `pre_seed` enum in the prose, and "No sourced number" on all three rings.
// Two separate defects, both fixed here:
//   1. Grammar: the definition is composed of COMPLETE sentences only. The
//      one-liner becomes its own sentence (never concatenated mid-phrase),
//      and an enum is always passed through a human label (`pre_seed` ->
//      "pre-seed") — never printed raw.
//   2. Emptiness: sizing came only from tables that were empty. That's now
//      fed by the Vault extractions (see readSizingFacts in the rings
//      route) — but the honest-empty contract still holds here: this
//      function NEVER fabricates a number. There is no code path that can
//      produce a size without a real source. `hasAnyKnowledge` below lets
//      the caller refuse to propose at all rather than emit madlibs.
export type RingKey = 'beachhead' | 'serviceable' | 'category';
export const RING_ORDER: RingKey[] = ['beachhead', 'serviceable', 'category'];
export const RING_LABEL: Record<RingKey, string> = {
  beachhead: 'Beachhead', serviceable: 'Serviceable', category: 'Category',
};

// Prompt 378 §B.4 — an enum never reaches prose raw. Anything not on this
// list is simply omitted from the sentence rather than printed as-is.
const STAGE_LABEL: Record<string, string> = {
  pre_seed: 'pre-seed', seed: 'seed', series_a: 'Series A', series_b: 'Series B',
  series_b_plus: 'Series B+', series_c_plus: 'Series C+', growth: 'growth',
};
export function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  return STAGE_LABEL[stage] ?? null;
}

export interface SizingFact {
  // Free-text scope as founders already type it today (org_market_data's
  // own market_size_scope field, e.g. "TAM Europe", "SAM Portugal", "SOM
  // hospital urology") — matched to a ring by keyword, never guessed.
  scopeLabel: string;
  valueEur: number;
  year: number | null;
  // Prompt 378 §B.2 — either a real external URL, or an INTERNAL Vault
  // reference of the form `doc:<uuid>#p<page>` for a fact cited to one of
  // the founder's own documents. Never a fabricated URL: a document-sourced
  // fact keeps a document-shaped reference, and the UI renders it as "from
  // your Market_Sizing, p. 4" rather than as a link.
  sourceUrl: string | null;
  sourceDocumentName?: string | null;
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

// Prompt 378 §B.2 — the internal Vault-citation format, in ONE place so the
// writer (the rings route) and the reader (the UI) can never disagree on it.
export function vaultCitation(documentId: string, page: number | null): string {
  return `doc:${documentId}${page != null ? `#p${page}` : ''}`;
}
export function parseVaultCitation(sourceUrl: string | null | undefined): { documentId: string; page: number | null } | null {
  if (!sourceUrl || !sourceUrl.startsWith('doc:')) return null;
  const [idPart, pagePart] = sourceUrl.slice('doc:'.length).split('#p');
  if (!idPart) return null;
  const page = pagePart ? Number(pagePart) : null;
  return { documentId: idPart, page: Number.isFinite(page) ? page : null };
}

// Keyword-based ring matching for a free-text sizing scope — SOM-ish
// phrasing maps to the narrowest ring (beachhead), TAM-ish to the widest
// (category). A sizing fact that matches no keyword is simply never
// attached to any ring — it stays visible elsewhere, never silently guessed.
function matchRing(scopeLabel: string): RingKey | null {
  const s = scopeLabel.toLowerCase();
  if (/\bsom\b|beachhead|serviceable obtainable/.test(s)) return 'beachhead';
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

// Prompt 378 §B.3 — "propose with no knowledge available doesn't propose
// empty": the caller uses this to show "I haven't read your market
// documents yet — run the portrait first" instead of generating three
// content-free template rings. A sector alone is NOT knowledge about the
// founder's market; a real sizing fact (from the Vault or from accepted
// research) is.
export function hasAnyKnowledge(input: RingProposalInput): boolean {
  return input.sizingFacts.length > 0;
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

  const stage = stageLabel(input.stage);
  const where = input.country ? ` in ${input.country}` : '';

  const TEMPLATES: Record<RingKey, { label: string; definition: string; expansionCondition: string }> = {
    beachhead: {
      label: `${sector} — beachhead`,
      definition: `Where you sell first: the narrowest slice of ${sector}${where} your current traction already reaches.`,
      expansionCondition: 'What has to become true to widen beyond this beachhead (e.g. a second reference customer, a certification, a repeatable sales motion).',
    },
    serviceable: {
      label: `${sector} — serviceable market`,
      definition: stage
        ? `What your current product can serve today, at ${stage} stage, beyond the initial beachhead.`
        : 'What your current product can serve today, beyond the initial beachhead.',
      expansionCondition: 'What has to become true to reach the wider category (e.g. a new channel, a price point, a broader regulatory clearance).',
    },
    category: {
      label: `${sector} — category`,
      definition: `The whole ${sector} category — the ceiling this product could reach with real product and market expansion.`,
      expansionCondition: 'What has to become true to compete for the full category (e.g. a platform play, multiple product lines, international expansion).',
    },
  };

  return RING_ORDER.map((ring) => {
    const t = TEMPLATES[ring];
    const sizing = sizingByRing.get(ring);
    // §B.4 — the one-liner is its OWN sentence appended after a full stop,
    // never spliced into the middle of the template's sentence. Trailing
    // punctuation is normalized so two sentences never run together.
    const oneLiner = input.oneLiner?.trim();
    const definition = oneLiner
      ? `${t.definition} ${oneLiner.replace(/\s*$/, '').replace(/([^.!?])$/, '$1.')}`
      : t.definition;
    return {
      ring, label: t.label, definition,
      buyer: null, geography: input.country,
      sizeValueEur: sizing?.valueEur ?? null, sizeYear: sizing?.year ?? null,
      sizeMethod: sizing?.method ?? null, sizeSourceUrl: sizing?.sourceUrl ?? null,
      expansionCondition: t.expansionCondition,
    };
  });
}
