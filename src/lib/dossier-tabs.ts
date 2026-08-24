// Prompt 351 — pure hash<->tab resolution for the dossier Overview's real
// tabs (replaces the old anchor-scroll SectionNav). Kept pure and separate
// from the component so the mount-time "does #round in the URL open the
// Round tab" behavior is unit-testable without a DOM.
export function resolveInitialTabFromHash(hash: string, availableIds: string[], defaultId: string): string {
  const clean = hash.replace(/^#/, '');
  return availableIds.includes(clean) ? clean : defaultId;
}
