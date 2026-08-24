// Prompt 368 — the mechanical backstop for "Suggested events" repeating a
// fact already on the roadmap. The system prompt (suggest-events/route.ts)
// is the first line of defense; this is the second, model-independent one:
// titles for the same real-world fact are rarely byte-identical ("Awarded
// 'Woman In Tech EU' badge" vs "WomenTechEU prize"), so exact/lowercase
// string equality (the same class of check Prompts 358/366 already used
// elsewhere) isn't enough here — this compares by word STEM overlap
// instead, camelCase-aware (roadmap/badge titles are often compound words
// with no spaces).
//
// Pure, no AI: a same-year gate (an event proposed for a different year
// than anything on record is unlikely to be the same fact, regardless of
// title similarity) plus a word-stem-overlap ratio on the titles.
export interface RoadmapDuplicateCandidate { title: string; date: string }
export interface ExistingRoadmapEvent { title: string; date: string }

const STEM_LEN = 3;
const MIN_WORD_LEN = 3;
const OVERLAP_THRESHOLD = 0.5;

function stemWords(title: string): Set<string> {
  // Split camelCase/compound words ("WomenTechEU" -> "Women Tech EU")
  // before the usual lowercase + punctuation strip, or a title with no
  // spaces at all would never share a word with a spaced one.
  const spaced = title.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return new Set(
    spaced.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= MIN_WORD_LEN)
      .map((w) => w.slice(0, STEM_LEN)),
  );
}

function wordStemOverlapRatio(a: string, b: string): number {
  const wa = stemWords(a);
  const wb = stemWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size);
}

export function isDuplicateRoadmapEvent(
  candidate: RoadmapDuplicateCandidate, existing: ExistingRoadmapEvent[],
): boolean {
  const candidateYear = candidate.date.slice(0, 4);
  return existing.some((e) => {
    if (!candidateYear || e.date.slice(0, 4) !== candidateYear) return false;
    return wordStemOverlapRatio(candidate.title, e.title) >= OVERLAP_THRESHOLD;
  });
}
