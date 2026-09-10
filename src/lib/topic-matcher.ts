// Prompt 585 §B.3 — deterministic topic matcher. Zero AI: normalizes
// (lowercase, diacritics stripped, word boundaries), finds every synonym
// from the taxonomy present in a text, prefers the LONGEST match at any
// overlapping position ("maior correspondência primeiro" — so "breast
// cancer" wins over the bare "cancer"/oncology match at the same span),
// and returns at most one match per topic (its earliest position).
//
// Known, accepted false positive (documented, not "fixed" — per the
// prompt's own note): a generic word like "cancer" inside an unrelated
// proper noun ("Cancer Research UK" as an entity name) still marks
// oncology. This is a plain word-boundary matcher, not NER — polarity and
// strength (computed elsewhere from the evidence's own fields, never by
// this function) are what keep a false positive from carrying real
// weight, not the matcher pretending to understand context it doesn't have.
//
// Pluralization: only single-word synonyms get an optional trailing-s
// variant (covers "biomarker"/"biomarkers" both ways). Multi-word
// synonyms ("breast cancer") match exactly as seeded — their plural forms
// are rare enough in practice that adding a per-word inflection engine
// here would be effort disproportionate to the gain; noted as a v1 scope
// line, not a silent gap.
export interface TopicNode {
  id: string;
  synonyms: string[];
}

export interface TopicMatch {
  topicId: string;
  matchedTerm: string;
  position: number;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function singularPluralVariants(normSyn: string): string[] {
  if (normSyn.includes(' ')) return [normSyn];
  if (normSyn.endsWith('s') && normSyn.length > 3) return [normSyn, normSyn.slice(0, -1)];
  return [normSyn, `${normSyn}s`];
}

interface Candidate { topicId: string; term: string; start: number; end: number }

export function matchTopics(text: string, taxonomy: TopicNode[]): TopicMatch[] {
  const normalizedText = normalize(text);
  if (!normalizedText) return [];

  const candidates: Candidate[] = [];
  for (const node of taxonomy) {
    for (const syn of node.synonyms) {
      const normSyn = normalize(syn);
      if (!normSyn) continue;
      for (const variant of singularPluralVariants(normSyn)) {
        const re = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(normalizedText))) {
          candidates.push({ topicId: node.id, term: syn, start: m.index, end: m.index + variant.length });
        }
      }
    }
  }

  // Longest span first; drop any shorter candidate (any topic) whose span
  // overlaps one already kept — "maior correspondência primeiro".
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept: Candidate[] = [];
  for (const c of candidates) {
    const overlaps = kept.some((k) => c.start < k.end && k.start < c.end);
    if (!overlaps) kept.push(c);
  }

  // One match per topic — its earliest surviving position.
  const byTopic = new Map<string, Candidate>();
  for (const c of [...kept].sort((a, b) => a.start - b.start)) {
    if (!byTopic.has(c.topicId)) byTopic.set(c.topicId, c);
  }

  return [...byTopic.values()]
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ topicId: c.topicId, matchedTerm: c.term, position: c.start }));
}
