// Prompt 376 — the real ablute_ test: running "Call Sherlock" (web research)
// AFTER "Fill with Watson" (documents-only) produced WORSE bios — Hugo
// Ferreira lost his PhD in Physics, his medical degree, his professorship
// and his institute; Carla Dias lost the RECARDI project. TeamAiFillPanel's
// save() called updateCompanyPerson(personId, { bio }) unconditionally —
// documents are the strong source, the web is a complement, and the code
// had no notion of that hierarchy at all. Every function here is pure and
// mechanical, reused from company-claims.ts wherever the same signal
// already exists (extractNamedEntities/measureSpecificity) rather than a
// second, drifting definition of "specific".
import { extractNamedEntities, measureSpecificity } from './company-claims';
import { tokenize, jaccard } from './action-plan';

// ---------------------------------------------------------------------------
// §A — "never save a bio that loses information the current one had."
export interface BioLossCheck { lost: boolean; reasons: string[] }

export function checkBioLoss(currentBio: string, nextBio: string): BioLossCheck {
  const cur = currentBio.trim();
  const next = nextBio.trim();
  if (!cur) return { lost: false, reasons: [] };
  const reasons: string[] = [];
  if (next.length < cur.length) reasons.push('the new version is shorter than what you have now');

  const nextLower = next.toLowerCase();
  const droppedEntities = extractNamedEntities(cur).filter((e) => !nextLower.includes(e.toLowerCase()));
  if (droppedEntities.length > 0) reasons.push(`drops: ${droppedEntities.join(', ')}`);

  const curDate = measureSpecificity(cur).signals.hasDate;
  const nextDate = measureSpecificity(next).signals.hasDate;
  if (curDate && !nextDate) reasons.push('drops a date the current version had');

  return { lost: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// §B — "an unapproved web fact must never live in the bio prose, only in the
// facts[] list waiting for approval." The SYSTEM prompt already tells the
// model this; the real ablute_ output violated it anyway ("based in Braga"
// and "ESTG" showed up in both places at once). This is the code-level
// enforcement: any bio sentence that substantially overlaps a proposed fact
// is stripped from the bio — the fact stays available in facts[], exactly
// where the founder is meant to review and approve it.
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const OVERLAP_THRESHOLD = 0.4;

// Two independent tests, either one is enough to flag a sentence:
//  - substring containment (case-insensitive): the ablute_ case was
//    near-verbatim duplication ("based in Braga" / "ESTG" word-for-word in
//    both places) — the cheapest, most direct test for exactly that.
//  - Jaccard token overlap: catches a paraphrase of a longer fact that
//    isn't a literal substring but clearly restates the same content.
function sentenceMatchesFact(sentence: string, fact: string, sentenceTokens: Set<string>, factTokens: Set<string>): boolean {
  const factCore = fact.trim().toLowerCase();
  if (factCore.length >= 4 && sentence.toLowerCase().includes(factCore)) return true;
  return jaccard(sentenceTokens, factTokens) >= OVERLAP_THRESHOLD;
}

export function removeFactSentencesFromBio(bio: string, factStatements: string[]): { bio: string; removed: string[] } {
  if (!bio.trim() || factStatements.length === 0) return { bio, removed: [] };
  const facts = factStatements.map((f) => ({ text: f, tokens: tokenize(f) }));
  const sentences = bio.split(SENTENCE_SPLIT).filter((s) => s.trim());
  const removed: string[] = [];
  const kept = sentences.filter((sentence) => {
    const sentenceTokens = tokenize(sentence);
    const overlaps = facts.some((f) => sentenceMatchesFact(sentence, f.text, sentenceTokens, f.tokens));
    if (overlaps) removed.push(sentence.trim());
    return !overlaps;
  });
  return { bio: kept.join(' ').trim(), removed };
}

// ---------------------------------------------------------------------------
// §D — the real ablute_ case: "he leads the company from its headquarters in
// Porto" — a specific, wrong, unsourced claim sitting inside bio PROSE,
// where there's no source or confidence for the founder to weigh. A
// location claim about where someone/something is based only belongs in the
// bio if it matches what the org already has on file; anything else is
// suspect enough to strip rather than let live unchallenged in a sentence
// that reads as settled fact.
const HQ_CLAIM_PATTERN = /\b(headquarters?|based (?:in|out of)|leads? (?:the company|it) from)\b/i;

export function stripUnverifiedHqClaims(bio: string, knownHqCity: string | null): { bio: string; removed: string[] } {
  if (!bio.trim()) return { bio, removed: [] };
  const sentences = bio.split(SENTENCE_SPLIT).filter((s) => s.trim());
  const removed: string[] = [];
  const kept = sentences.filter((sentence) => {
    if (!HQ_CLAIM_PATTERN.test(sentence)) return true;
    if (knownHqCity && sentence.toLowerCase().includes(knownHqCity.toLowerCase())) return true;
    removed.push(sentence.trim());
    return false;
  });
  return { bio: kept.join(' ').trim(), removed };
}

// ---------------------------------------------------------------------------
// §C — a web fact that disagrees with the app's own data is a CONFLICT, not
// an automatic win for either side (the real case: the web said "founded in
// 2019", the app said 2020 — and 2019 was the one that was actually right).
// Detection is mechanical (a year mentioned near "found(ed/ing)"); which
// side is correct is always the founder's call, never assumed here.
const FOUNDED_YEAR_MENTION = /found(?:ed|ing)[^.]{0,25}?\b(19|20)\d{2}\b/i;

export interface FoundedYearConflict { webYear: number; appYear: number }

export function detectFoundedYearConflict(factStatement: string, appFoundedYear: number | null): FoundedYearConflict | null {
  if (appFoundedYear == null) return null;
  if (!FOUNDED_YEAR_MENTION.test(factStatement)) return null;
  const yearMatch = factStatement.match(/\b(19|20)\d{2}\b/);
  if (!yearMatch) return null;
  const webYear = Number(yearMatch[0]);
  if (webYear === appFoundedYear) return null;
  return { webYear, appYear: appFoundedYear };
}

// A fact that contradicts data the app already trusts can never be
// presented at full confidence — by construction, not by asking the model
// to remember to hedge.
const MAX_CONFIDENCE_ON_CONFLICT = 0.5;
export function capConfidenceOnConflict(confidence: number): number {
  return Math.min(confidence, MAX_CONFIDENCE_ON_CONFLICT);
}
