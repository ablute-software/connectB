// Back-office bulk triage (overnight block, Task B1): most of the imported
// field-conflicts are cosmetic (case, diacritics, curly vs straight quotes,
// whitespace, or a short-code/full-name pair like "AT"/"Austria") rather than
// a genuine factual disagreement. Pure byte-diff heuristics only — no AI call
// needed for something this mechanical, and it keeps triage instant.
const COUNTRY_ALIASES: Record<string, string> = {
  pt: 'portugal', es: 'spain', at: 'austria', uk: 'united kingdom', gb: 'united kingdom',
  de: 'germany', fr: 'france', it: 'italy', nl: 'netherlands', be: 'belgium',
  ch: 'switzerland', ie: 'ireland', se: 'sweden', dk: 'denmark', no: 'norway',
  fi: 'finland', pl: 'poland', us: 'united states', usa: 'united states',
};

function normalize(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"') // curly -> straight quotes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function countryCanon(v: string): string {
  return COUNTRY_ALIASES[v] ?? v;
}

export type ConflictClass = 'cosmetic' | 'substantive';

export function classifyConflict(existingValue: unknown, incomingValue: unknown): ConflictClass {
  if (existingValue == null || incomingValue == null) return 'substantive'; // presence change is a real fact, not a typo
  const a = normalize(existingValue);
  const b = normalize(incomingValue);
  if (a === b) return 'cosmetic';
  if (countryCanon(a) === countryCanon(b)) return 'cosmetic';
  return 'substantive';
}
