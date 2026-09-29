// Prompt 896 — pure logic behind RailLogForm.tsx's Person selector and the
// FirstContactGuideCard's visibility, extracted for the same reason
// roadmap-suggest-gate.ts/entity-fit-label.ts (Prompt 892/893) were: a
// route or a big stateful client component can't be unit-tested directly
// in this codebase (no React Testing Library anywhere in src/components/),
// so the actual decision logic lives here instead, tested without a DOM.
import type { Person } from './types';

export interface CatalogTeamMember { catalogPersonId: string; fullName: string; title: string | null; seniorityRank: number }

// Prompt 896 §A — never list a catalog person already promoted to a real
// org contact (they belong in "Your contacts" now, not repeated here);
// sorted seniority first, then title — the prompt's own ordering rule.
export function promotableCatalogTeam(catalogTeam: CatalogTeamMember[], ownContacts: Pick<Person, 'catalog_person_id'>[]): CatalogTeamMember[] {
  const alreadyPromoted = new Set(ownContacts.map((p) => p.catalog_person_id).filter((id): id is string => !!id));
  return catalogTeam
    .filter((m) => !alreadyPromoted.has(m.catalogPersonId))
    .sort((a, b) => a.seniorityRank - b.seniorityRank || (a.title ?? '').localeCompare(b.title ?? ''));
}

// Prompt 896 §B — the guide used to only ever render once a person (or "No
// specific person") was already selected, which meant a founder with zero
// contacts and zero interactions had no way to reach it at all: the exact
// deadlock this prompt exists to close (DOMiNO Ventures, 29/09/2026,
// "hummm… nada"). Before any selection, this falls back to "has this
// entity ever had an outbound at all" instead of the per-selection check.
export function shouldShowFirstContactGuide(opts: {
  direction: 'out' | 'in';
  hasSelection: boolean; // a person is picked, or "No specific person" is
  neverContactedSelection: boolean; // the existing per-selection first-contact check
  noOutboundEver: boolean; // this entity has never had an outbound interaction at all
}): boolean {
  if (opts.direction !== 'out') return false;
  return opts.hasSelection ? opts.neverContactedSelection : opts.noOutboundEver;
}
