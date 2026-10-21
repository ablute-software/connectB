// Prompt 918 (Adenda 2, A) — the initials of an entity's name, for the square that stands in for a logo that is not there. Up to two letters, from the first two words that start with one
// ("Portugal Ventures" -> "PV", "ablute_ — Internal" -> "AI", "INNOV-ID" -> "II"); a name with no letter at all gives "•". Pure.
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').split(/[^\p{L}\p{N}]+/u).filter((w) => /^\p{L}/u.test(w));
  const letters = words.slice(0, 2).map((w) => (Array.from(w)[0] ?? '').toLocaleUpperCase());
  return letters.join('') || '•';
}
