// Prompt 457/459 — shared word-boundary truncation: cuts at the last word
// boundary within the limit, never mid-word, because a suggestion or
// preview cut mid-word reads as broken, not helpful. First written inline
// in market-thesis/route.ts (457); moved here so document-extraction.ts
// (459) reuses the exact same function instead of a second drifting copy.
export function truncateAtWord(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}
