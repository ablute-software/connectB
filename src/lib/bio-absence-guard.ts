// Prompt 613 §C.3 — "a frase 'no additional information was provided'
// desaparece — se não há material, o Sherlock pergunta, não afirma."
//
// What shipped, on a person whose LinkedIn URL was on file and correct:
//
//   "Nuno Marujo serves as CTO of the company. No additional information was
//    provided in the materials."
//
// Two failures in eighteen words. The first sentence hands the founder back
// the title he typed thirty seconds earlier, as if it were work. The second
// is a machine announcing its own ignorance to a customer — and announcing it
// as a property of the customer's materials, which in this case was not even
// true: the material was there and the fetch that was supposed to read it had
// silently failed.
//
// So: absence is never asserted. It is either asked about, or it is silent.

const ABSENCE_PATTERNS: RegExp[] = [
  /\bno (?:additional|further|other|more)?\s*(?:information|details?|data|material)\b[^.]*\b(?:was|were|is|are)?\s*(?:provided|available|supplied|found|given)\b/i,
  /\bnothing (?:else |further |more )?(?:was |is )?(?:provided|available|found|known|stated)\b/i,
  /\b(?:the )?(?:materials?|documents?|sources?)\s+(?:provided\s+)?(?:do(?:es)? not|don'?t|did not|didn'?t)\s+(?:contain|include|mention|provide|say)\b/i,
  /\b(?:insufficient|not enough|limited)\s+(?:information|detail|material|data)\b/i,
  /\bno (?:public|publicly available)\s+(?:information|profile|record)\b/i,
  /\bunable to (?:find|locate|verify|confirm)\b/i,
  /\bcould not (?:find|locate|verify|confirm)\b/i,
];

/** True when this sentence's job is to announce that something is missing. */
export function assertsAbsence(sentence: string): boolean {
  return ABSENCE_PATTERNS.some((p) => p.test(sentence));
}

// Split on sentence ends, keeping the punctuation. Deliberately simple: this
// runs over two or three model-written sentences, not over prose in the wild.
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

export interface AbsenceScrubResult {
  text: string;
  /** The sentences taken out, so a caller can log or explain the change. */
  removed: string[];
}

/**
 * Removes every sentence whose content is "there was nothing". What remains
 * may be empty — and empty is the correct outcome: an empty bio with a
 * question beside it is honest, where a bio that says nothing was found is
 * both useless and, when the fetch simply failed, false.
 */
export function scrubAbsenceClaims(text: string | null | undefined): AbsenceScrubResult {
  const input = (text ?? '').trim();
  if (!input) return { text: '', removed: [] };
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of sentences(input)) (assertsAbsence(s) ? removed : kept).push(s);
  return { text: kept.join(' ').trim(), removed };
}

/**
 * §C.3 — the question that replaces the assertion. Used when the model gave
 * nothing usable and did not supply its own question: one question, about one
 * person, that a founder can answer in a sentence.
 */
export function fallbackQuestion(personName: string, title: string | null): string {
  // Deliberately NOT "we could not find enough about X" — that is still the
  // machine narrating its own failure to the customer, which is the thing
  // §C.3 objects to, and it would be deleted by the scrubber above anyway
  // (the test that caught this is the one that asserts the question survives
  // its own guard). Just the question.
  const first = personName.split(/\s+/)[0];
  const role = title?.trim() ? `, as ${title.trim()},` : '';
  return `What has ${first}${role} built or run before that an investor would care about here?`;
}
